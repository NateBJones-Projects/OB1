/**
 * smart-ingest — Supabase Edge Function for the Smart Ingest pipeline.
 *
 * Accepts raw text, extracts atomic thoughts via LLM, deduplicates against
 * existing thoughts (fingerprint + semantic), and optionally writes them to
 * the thoughts table. Supports dry_run mode for previewing without mutations.
 *
 * Routes:
 *   POST /smart-ingest          — Extract and reconcile (dry_run or immediate)
 *   POST /smart-ingest/execute  — Execute a previously dry-run job
 *
 * Auth: x-brain-key header or Authorization: Bearer <key>
 *
 * source_metadata (optional object) provides ambient capture provenance:
 *   source_client, capture_mode, session_id, source_title, captured_at,
 *   project_path, git_branch, import_key
 *
 * Dependencies:
 *   - Smart ingest tables (schemas/smart-ingest-tables): ingestion_jobs, ingestion_items
 *   - append_thought_evidence RPC (from smart-ingest-tables schema)
 *   - match_thoughts RPC (base OB1)
 *   - upsert_thought RPC (base OB1)
 *   - Enhanced thoughts columns (schemas/enhanced-thoughts)
 */

import { createClient } from "@supabase/supabase-js";
import {
  embedText,
  computeContentFingerprint,
  prepareThoughtPayload,
  detectSensitivity,
  safeEmbedding,
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
const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY") ?? "";
const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY") ?? "";
const OPENROUTER_API_KEY = Deno.env.get("OPENROUTER_API_KEY") ?? "";

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// ── Constants ───────────────────────────────────────────────────────────────

const CHUNK_WORD_LIMIT = 5000;
const SEMANTIC_SKIP_THRESHOLD = 0.92;
const SEMANTIC_MATCH_THRESHOLD = 0.85;
const MAX_THOUGHTS_PER_EXTRACTION = 20;
const MIN_THOUGHT_LENGTH = 30;
const MIN_IMPORTANCE = 3;
const MAX_THOUGHT_LENGTH = 280;
const MAX_SOURCE_SNIPPET_LENGTH = 280;
const MAX_TAGS_PER_THOUGHT = 8;
const ENTITY_EXTRACTION_BATCH_MAX = 50;

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, x-brain-key",
  "Content-Type": "application/json",
};

// ── Extraction System Prompt ────────────────────────────────────────────────

const SMART_INGEST_SYSTEM_PROMPT = [
  "You are extracting durable long-term memories from a user's conversation history or personal documents.",
  "",
  'Return STRICT JSON array: [{"content":string,"importance":1-5,"type":string,"tags":string[],"source_snippet":string}]',
  "",
  "RULES:",
  "1. type MUST be exactly one of: idea, task, person_note, reference, decision, lesson, meeting, journal",
  "2. Only extract knowledge PERSONAL to the user — their preferences, decisions, experiences, health data, project specifics, lessons learned, named people, and durable workflow habits.",
  "3. Do NOT extract: general encyclopedia facts, generic assistant advice, information findable on Wikipedia, or vague statements like 'the user is interested in X'.",
  "4. Each thought must be atomic, self-contained, 1-2 sentences, and max 280 chars.",
  "5. Write thoughts in third person referencing 'the user' or their name if known.",
  "6. source_snippet must be a short quote from the source that directly supports the thought.",
  "7. tags should be 1-4 short lowercase labels when useful; otherwise return [].",
  "8. Do not include duplicates within the same response.",
  "",
  "IMPORTANCE CALIBRATION (be strict — most should be 3):",
  "5: Life decisions, core beliefs, major health data, financial commitments, pivotal relationship or project decisions",
  "4: Specific preferences, concrete project decisions, chosen tools/processes, durable commitments",
  "3: Contextual project facts, minor preferences, reusable techniques learned, stable people/context notes",
  "1-2: Low-signal or borderline — only include if clearly durable",
  "",
  "REJECT (return [] if nothing qualifies):",
  "- 'The user asked about X' — this is a question, not a memory",
  "- 'X is recommended' — this is generic advice, not personal memory",
  "- General facts not tied to the user's specific context",
  "- Transient scheduling ('meeting tomorrow', 'will do later')",
  "- Small talk, greetings, boilerplate, or conversational filler",
  "- Fragments that do not stand alone months later",
  "",
  "Prefer fewer high-quality thoughts over many weak ones. Most source texts should yield 1-8 thoughts. Never exceed 20.",
  "Return ONLY the JSON array — no markdown fences, no commentary.",
].join("\n");

// ── Types ───────────────────────────────────────────────────────────────────

type ReconcileAction = "add" | "skip" | "append_evidence" | "create_revision";

interface ExtractedThought {
  content: string;
  type: string;
  importance: number;
  tags: string[];
  source_snippet: string;
}

interface IngestionItem {
  content: string;
  type: string;
  importance: number;
  tags: string[];
  source_snippet: string;
  content_fingerprint: string;
  action: ReconcileAction;
  reason: string;
  matched_thought_id: number | null;
  similarity_score: number | null;
  status: "pending" | "executed" | "failed";
  error_message: string | null;
}

interface IngestionJob {
  id?: number;
  input_hash: string;
  source_label: string | null;
  source_type: string | null;
  status: string;
  dry_run: boolean;
  items: IngestionItem[];
  added_count: number;
  skipped_count: number;
  revised_count: number;
  appended_count: number;
  failed_count: number;
  error_message: string | null;
}

type UpsertThoughtResult = {
  thought_id?: number;
  id?: number;
};

// ── Auth ────────────────────────────────────────────────────────────────────

function isAuthorized(req: Request): boolean {
  const key =
    req.headers.get("x-brain-key")?.trim() ||
    (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  return key === MCP_ACCESS_KEY;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data, null, 2), { status, headers: CORS_HEADERS });
}

async function computeInputHash(text: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(text);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function countWords(text: string): number {
  return text.split(/\s+/).filter((w) => w.length > 0).length;
}

function chunkText(text: string, wordLimit: number): string[] {
  const words = text.split(/\s+/);
  if (words.length <= wordLimit) return [text];

  const chunks: string[] = [];
  for (let i = 0; i < words.length; i += wordLimit) {
    chunks.push(words.slice(i, i + wordLimit).join(" "));
  }
  return chunks;
}

const ALLOWED_TYPES = new Set([
  "idea", "task", "person_note", "reference", "decision", "lesson", "meeting", "journal",
]);

function sanitizeType(t: unknown): string {
  const raw = typeof t === "string" ? t.trim().toLowerCase() : "";
  const normalized = raw.replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  if (!normalized) return "idea";
  if (ALLOWED_TYPES.has(normalized)) return normalized;

  const aliases: Record<string, string> = {
    note: "idea",
    memory: "idea",
    thought: "idea",
    observation: "idea",
    fact: "reference",
    definition: "reference",
    concept: "reference",
    knowledge: "reference",
    info: "reference",
    data: "reference",
    insight: "lesson",
    realization: "lesson",
    tip: "lesson",
    principle: "lesson",
    warning: "lesson",
    action: "task",
    todo: "task",
    follow_up: "task",
    next_step: "task",
    person: "person_note",
    people: "person_note",
    relationship: "person_note",
    social: "person_note",
    event: "meeting",
    appointment: "meeting",
    session: "meeting",
    diary: "journal",
    log: "journal",
    journal_entry: "journal",
    choice: "decision",
    commitment: "decision",
    policy: "decision",
    rule: "decision",
  };

  return aliases[normalized] ?? "idea";
}

function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function truncateText(text: string, maxLength: number): string {
  const normalized = normalizeWhitespace(text);
  if (normalized.length <= maxLength) return normalized;
  if (maxLength <= 3) return normalized.slice(0, maxLength);
  return `${normalized.slice(0, maxLength - 3).trimEnd()}...`;
}

function sanitizeImportance(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 3;
  return Math.max(1, Math.min(5, Math.round(parsed)));
}

function sanitizeTags(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const tags: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") continue;
    const tag = normalizeWhitespace(item).toLowerCase();
    if (!tag || seen.has(tag)) continue;
    seen.add(tag);
    tags.push(tag);
    if (tags.length >= MAX_TAGS_PER_THOUGHT) break;
  }
  return tags;
}

function sanitizeSourceSnippet(value: unknown): string {
  if (typeof value !== "string") return "";
  return truncateText(value, MAX_SOURCE_SNIPPET_LENGTH);
}

function extractThoughtArray(value: unknown): ExtractedThought[] {
  const arrayValue = Array.isArray(value)
    ? value
    : (typeof value === "object" && value !== null && Array.isArray((value as Record<string, unknown>).thoughts)
      ? (value as Record<string, unknown>).thoughts
      : null);

  if (!Array.isArray(arrayValue)) {
    throw new Error("LLM returned non-array");
  }

  return arrayValue
    .filter((item: unknown) => typeof item === "object" && item !== null)
    .map((item: unknown) => {
      const rec = item as Record<string, unknown>;
      const content = truncateText(typeof rec.content === "string" ? rec.content : "", MAX_THOUGHT_LENGTH);
      return {
        content,
        type: sanitizeType(rec.type),
        importance: sanitizeImportance(rec.importance),
        tags: sanitizeTags(rec.tags),
        source_snippet: sanitizeSourceSnippet(rec.source_snippet),
      };
    })
    .filter((item) => item.content.length > 0)
    .slice(0, MAX_THOUGHTS_PER_EXTRACTION);
}

function qualityGateReason(thought: ExtractedThought): string | null {
  if (thought.content.length < MIN_THOUGHT_LENGTH) return "quality_gate_short_content";
  if (thought.importance < MIN_IMPORTANCE) return "quality_gate_low_importance";
  return null;
}

function mergeTags(existing: unknown, extras: string[]): string[] {
  return sanitizeTags([
    ...(Array.isArray(existing) ? existing : []),
    ...extras,
  ]);
}

function extractThoughtId(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (value && typeof value === "object" && "thought_id" in value) {
    const thoughtId = (value as UpsertThoughtResult).thought_id;
    if (typeof thoughtId === "number" && Number.isFinite(thoughtId)) return thoughtId;
  }
  if (value && typeof value === "object" && "id" in value) {
    const id = (value as UpsertThoughtResult).id;
    if (typeof id === "number" && Number.isFinite(id)) return id;
  }
  return null;
}

/** Best-effort entity extraction drain. Non-fatal if the worker is not deployed. */
async function scheduleEntityExtraction(writtenCount: number): Promise<void> {
  if (writtenCount <= 0 || !SUPABASE_URL || !MCP_ACCESS_KEY) return;
  try {
    const limit = Math.min(Math.max(writtenCount, 1), ENTITY_EXTRACTION_BATCH_MAX);
    const response = await fetch(`${SUPABASE_URL}/functions/v1/entity-extraction-worker?limit=${limit}`, {
      method: "POST",
      headers: { "x-brain-key": MCP_ACCESS_KEY },
    });
    if (!response.ok) {
      console.warn(`Entity extraction trigger returned ${response.status} — worker may not be deployed yet.`);
    }
  } catch (err) {
    console.warn("Entity extraction trigger failed:", err instanceof Error ? err.message : String(err));
  }
}

// ── LLM Extraction ─────────────────────────────────────────────────────────

async function callOpenRouter(text: string): Promise<ExtractedThought[]> {
  if (!OPENROUTER_API_KEY) throw new Error("OPENROUTER_API_KEY is not configured");

  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${OPENROUTER_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: CLASSIFIER_MODEL_OPENROUTER,
      temperature: 0.2,
      messages: [
        { role: "system", content: SMART_INGEST_SYSTEM_PROMPT + "\nReturn a JSON array directly." },
        { role: "user", content: text },
      ],
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`OpenRouter API error (${response.status}): ${body}`);
  }

  const result = await response.json();
  const raw = result?.choices?.[0]?.message?.content ?? "";
  const cleaned = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "").trim();
  let parsed: unknown;
  try { parsed = JSON.parse(cleaned); } catch { throw new Error(`OpenRouter returned invalid JSON`); }
  return extractThoughtArray(parsed);
}

async function callOpenAI(text: string): Promise<ExtractedThought[]> {
  if (!OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is not configured");

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: CLASSIFIER_MODEL_OPENAI,
      temperature: 0.2,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SMART_INGEST_SYSTEM_PROMPT + '\nWrap the array in {"thoughts": [...]}' },
        { role: "user", content: text },
      ],
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`OpenAI API error (${response.status}): ${body}`);
  }

  const result = await response.json();
  const raw = result?.choices?.[0]?.message?.content ?? "";
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { throw new Error(`OpenAI returned invalid JSON`); }
  return extractThoughtArray(parsed);
}

async function callAnthropic(text: string): Promise<ExtractedThought[]> {
  if (!ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY is not configured");

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: CLASSIFIER_MODEL_ANTHROPIC,
      max_tokens: 4096,
      temperature: 0.2,
      system: SMART_INGEST_SYSTEM_PROMPT,
      messages: [{ role: "user", content: text }],
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Anthropic API error (${response.status}): ${body}`);
  }

  const result = await response.json();
  const raw = result?.content?.[0]?.text ?? "";
  const cleaned = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "").trim();
  let parsed: unknown;
  try { parsed = JSON.parse(cleaned); } catch { throw new Error(`LLM returned invalid JSON: ${cleaned.slice(0, 200)}`); }
  return extractThoughtArray(parsed);
}

/** Try LLM providers in OB1 priority order: OpenRouter → OpenAI → Anthropic. */
async function callLLM(text: string): Promise<ExtractedThought[]> {
  if (OPENROUTER_API_KEY) {
    try { return await callOpenRouter(text); } catch (err) {
      console.warn("OpenRouter extraction failed:", (err as Error).message);
    }
  }
  if (OPENAI_API_KEY) {
    try { return await callOpenAI(text); } catch (err) {
      console.warn("OpenAI extraction failed:", (err as Error).message);
    }
  }
  if (ANTHROPIC_API_KEY) {
    return await callAnthropic(text);
  }
  throw new Error("No LLM API key configured (OPENROUTER_API_KEY, OPENAI_API_KEY, or ANTHROPIC_API_KEY)");
}

async function extractThoughts(text: string): Promise<ExtractedThought[]> {
  const words = countWords(text);
  if (words <= CHUNK_WORD_LIMIT) return await callLLM(text);

  const chunks = chunkText(text, CHUNK_WORD_LIMIT);
  const allThoughts: ExtractedThought[] = [];
  for (let i = 0; i < chunks.length; i++) {
    console.log(`Processing chunk ${i + 1}/${chunks.length} (${countWords(chunks[i])} words)`);
    const thoughts = await callLLM(chunks[i]);
    allThoughts.push(...thoughts);
  }
  return allThoughts.slice(0, MAX_THOUGHTS_PER_EXTRACTION * chunks.length);
}

// ── Dedup & Reconciliation ──────────────────────────────────────────────────

async function reconcileThought(
  thought: ExtractedThought,
  embedding: number[],
  fingerprint: string,
  jobFingerprints: Set<string>,
): Promise<Omit<IngestionItem, "status" | "error_message">> {
  const base = {
    content: thought.content,
    type: thought.type,
    importance: thought.importance,
    tags: thought.tags,
    source_snippet: thought.source_snippet,
    content_fingerprint: fingerprint,
    matched_thought_id: null as number | null,
    similarity_score: null as number | null,
  };

  // 1. Within-job dedup by fingerprint
  if (jobFingerprints.has(fingerprint)) {
    return { ...base, action: "skip" as ReconcileAction, reason: "duplicate_within_job" };
  }

  // 2. Check thoughts table for fingerprint match
  const { data: fpMatch } = await supabase
    .from("thoughts")
    .select("id")
    .eq("content_fingerprint", fingerprint)
    .limit(1);

  if (fpMatch && fpMatch.length > 0) {
    return {
      ...base,
      action: "skip",
      reason: "fingerprint_match",
      matched_thought_id: fpMatch[0].id,
    };
  }

  // 3. Semantic similarity check via match_thoughts RPC
  const { data: matches, error: matchError } = await supabase.rpc("match_thoughts", {
    query_embedding: embedding,
    match_threshold: SEMANTIC_MATCH_THRESHOLD,
    match_count: 5,
  });

  if (matchError) {
    console.warn("match_thoughts RPC failed, treating as new:", matchError.message);
    return { ...base, action: "add", reason: "semantic_check_failed_fallback_add" };
  }

  if (!matches || matches.length === 0) {
    return { ...base, action: "add", reason: "no_semantic_match" };
  }

  const topMatch = matches[0];
  const similarity = topMatch.similarity as number;
  const matchedId = topMatch.id as number;
  const existingContent = (topMatch.content ?? "") as string;

  base.matched_thought_id = matchedId;
  base.similarity_score = similarity;

  if (similarity > SEMANTIC_SKIP_THRESHOLD) {
    return { ...base, action: "skip", reason: "semantic_duplicate" };
  }

  // 0.85 - 0.92 range: decide based on content richness
  const newLen = thought.content.length;
  const existingLen = existingContent.length;

  if (existingLen >= newLen) {
    return { ...base, action: "append_evidence", reason: "existing_is_richer" };
  } else {
    return { ...base, action: "create_revision", reason: "new_has_more_info" };
  }
}

// ── Execution ───────────────────────────────────────────────────────────────

async function executeItem(
  item: IngestionItem,
  embedding: number[],
  sourceLabel: string | null,
  sourceType: string | null,
  sourceMetadata?: Record<string, unknown> | null,
  skipClassification = false,
): Promise<number | null> {
  switch (item.action) {
    case "add": {
      const prepared = await prepareThoughtPayload(item.content, {
        source: "smart_ingest",
        source_type: sourceType ?? "smart_ingest",
        metadata: {
          type: item.type,
          importance: item.importance,
          source_label: sourceLabel ?? "smart_ingest",
          extraction_type: item.type,
          ...(sourceMetadata ?? {}),
        },
        skip_classification: skipClassification,
        skip_embedding: true,
        embedding,
      });
      prepared.metadata = {
        ...prepared.metadata,
        tags: mergeTags((prepared.metadata as Record<string, unknown>).tags, item.tags),
        source_snippet: item.source_snippet,
      };
      const { data, error } = await supabase.rpc("upsert_thought", {
        p_content: prepared.content,
        p_payload: {
          type: prepared.type,
          importance: prepared.importance,
          quality_score: prepared.quality_score,
          source_type: prepared.source_type,
          sensitivity_tier: prepared.sensitivity_tier,
          ...(safeEmbedding(prepared.embedding) && { embedding: prepared.embedding }),
          metadata: prepared.metadata,
          content_fingerprint: prepared.content_fingerprint,
        },
      });
      if (error) throw new Error(`upsert_thought failed: ${error.message}`);
      const thoughtId = extractThoughtId(data);
      if (thoughtId === null) throw new Error("upsert_thought returned no thought_id");
      return thoughtId;
    }

    case "append_evidence": {
      if (!item.matched_thought_id) throw new Error("append_evidence requires matched_thought_id");
      const { data, error } = await supabase.rpc("append_thought_evidence", {
        p_thought_id: item.matched_thought_id,
        p_evidence: {
          source: "smart_ingest",
          source_label: sourceLabel ?? "smart_ingest",
          excerpt: item.source_snippet || item.content.slice(0, 500),
          extracted_at: new Date().toISOString(),
        },
      });
      if (error) throw new Error(`append_thought_evidence failed: ${error.message}`);
      return extractThoughtId(data) ?? item.matched_thought_id;
    }

    case "create_revision": {
      const prepared = await prepareThoughtPayload(item.content, {
        source: "smart_ingest",
        source_type: sourceType ?? "smart_ingest",
        metadata: {
          type: item.type,
          importance: item.importance,
          source_label: sourceLabel ?? "smart_ingest",
          extraction_type: item.type,
          supersedes: item.matched_thought_id,
          ...(sourceMetadata ?? {}),
        },
        skip_classification: skipClassification,
        skip_embedding: true,
        embedding,
      });
      prepared.metadata = {
        ...prepared.metadata,
        tags: mergeTags((prepared.metadata as Record<string, unknown>).tags, item.tags),
        source_snippet: item.source_snippet,
      };
      const { data, error } = await supabase.rpc("upsert_thought", {
        p_content: prepared.content,
        p_payload: {
          type: prepared.type,
          importance: prepared.importance,
          quality_score: prepared.quality_score,
          source_type: prepared.source_type,
          sensitivity_tier: prepared.sensitivity_tier,
          ...(safeEmbedding(prepared.embedding) && { embedding: prepared.embedding }),
          metadata: prepared.metadata,
          content_fingerprint: prepared.content_fingerprint,
        },
      });
      if (error) throw new Error(`upsert_thought (revision) failed: ${error.message}`);
      const thoughtId = extractThoughtId(data);
      if (thoughtId === null) throw new Error("upsert_thought (revision) returned no thought_id");
      return thoughtId;
    }

    case "skip":
      return item.matched_thought_id;

    default:
      throw new Error(`Unknown action: ${item.action}`);
  }
}

// ── Existing Job Lookup ─────────────────────────────────────────────────────

async function findExistingJob(inputHash: string): Promise<IngestionJob | null> {
  const { data } = await supabase
    .from("ingestion_jobs")
    .select("*")
    .eq("input_hash", inputHash)
    .order("created_at", { ascending: false })
    .limit(1);

  if (!data || data.length === 0) return null;
  return data[0] as IngestionJob;
}

async function nextVersionHash(baseHash: string): Promise<string> {
  const { data } = await supabase
    .from("ingestion_jobs")
    .select("input_hash")
    .like("input_hash", `${baseHash}%`)
    .order("created_at", { ascending: false })
    .limit(1);

  if (!data || data.length === 0) return `${baseHash}-v2`;

  const latest = data[0].input_hash as string;
  const versionMatch = latest.match(/-v(\d+)$/);
  if (versionMatch) {
    const next = parseInt(versionMatch[1], 10) + 1;
    return `${baseHash}-v${next}`;
  }
  return `${baseHash}-v2`;
}

// ── Job Persistence ─────────────────────────────────────────────────────────

async function createJob(job: IngestionJob, sourceMetadata?: Record<string, unknown> | null): Promise<number> {
  const { data, error } = await supabase.from("ingestion_jobs").insert({
    input_hash: job.input_hash,
    source_label: job.source_label,
    status: job.status,
    input_length: 0,
    metadata: { source_type: job.source_type, dry_run: job.dry_run, ...(sourceMetadata ?? {}) },
  }).select("id").single();
  if (error) {
    console.error("Failed to create ingestion_jobs row:", error.message);
    return 0;
  }
  return data?.id ?? 0;
}

async function updateJobById(
  jobId: number,
  updates: Record<string, unknown>,
): Promise<{ ok: boolean; error?: string }> {
  const { data, error } = await supabase
    .from("ingestion_jobs")
    .update(updates)
    .eq("id", jobId)
    .select("id, status")
    .maybeSingle();
  if (error) {
    console.error(`Failed to update job #${jobId}: ${error.message} (code: ${error.code}, details: ${error.details})`);
    return { ok: false, error: `${error.code}: ${error.message}` };
  }
  if (!data) {
    console.error(`updateJobById: update matched 0 rows for job #${jobId}`);
    return { ok: false, error: `No row matched for job #${jobId}` };
  }
  return { ok: true };
}

async function persistItems(
  jobId: number,
  items: IngestionItem[],
  sourceMetadata?: Record<string, unknown> | null,
): Promise<number[]> {
  if (items.length === 0 || !jobId) return [];
  const rows = items.map((item) => ({
    job_id: jobId,
    extracted_content: item.content,
    action: item.action,
    status: item.status === "pending" ? "ready" : item.status,
    reason: item.reason,
    matched_thought_id: item.matched_thought_id,
    similarity_score: item.similarity_score,
    error_message: item.error_message,
    metadata: {
      type: item.type,
      importance: item.importance,
      tags: item.tags,
      source_snippet: item.source_snippet,
      ...(sourceMetadata ?? {}),
    },
  }));
  const { data, error } = await supabase.from("ingestion_items").insert(rows).select("id");
  if (error) {
    console.error("Failed to persist ingestion_items:", error.message);
    return [];
  }
  return (data ?? []).map((row: { id: number }) => row.id);
}

// ── Execute a dry-run job ───────────────────────────────────────────────────

async function handleExecuteJob(req: Request): Promise<Response> {
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ error: "Invalid JSON body" }, 400); }

  const jobId = typeof body.job_id === "number" ? body.job_id : 0;
  if (!jobId) return json({ error: "job_id is required" }, 400);

  const { data: job, error: jobErr } = await supabase
    .from("ingestion_jobs").select("*").eq("id", jobId).single();
  if (jobErr || !job) return json({ error: `Job #${jobId} not found` }, 404);
  if (job.status === "complete") return json({ ...job, message: "Job already complete" }, 200);
  if (job.status !== "dry_run_complete") {
    return json({ error: `Job status is '${job.status}', expected 'dry_run_complete'` }, 400);
  }

  const { data: itemRows } = await supabase
    .from("ingestion_items").select("*").eq("job_id", jobId).order("id");
  const items = itemRows ?? [];

  // CAS: only transition dry_run_complete -> executing; concurrent requests get 409
  const { data: casRow, error: casErr } = await supabase
    .from("ingestion_jobs")
    .update({ status: "executing" })
    .eq("id", jobId)
    .eq("status", "dry_run_complete")
    .select("id, status")
    .maybeSingle();
  if (casErr || !casRow || casRow.status !== "executing") {
    return json({ error: "Job execution conflict — another request may have claimed this job" }, 409);
  }

  let addedCount = 0, skippedCount = 0, appendedCount = 0, revisedCount = 0;
  const sourceLabel = job.source_label ?? null;
  const jobMeta = (job.metadata ?? {}) as Record<string, unknown>;
  const sourceType = jobMeta.source_type as string ?? "smart_ingest";
  const skipClassification = body.skip_classification === true || jobMeta.skip_classification === true;
  const jobSourceMetadata = (jobMeta.source_client || jobMeta.capture_mode)
    ? jobMeta as Record<string, unknown>
    : null;

  for (const item of items) {
    if (item.action === "skip") { skippedCount++; continue; }
    try {
      const fakeItem: IngestionItem = {
        content: item.extracted_content,
        type: sanitizeType((item.metadata as Record<string, unknown>)?.type),
        importance: sanitizeImportance((item.metadata as Record<string, unknown>)?.importance),
        tags: sanitizeTags((item.metadata as Record<string, unknown>)?.tags),
        source_snippet: sanitizeSourceSnippet((item.metadata as Record<string, unknown>)?.source_snippet),
        content_fingerprint: "",
        action: item.action as ReconcileAction,
        reason: item.reason ?? "",
        matched_thought_id: item.matched_thought_id,
        similarity_score: item.similarity_score,
        status: "pending",
        error_message: null,
      };
      let embedding: number[] = [];
      try { embedding = await embedText(item.extracted_content); } catch { /* continue without embedding */ }
      const resultThoughtId = await executeItem(
        fakeItem, embedding, sourceLabel, sourceType, jobSourceMetadata, skipClassification,
      );

      await supabase.from("ingestion_items")
        .update({ status: "executed", result_thought_id: resultThoughtId })
        .eq("id", item.id);
      if (item.action === "add") addedCount++;
      else if (item.action === "append_evidence") appendedCount++;
      else if (item.action === "create_revision") revisedCount++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await supabase.from("ingestion_items")
        .update({ status: "failed", error_message: msg })
        .eq("id", item.id);
    }
  }

  await updateJobById(jobId, {
    status: "complete",
    added_count: addedCount,
    skipped_count: skippedCount,
    appended_count: appendedCount,
    revised_count: revisedCount,
    completed_at: new Date().toISOString(),
  });

  await scheduleEntityExtraction(addedCount + revisedCount);

  return json({
    job_id: jobId, status: "complete",
    added_count: addedCount, skipped_count: skippedCount,
    appended_count: appendedCount, revised_count: revisedCount,
  }, 200);
}

// ── Tallying ────────────────────────────────────────────────────────────────

function tally(items: IngestionItem[]) {
  let added_count = 0, skipped_count = 0, revised_count = 0, appended_count = 0, failed_count = 0;
  for (const item of items) {
    if (item.status === "failed") { failed_count++; continue; }
    switch (item.action) {
      case "add": added_count++; break;
      case "skip": skipped_count++; break;
      case "create_revision": revised_count++; break;
      case "append_evidence": appended_count++; break;
    }
  }
  return { added_count, skipped_count, revised_count, appended_count, failed_count };
}

// ── Main Handler ────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  if (req.method !== "POST") {
    return json({ error: "Method not allowed. Use POST." }, 405);
  }

  if (!MCP_ACCESS_KEY) {
    console.warn("MCP_ACCESS_KEY is not set — all requests will be rejected.");
    return json({ error: "Service misconfigured" }, 503);
  }
  if (!isAuthorized(req)) {
    return json({ error: "Unauthorized" }, 401);
  }

  // Route: /execute
  const url = new URL(req.url);
  const path = url.pathname.replace(/^\/smart-ingest/, "").replace(/\/+$/, "") || "/";
  if (path === "/execute") {
    return await handleExecuteJob(req);
  }

  // Default route: ingest
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ error: "Invalid JSON body" }, 400); }

  const text = typeof body.text === "string" ? body.text.trim() : "";
  if (!text) return json({ error: "Missing or empty 'text' field" }, 400);

  // Pre-flight sensitivity check (restricted content blocked from cloud)
  const inputSensitivity = detectSensitivity(text);
  if (inputSensitivity.tier === "restricted") {
    return json({ error: "Input contains restricted content and cannot be processed in the cloud." }, 403);
  }

  const sourceLabel = typeof body.source_label === "string" ? body.source_label.trim() : null;
  const sourceType = typeof body.source_type === "string" ? body.source_type.trim() : null;
  const dryRun = body.dry_run === true;
  const reprocess = body.reprocess === true;
  const skipClassification = body.skip_classification === true;
  const sourceMetadata = (typeof body.source_metadata === "object" && body.source_metadata !== null)
    ? body.source_metadata as Record<string, unknown>
    : null;

  // Session-level dedup via import_key (separate from content-hash dedup)
  const importKey = sourceMetadata?.import_key;
  if (typeof importKey === "string" && importKey && !reprocess) {
    const { data: existingByKey } = await supabase
      .from("ingestion_jobs")
      .select("id, status")
      .contains("metadata", { import_key: importKey })
      .limit(1);
    if (existingByKey && existingByKey.length > 0) {
      return json({
        status: "existing",
        job_id: existingByKey[0].id,
        message: `Session already captured (import_key: ${importKey}).`,
      }, 200);
    }
  }

  const baseHash = await computeInputHash(text);
  let inputHash = baseHash;

  const existing = await findExistingJob(baseHash);
  if (existing && !reprocess) {
    return json({
      ...existing,
      status: "existing",
      job_id: existing.id,
      message: "Identical input already processed. Set reprocess=true to run again.",
    }, 200);
  }
  if (existing && reprocess) {
    inputHash = await nextVersionHash(baseHash);
  }

  const job: IngestionJob = {
    input_hash: inputHash, source_label: sourceLabel, source_type: sourceType,
    status: "extracting", dry_run: dryRun, items: [],
    added_count: 0, skipped_count: 0, revised_count: 0, appended_count: 0, failed_count: 0, error_message: null,
  };

  const jobId = await createJob(job, {
    skip_classification: skipClassification,
    ...(sourceMetadata ?? {}),
  });

  let extractedThoughts: ExtractedThought[];
  try {
    extractedThoughts = await extractThoughts(text);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (jobId) await updateJobById(jobId, { status: "failed", error_message: msg });
    return json({ error: "Extraction failed", detail: msg }, 500);
  }

  if (extractedThoughts.length === 0) {
    if (jobId) await updateJobById(jobId, { status: "complete", extracted_count: 0 });
    return json({ status: "complete", job_id: jobId, extracted_count: 0, message: "No thoughts extracted." }, 200);
  }

  const jobFingerprints = new Set<string>();
  const items: IngestionItem[] = [];
  const embeddings: number[][] = [];

  for (const thought of extractedThoughts) {
    const filterReason = qualityGateReason(thought);
    if (filterReason) {
      items.push({
        content: thought.content,
        type: thought.type,
        importance: thought.importance,
        tags: thought.tags,
        source_snippet: thought.source_snippet,
        content_fingerprint: "",
        action: "skip",
        reason: filterReason,
        matched_thought_id: null,
        similarity_score: null,
        status: "pending",
        error_message: null,
      });
      embeddings.push([]);
      continue;
    }

    try {
      const fingerprint = await computeContentFingerprint(thought.content);
      let embedding: number[] = [];
      try {
        embedding = await embedText(thought.content);
      } catch (embedErr) {
        console.warn(`embedText failed for thought (fingerprint=${fingerprint}), proceeding with null embedding:`, embedErr instanceof Error ? embedErr.message : String(embedErr));
      }
      const reconciled = await reconcileThought(thought, embedding, fingerprint, jobFingerprints);
      jobFingerprints.add(fingerprint);
      items.push({ ...reconciled, status: "pending", error_message: null });
      embeddings.push(embedding);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      items.push({
        content: thought.content,
        type: thought.type,
        importance: thought.importance,
        tags: thought.tags,
        source_snippet: thought.source_snippet,
        content_fingerprint: "",
        action: "skip", reason: `reconciliation_error: ${msg}`,
        matched_thought_id: null, similarity_score: null, status: "failed", error_message: msg,
      });
      embeddings.push([]);
    }
  }

  // Persist items to ingestion_items table
  let itemIds: number[] = [];
  if (jobId) itemIds = await persistItems(jobId, items, sourceMetadata);

  if (dryRun) {
    const counts = tally(items);
    if (jobId) {
      const { failed_count: _, ...dbCounts } = counts;
      const result = await updateJobById(jobId, {
        status: "dry_run_complete", extracted_count: items.length, ...dbCounts,
      });
      if (!result.ok) {
        return json({
          error: "Dry run extracted thoughts but failed to update job status.",
          db_error: result.error, job_id: jobId, extracted_count: items.length, ...counts,
        }, 500);
      }
    }
    return json({
      status: "dry_run_complete", job_id: jobId, extracted_count: items.length, ...counts,
      message: `Dry run: ${items.length} extracted. Would add ${counts.added_count}, skip ${counts.skipped_count}.`,
    }, 200);
  }

  // Execute immediately
  if (jobId) await updateJobById(jobId, { status: "executing" });
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const itemDbId = itemIds[i] ?? 0;
    if (item.action === "skip") {
      item.status = "executed";
      if (itemDbId) await supabase.from("ingestion_items").update({ status: "executed" }).eq("id", itemDbId);
      continue;
    }
    try {
      const resultThoughtId = await executeItem(
        item, embeddings[i], sourceLabel, sourceType, sourceMetadata, skipClassification,
      );
      item.status = "executed";
      if (itemDbId) {
        await supabase.from("ingestion_items")
          .update({ status: "executed", result_thought_id: resultThoughtId })
          .eq("id", itemDbId);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      item.status = "failed"; item.error_message = msg;
      if (itemDbId) {
        await supabase.from("ingestion_items")
          .update({ status: "failed", error_message: msg })
          .eq("id", itemDbId);
      }
    }
  }

  const counts = tally(items);
  const { failed_count: _fc, ...dbCounts2 } = counts;
  if (jobId) {
    await updateJobById(jobId, {
      status: "complete", extracted_count: items.length, ...dbCounts2,
      completed_at: new Date().toISOString(),
    });
  }

  await scheduleEntityExtraction(counts.added_count + counts.revised_count);

  return json({
    status: "complete", job_id: jobId, extracted_count: items.length, ...counts,
    message: `Ingestion complete. Added ${counts.added_count}, skipped ${counts.skipped_count}.`,
  }, 200);
});
