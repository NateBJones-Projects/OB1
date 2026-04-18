/**
 * entity-extraction-worker — Process the entity extraction queue via LLM.
 *
 * Picks pending items from entity_extraction_queue, calls an LLM to extract
 * entities and relationships, then upserts into entities/edges/thought_entities.
 *
 * Query params:
 *   ?limit=10      — batch size (default 10, max 50)
 *   ?dry_run=true  — extract but don't write to DB
 *
 * Auth: x-brain-key header or Authorization: Bearer <key>
 *
 * Dependencies:
 *   - Knowledge graph schema (schemas/knowledge-graph): entities, edges,
 *     thought_entities, entity_extraction_queue tables
 *   - Enhanced thoughts columns (schemas/enhanced-thoughts)
 */

import { createClient } from "@supabase/supabase-js";
import {
  isRecord,
  asString,
  asNumber,
} from "./_shared/helpers.ts";
import {
  CLASSIFIER_MODEL_OPENROUTER,
  CLASSIFIER_MODEL_OPENAI,
  CLASSIFIER_MODEL_ANTHROPIC,
} from "./_shared/config.ts";

// ── Environment ─────────────────────────────────────────────────────────────

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const MCP_ACCESS_KEY = Deno.env.get("MCP_ACCESS_KEY") ?? "";
const OPENROUTER_API_KEY = Deno.env.get("OPENROUTER_API_KEY") ?? "";
const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY") ?? "";
const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY") ?? "";

const WORKER_VERSION = "entity-extraction-worker-v1";
const MAX_ATTEMPTS = 5;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// ── CORS ────────────────────────────────────────────────────────────────────

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, x-brain-key",
  "Content-Type": "application/json",
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data, null, 2), { status, headers: CORS_HEADERS });
}

// ── Auth ────────────────────────────────────────────────────────────────────

function isAuthorized(req: Request): boolean {
  const url = new URL(req.url);
  const key =
    req.headers.get("x-brain-key")?.trim() ||
    url.searchParams.get("key")?.trim() ||
    (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  return key === MCP_ACCESS_KEY;
}

// ── LLM Helpers ─────────────────────────────────────────────────────────────

function stripCodeFences(text: string): string {
  const trimmed = text.trim();
  const match = trimmed.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?\s*```$/);
  return match ? match[1].trim() : trimmed;
}

function readAnthropicText(payload: unknown): string {
  if (!isRecord(payload) || !Array.isArray(payload.content) || payload.content.length === 0) return "";
  return payload.content
    .map((block: unknown) => {
      if (!isRecord(block) || asString(block.type, "") !== "text") return "";
      return asString(block.text, "");
    })
    .join("");
}

function readChatCompletionText(payload: unknown): string {
  if (!isRecord(payload)) return "";
  const choices = payload.choices;
  if (!Array.isArray(choices) || choices.length === 0) return "";
  const msg = (choices[0] as Record<string, unknown>)?.message;
  if (!isRecord(msg)) return "";
  return asString(msg.content, "");
}

// ── Entity Types and Relation Types ─────────────────────────────────────────

const VALID_ENTITY_TYPES = new Set([
  "person", "project", "topic", "tool", "organization", "place",
]);

const VALID_RELATIONS = new Set([
  "works_on", "uses", "related_to", "member_of", "located_in", "co_occurs_with",
]);

const SYMMETRIC_RELATIONS = new Set(["co_occurs_with", "related_to"]);

// ── Extraction Prompt ───────────────────────────────────────────────────────

const ENTITY_EXTRACTION_PROMPT = `Extract entities and relationships from this text. Return STRICT JSON (no markdown fences).

Text: {content}

Return:
{
  "entities": [
    {"name": "...", "type": "person|project|topic|tool|organization|place", "confidence": 0.0-1.0}
  ],
  "relationships": [
    {"from": "entity_name", "to": "entity_name", "relation": "works_on|uses|related_to|member_of|located_in|co_occurs_with", "confidence": 0.0-1.0}
  ]
}

Rules:
- Only extract clearly identifiable entities, not vague terms.
- Names should be specific and recognizable (e.g. "PostgreSQL" not "database").
- Confidence below 0.5 means you are guessing — omit those.
- Return empty arrays if nothing noteworthy is found.`;

// ── LLM Call ────────────────────────────────────────────────────────────────

type ExtractedEntity = {
  name: string;
  type: string;
  confidence: number;
};

type ExtractedRelationship = {
  from: string;
  to: string;
  relation: string;
  confidence: number;
};

type ExtractionResult = {
  entities: ExtractedEntity[];
  relationships: ExtractedRelationship[];
};

function parseExtractionResult(rawText: string): ExtractionResult {
  if (!rawText.trim()) return { entities: [], relationships: [] };

  const parsed = JSON.parse(stripCodeFences(rawText));
  if (!isRecord(parsed)) return { entities: [], relationships: [] };

  const entities: ExtractedEntity[] = [];
  if (Array.isArray(parsed.entities)) {
    for (const e of parsed.entities) {
      if (!isRecord(e)) continue;
      const name = asString(e.name, "").trim();
      const type = asString(e.type, "").trim().toLowerCase();
      const confidence = asNumber(e.confidence, 0.5, 0, 1);
      if (!name || !VALID_ENTITY_TYPES.has(type) || confidence < 0.5) continue;
      entities.push({ name, type, confidence });
    }
  }

  const relationships: ExtractedRelationship[] = [];
  if (Array.isArray(parsed.relationships)) {
    for (const r of parsed.relationships) {
      if (!isRecord(r)) continue;
      const from = asString(r.from, "").trim();
      const to = asString(r.to, "").trim();
      const relation = asString(r.relation, "").trim().toLowerCase();
      const confidence = asNumber(r.confidence, 0.5, 0, 1);
      if (!from || !to || !VALID_RELATIONS.has(relation) || confidence < 0.5) continue;
      relationships.push({ from, to, relation, confidence });
    }
  }

  return { entities, relationships };
}

/** Try LLM providers in OB1 priority order: OpenRouter → OpenAI → Anthropic. */
async function extractEntities(content: string): Promise<ExtractionResult> {
  const prompt = ENTITY_EXTRACTION_PROMPT.replace("{content}", content.slice(0, 4000));

  // OpenRouter (primary)
  if (OPENROUTER_API_KEY) {
    try {
      const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${OPENROUTER_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: CLASSIFIER_MODEL_OPENROUTER,
          temperature: 0.1,
          messages: [{ role: "user", content: prompt }],
        }),
      });
      if (!response.ok) throw new Error(`OpenRouter failed (${response.status}): ${await response.text()}`);
      return parseExtractionResult(readChatCompletionText(await response.json()));
    } catch (err) {
      console.warn("OpenRouter extraction failed:", (err as Error).message);
    }
  }

  // OpenAI (secondary)
  if (OPENAI_API_KEY) {
    try {
      const response = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: CLASSIFIER_MODEL_OPENAI,
          temperature: 0.1,
          response_format: { type: "json_object" },
          messages: [{ role: "user", content: prompt }],
        }),
      });
      if (!response.ok) throw new Error(`OpenAI failed (${response.status}): ${await response.text()}`);
      return parseExtractionResult(readChatCompletionText(await response.json()));
    } catch (err) {
      console.warn("OpenAI extraction failed:", (err as Error).message);
    }
  }

  // Anthropic (tertiary)
  if (ANTHROPIC_API_KEY) {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: CLASSIFIER_MODEL_ANTHROPIC,
        max_tokens: 1024,
        temperature: 0.1,
        messages: [{ role: "user", content: prompt }],
      }),
    });
    if (!response.ok) throw new Error(`Anthropic failed (${response.status}): ${await response.text()}`);
    return parseExtractionResult(readAnthropicText(await response.json()));
  }

  throw new Error("No LLM API key configured (OPENROUTER_API_KEY, OPENAI_API_KEY, or ANTHROPIC_API_KEY)");
}

// ── Entity Normalization ────────────────────────────────────────────────────

function normalizeName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

// ── DB Operations ───────────────────────────────────────────────────────────

async function upsertEntity(name: string, entityType: string): Promise<number | null> {
  const normalized = normalizeName(name);
  const { data, error } = await supabase
    .from("entities")
    .upsert(
      {
        entity_type: entityType,
        canonical_name: name,
        normalized_name: normalized,
        last_seen_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      { onConflict: "entity_type,normalized_name" },
    )
    .select("id")
    .single();

  if (error) {
    console.error(`Failed to upsert entity "${name}" (${entityType}):`, error);
    return null;
  }
  return data?.id ?? null;
}

async function linkThoughtEntity(
  thoughtId: string,
  entityId: number,
  confidence: number,
): Promise<boolean> {
  const { error } = await supabase
    .from("thought_entities")
    .upsert(
      {
        thought_id: thoughtId,
        entity_id: entityId,
        mention_role: "mentioned",
        confidence,
        source: "entity_worker",
      },
      { onConflict: "thought_id,entity_id,mention_role" },
    );

  if (error) {
    console.error(`Failed to link thought ${thoughtId} -> entity ${entityId}:`, error);
    return false;
  }
  return true;
}

async function upsertEdge(
  fromEntityId: number,
  toEntityId: number,
  relation: string,
  confidence: number,
): Promise<boolean> {
  // Canonical ordering for symmetric relations to avoid duplicates
  let fromId = fromEntityId;
  let toId = toEntityId;
  if (SYMMETRIC_RELATIONS.has(relation) && fromId > toId) {
    fromId = toEntityId;
    toId = fromEntityId;
  }

  const { data: existing } = await supabase
    .from("edges")
    .select("id, support_count, confidence")
    .eq("from_entity_id", fromId)
    .eq("to_entity_id", toId)
    .eq("relation", relation)
    .maybeSingle();

  if (existing) {
    const { error } = await supabase
      .from("edges")
      .update({
        support_count: (existing.support_count ?? 1) + 1,
        confidence: Math.max(confidence, Number(existing.confidence ?? 0)),
        updated_at: new Date().toISOString(),
      })
      .eq("id", existing.id);

    if (error) {
      console.error(`Failed to update edge ${existing.id}:`, error);
      return false;
    }
    return true;
  }

  const { error } = await supabase
    .from("edges")
    .insert({
      from_entity_id: fromId,
      to_entity_id: toId,
      relation,
      support_count: 1,
      confidence,
    });

  if (error) {
    console.error(`Failed to create edge ${fromId} -> ${toId} (${relation}):`, error);
    return false;
  }
  return true;
}

// ── Queue Management ────────────────────────────────────────────────────────

/** Peek at pending items without changing their status (for dry-run mode). */
async function peekQueueItems(limit: number): Promise<Array<{ thought_id: string }>> {
  const { data, error } = await supabase
    .from("entity_extraction_queue")
    .select("thought_id")
    .eq("status", "pending")
    .order("queued_at", { ascending: true })
    .limit(limit);

  if (error || !data) return [];
  return data;
}

/** Atomically claim pending items — returns only items this worker actually acquired. */
async function claimQueueItems(limit: number): Promise<Array<{ thought_id: string }>> {
  const { data: pending, error: fetchError } = await supabase
    .from("entity_extraction_queue")
    .select("thought_id")
    .eq("status", "pending")
    .order("queued_at", { ascending: true })
    .limit(limit);

  if (fetchError || !pending || pending.length === 0) return [];

  const ids = pending.map((p) => p.thought_id);

  // Atomic claim: the .eq("status", "pending") guard ensures only items still
  // pending are updated. .select() returns the rows actually claimed, so
  // concurrent workers don't see each other's items.
  const { data: claimed, error: updateError } = await supabase
    .from("entity_extraction_queue")
    .update({
      status: "processing",
      started_at: new Date().toISOString(),
      worker_version: WORKER_VERSION,
    })
    .in("thought_id", ids)
    .eq("status", "pending")
    .select("thought_id");

  if (updateError) {
    console.error("Failed to claim queue items:", updateError);
    return [];
  }

  return claimed ?? [];
}

async function markComplete(thoughtId: string): Promise<void> {
  await supabase
    .from("entity_extraction_queue")
    .update({ status: "complete", processed_at: new Date().toISOString() })
    .eq("thought_id", thoughtId);
}

async function markError(thoughtId: string, error: string, attemptCount: number): Promise<void> {
  const newStatus = attemptCount + 1 >= MAX_ATTEMPTS ? "failed" : "pending";
  const isRetry = newStatus === "pending";
  await supabase
    .from("entity_extraction_queue")
    .update({
      status: newStatus,
      attempt_count: attemptCount + 1,
      last_error: error.slice(0, 500),
      processed_at: newStatus === "failed" ? new Date().toISOString() : null,
      // Clear claim state on retry so the item doesn't look stale in monitoring
      started_at: isRetry ? null : undefined,
      worker_version: isRetry ? null : undefined,
    })
    .eq("thought_id", thoughtId);
}

// ── Main Handler ────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  if (!MCP_ACCESS_KEY) {
    console.warn("MCP_ACCESS_KEY not set — rejecting all requests.");
    return json({ error: "Service misconfigured: auth key not set" }, 503);
  }
  if (!isAuthorized(req)) {
    return json({ error: "Unauthorized" }, 401);
  }

  if (!OPENROUTER_API_KEY && !OPENAI_API_KEY && !ANTHROPIC_API_KEY) {
    return json({ error: "No LLM API key configured" }, 503);
  }

  const url = new URL(req.url);
  const limit = Math.min(Math.max(parseInt(url.searchParams.get("limit") ?? "10", 10) || 10, 1), 50);
  const dryRun = url.searchParams.get("dry_run") === "true";

  // Step 1: Fetch queue items — peek only for dry-run, claim for real processing
  const claimed = dryRun
    ? await peekQueueItems(limit)
    : await claimQueueItems(limit);

  if (claimed.length === 0) {
    return json({ processed: 0, succeeded: 0, failed: 0, entities_created: 0, edges_created: 0, dry_run: dryRun });
  }

  const summary = {
    processed: 0,
    succeeded: 0,
    failed: 0,
    entities_created: 0,
    edges_created: 0,
    dry_run: dryRun,
    details: [] as Record<string, unknown>[],
  };

  // Step 2: Process each queue item
  for (const item of claimed) {
    summary.processed++;

    // Fetch thought content
    const { data: thought, error: thoughtError } = await supabase
      .from("thoughts")
      .select("id, content, metadata")
      .eq("id", item.thought_id)
      .single();

    if (thoughtError || !thought?.content) {
      console.error(`Failed to fetch thought ${item.thought_id}:`, thoughtError);
      if (!dryRun) await markError(item.thought_id, thoughtError?.message ?? "Thought not found", 0);
      summary.failed++;
      continue;
    }

    // Skip system-generated thoughts
    const meta = isRecord(thought.metadata) ? thought.metadata : {};
    if (meta.generated_by) {
      if (!dryRun) {
        await supabase
          .from("entity_extraction_queue")
          .update({ status: "skipped", processed_at: new Date().toISOString() })
          .eq("thought_id", item.thought_id);
      }
      summary.succeeded++;
      continue;
    }

    // Get current attempt count for error handling
    const { data: queueItem } = await supabase
      .from("entity_extraction_queue")
      .select("attempt_count")
      .eq("thought_id", item.thought_id)
      .single();
    const attemptCount = queueItem?.attempt_count ?? 0;

    // Call LLM for extraction
    let result: ExtractionResult;
    try {
      result = await extractEntities(thought.content);
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      console.error(`Extraction failed for thought ${item.thought_id}:`, errMsg);
      if (!dryRun) await markError(item.thought_id, errMsg, attemptCount);
      summary.failed++;
      continue;
    }

    // Build name->id map for linking relationships
    const entityNameToId = new Map<string, number>();
    let itemEntitiesCreated = 0;
    let itemEdgesCreated = 0;

    if (dryRun) {
      summary.details.push({
        thought_id: item.thought_id,
        entities: result.entities,
        relationships: result.relationships,
      });
      summary.entities_created += result.entities.length;
      summary.edges_created += result.relationships.length;
      summary.succeeded++;
      continue;
    }

    // Upsert entities and create thought_entities links
    for (const entity of result.entities) {
      const entityId = await upsertEntity(entity.name, entity.type);
      if (!entityId) continue;
      entityNameToId.set(normalizeName(entity.name), entityId);
      itemEntitiesCreated++;
      await linkThoughtEntity(item.thought_id, entityId, entity.confidence);
    }

    // Create edges for relationships
    for (const rel of result.relationships) {
      const fromId = entityNameToId.get(normalizeName(rel.from));
      const toId = entityNameToId.get(normalizeName(rel.to));
      if (!fromId || !toId || fromId === toId) continue;
      const created = await upsertEdge(fromId, toId, rel.relation, rel.confidence);
      if (created) itemEdgesCreated++;
    }

    await markComplete(item.thought_id);
    summary.entities_created += itemEntitiesCreated;
    summary.edges_created += itemEdgesCreated;
    summary.succeeded++;
  }

  return json(summary);
});
