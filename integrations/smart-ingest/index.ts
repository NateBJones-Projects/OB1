/**
 * smart-ingest — Supabase Edge Function for intelligent document ingestion.
 *
 * Accepts raw text, extracts atomic thoughts via LLM, deduplicates against
 * existing thoughts (fingerprint + semantic similarity), and optionally writes
 * them to the thoughts table. Supports dry_run mode for previewing without
 * mutations.
 *
 * Routes:
 *   POST /smart-ingest          — Extract and reconcile (dry_run or immediate)
 *   POST /smart-ingest/execute  — Execute a previously dry-run job
 *
 * Auth: x-brain-key header or Authorization: Bearer <key>
 *
 * Dependencies:
 *   - ingestion-jobs schema (ingestion_jobs + ingestion_items tables)
 *   - upsert_thought RPC
 *   - match_thoughts RPC
 *   - append_thought_evidence RPC
 */

import { createClient } from "npm:@supabase/supabase-js@2";

// ── Environment ─────────────────────────────────────────────────────────────

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY =
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const MCP_ACCESS_KEY = Deno.env.get("MCP_ACCESS_KEY") ?? "";
const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY") ?? "";
const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY") ?? "";
const OPENROUTER_API_KEY = Deno.env.get("OPENROUTER_API_KEY") ?? "";

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// ── Constants ───────────────────────────────────────────────────────────────

const ANTHROPIC_MODEL = "claude-3-5-haiku-20241022";
const CHUNK_WORD_LIMIT = 5000;
const SEMANTIC_SKIP_THRESHOLD = 0.92;
const SEMANTIC_MATCH_THRESHOLD = 0.85;
const MAX_THOUGHTS_PER_EXTRACTION = 20;

/** OpenAI embedding model. */
const EMBEDDING_MODEL = "text-embedding-3-small";

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, x-brain-key",
  "Content-Type": "application/json",
};

const EXTRACTION_SYSTEM_PROMPT = [
  "You extract atomic, self-contained thoughts from documents.",
  'Return a JSON array of objects: [{"content": "...", "type": "idea|task|decision|lesson|reference|meeting|journal|person_note"}]',
  "Each thought should be a single, standalone insight that makes sense without the original document.",
  "Extract 1-20 thoughts depending on document length. Quality over quantity.",
  "Do NOT extract generic facts or filler. Focus on personal decisions, lessons, insights, and action items.",
  "Return ONLY the JSON array — no markdown fences, no commentary.",
].join("\n");

// ── Types ───────────────────────────────────────────────────────────────────

type ReconcileAction = "add" | "skip" | "append_evidence" | "create_revision";

interface ExtractedThought {
  content: string;
  type: string;
}

interface IngestionItem {
  content: string;
  type: string;
  content_fingerprint: string;
  action: ReconcileAction;
  reason: string;
  matched_thought_id: string | null;
  similarity_score: number | null;
  status: "pending" | "executed" | "failed";
  error_message: string | null;
}

// ── Auth ────────────────────────────────────────────────────────────────────

function isAuthorized(req: Request): boolean {
  const key =
    req.headers.get("x-brain-key")?.trim() ||
    (req.headers.get("authorization") ?? "")
      .replace(/^Bearer\s+/i, "")
      .trim();
  return key === MCP_ACCESS_KEY;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: CORS_HEADERS,
  });
}

async function computeHash(text: string): Promise<string> {
  const data = new TextEncoder().encode(text);
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
  "idea",
  "task",
  "person_note",
  "reference",
  "decision",
  "lesson",
  "meeting",
  "journal",
]);

function sanitizeType(t: unknown): string {
  const s = typeof t === "string" ? t.trim().toLowerCase() : "";
  return ALLOWED_TYPES.has(s) ? s : "reference";
}

// ── Fingerprint (matches content-fingerprint-dedup primitive) ───────────────

function normalizeForFingerprint(content: string): string {
  let s = content.trim().replace(/\s+/g, " ").toLowerCase();
  if (!s) return "";
  s = s.replace(/[.!?;:,]+$/, "");
  s = s.replace(/['\u2019]s\b/g, "");
  s = s.replace(/(\w{4,})s$/, "$1");
  return s.trim();
}

async function computeContentFingerprint(content: string): Promise<string> {
  const normalized = normalizeForFingerprint(content);
  if (!normalized) return "";
  const data = new TextEncoder().encode(normalized);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// ── Embedding ───────────────────────────────────────────────────────────────

async function embedText(text: string): Promise<number[]> {
  const truncated = text.slice(0, 8000);

  // Try OpenAI first
  if (OPENAI_API_KEY) {
    const res = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ model: EMBEDDING_MODEL, input: truncated }),
    });
    if (res.ok) {
      const data = await res.json();
      return data?.data?.[0]?.embedding ?? [];
    }
  }

  // Fall back to OpenRouter
  if (OPENROUTER_API_KEY) {
    const res = await fetch("https://openrouter.ai/api/v1/embeddings", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENROUTER_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "openai/text-embedding-3-small",
        input: truncated,
      }),
    });
    if (res.ok) {
      const data = await res.json();
      return data?.data?.[0]?.embedding ?? [];
    }
  }

  throw new Error("No embedding API key configured (OPENAI_API_KEY or OPENROUTER_API_KEY)");
}

// ── LLM Extraction ─────────────────────────────────────────────────────────

async function callAnthropic(text: string): Promise<ExtractedThought[]> {
  if (!ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY not configured");

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: ANTHROPIC_MODEL,
      max_tokens: 4096,
      temperature: 0.2,
      system: EXTRACTION_SYSTEM_PROMPT,
      messages: [{ role: "user", content: text }],
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Anthropic API error (${res.status}): ${body}`);
  }

  const result = await res.json();
  const raw = result?.content?.[0]?.text ?? "";
  return parseExtractedThoughts(raw);
}

async function callOpenAI(text: string): Promise<ExtractedThought[]> {
  if (!OPENAI_API_KEY) throw new Error("OPENAI_API_KEY not configured");

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      temperature: 0.2,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            EXTRACTION_SYSTEM_PROMPT +
            '\nWrap the array in {"thoughts": [...]}',
        },
        { role: "user", content: text },
      ],
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`OpenAI API error (${res.status}): ${body}`);
  }

  const result = await res.json();
  const raw = result?.choices?.[0]?.message?.content ?? "";
  return parseExtractedThoughts(raw);
}

async function callOpenRouter(text: string): Promise<ExtractedThought[]> {
  if (!OPENROUTER_API_KEY) throw new Error("OPENROUTER_API_KEY not configured");

  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENROUTER_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "anthropic/claude-3.5-haiku",
      temperature: 0.2,
      messages: [
        {
          role: "system",
          content:
            EXTRACTION_SYSTEM_PROMPT + "\nReturn a JSON array directly.",
        },
        { role: "user", content: text },
      ],
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`OpenRouter API error (${res.status}): ${body}`);
  }

  const result = await res.json();
  const raw = result?.choices?.[0]?.message?.content ?? "";
  return parseExtractedThoughts(raw);
}

function parseExtractedThoughts(raw: string): ExtractedThought[] {
  const cleaned = raw
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/, "")
    .trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    throw new Error(`LLM returned invalid JSON: ${cleaned.slice(0, 200)}`);
  }

  // Handle both bare arrays and {thoughts: [...]} wrappers
  const arr = Array.isArray(parsed)
    ? parsed
    : (parsed as Record<string, unknown>)?.thoughts;
  if (!Array.isArray(arr)) {
    throw new Error(`LLM returned non-array JSON: ${typeof parsed}`);
  }

  return arr
    .filter((item: unknown) => {
      if (typeof item !== "object" || item === null) return false;
      const rec = item as Record<string, unknown>;
      return typeof rec.content === "string" && rec.content.trim().length > 0;
    })
    .slice(0, MAX_THOUGHTS_PER_EXTRACTION)
    .map((item: unknown) => {
      const rec = item as Record<string, unknown>;
      return {
        content: (rec.content as string).trim(),
        type: sanitizeType(rec.type),
      };
    });
}

async function callLLM(text: string): Promise<ExtractedThought[]> {
  // Try providers in order: Anthropic → OpenAI → OpenRouter
  if (ANTHROPIC_API_KEY) {
    try {
      return await callAnthropic(text);
    } catch (err) {
      console.warn("Anthropic extraction failed:", (err as Error).message);
    }
  }
  if (OPENAI_API_KEY) {
    try {
      return await callOpenAI(text);
    } catch (err) {
      console.warn("OpenAI extraction failed:", (err as Error).message);
    }
  }
  if (OPENROUTER_API_KEY) {
    return await callOpenRouter(text);
  }
  throw new Error(
    "No LLM API key configured (ANTHROPIC_API_KEY, OPENAI_API_KEY, or OPENROUTER_API_KEY)"
  );
}

async function extractThoughts(text: string): Promise<ExtractedThought[]> {
  const words = countWords(text);
  if (words <= CHUNK_WORD_LIMIT) {
    return await callLLM(text);
  }

  const chunks = chunkText(text, CHUNK_WORD_LIMIT);
  const allThoughts: ExtractedThought[] = [];

  for (let i = 0; i < chunks.length; i++) {
    console.log(
      `Processing chunk ${i + 1}/${chunks.length} (${countWords(chunks[i])} words)`
    );
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
  jobFingerprints: Set<string>
): Promise<Omit<IngestionItem, "status" | "error_message">> {
  const base = {
    content: thought.content,
    type: thought.type,
    content_fingerprint: fingerprint,
    matched_thought_id: null as string | null,
    similarity_score: null as number | null,
  };

  // 1. Within-job dedup by fingerprint
  if (jobFingerprints.has(fingerprint)) {
    return {
      ...base,
      action: "skip" as ReconcileAction,
      reason: "duplicate_within_job",
    };
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
      matched_thought_id: String(fpMatch[0].id),
    };
  }

  // 3. Semantic similarity check via match_thoughts RPC
  const { data: matches, error: matchError } = await supabase.rpc(
    "match_thoughts",
    {
      query_embedding: embedding,
      match_threshold: SEMANTIC_MATCH_THRESHOLD,
      match_count: 5,
    }
  );

  if (matchError) {
    console.warn(
      "match_thoughts RPC failed, treating as new:",
      matchError.message
    );
    return {
      ...base,
      action: "add",
      reason: "semantic_check_failed_fallback_add",
    };
  }

  if (!matches || matches.length === 0) {
    return { ...base, action: "add", reason: "no_semantic_match" };
  }

  const topMatch = matches[0];
  const similarity = topMatch.similarity as number;
  const matchedId = String(topMatch.id);
  const existingContent = (topMatch.content ?? "") as string;

  base.matched_thought_id = matchedId;
  base.similarity_score = similarity;

  if (similarity > SEMANTIC_SKIP_THRESHOLD) {
    return { ...base, action: "skip", reason: "semantic_duplicate" };
  }

  // 0.85 - 0.92 range: decide based on content richness
  if (existingContent.length >= thought.content.length) {
    return { ...base, action: "append_evidence", reason: "existing_is_richer" };
  } else {
    return {
      ...base,
      action: "create_revision",
      reason: "new_has_more_info",
    };
  }
}

// ── Execution ───────────────────────────────────────────────────────────────

async function executeItem(
  item: IngestionItem,
  embedding: number[],
  sourceLabel: string | null,
  sourceType: string | null
): Promise<void> {
  switch (item.action) {
    case "add": {
      const { error } = await supabase.rpc("upsert_thought", {
        p_content: item.content,
        p_payload: {
          type: item.type,
          importance: 3,
          quality_score: 50,
          source_type: sourceType ?? "smart_ingest",
          embedding,
          metadata: {
            source: "smart_ingest",
            source_label: sourceLabel ?? "smart_ingest",
            extraction_type: item.type,
            captured_at: new Date().toISOString(),
          },
          content_fingerprint: item.content_fingerprint,
        },
      });
      if (error)
        throw new Error(`upsert_thought failed: ${error.message}`);
      break;
    }

    case "append_evidence": {
      if (!item.matched_thought_id)
        throw new Error("append_evidence requires matched_thought_id");
      const { error } = await supabase.rpc("append_thought_evidence", {
        p_thought_id: item.matched_thought_id,
        p_evidence: {
          source: "smart_ingest",
          source_label: sourceLabel ?? "smart_ingest",
          excerpt: item.content.slice(0, 500),
          extracted_at: new Date().toISOString(),
        },
      });
      if (error)
        throw new Error(
          `append_thought_evidence failed: ${error.message}`
        );
      break;
    }

    case "create_revision": {
      const { error } = await supabase.rpc("upsert_thought", {
        p_content: item.content,
        p_payload: {
          type: item.type,
          importance: 3,
          quality_score: 50,
          source_type: sourceType ?? "smart_ingest",
          embedding,
          metadata: {
            source: "smart_ingest",
            source_label: sourceLabel ?? "smart_ingest",
            extraction_type: item.type,
            supersedes: item.matched_thought_id,
            captured_at: new Date().toISOString(),
          },
          content_fingerprint: item.content_fingerprint,
        },
      });
      if (error)
        throw new Error(
          `upsert_thought (revision) failed: ${error.message}`
        );
      break;
    }

    case "skip":
      break;

    default:
      throw new Error(`Unknown action: ${item.action}`);
  }
}

// ── Job Persistence ─────────────────────────────────────────────────────────

async function createJob(
  inputHash: string,
  sourceLabel: string | null,
  sourceType: string | null,
  dryRun: boolean
): Promise<string | null> {
  const { data, error } = await supabase
    .from("ingestion_jobs")
    .insert({
      input_hash: inputHash,
      source_label: sourceLabel,
      status: "extracting",
      input_length: 0,
      metadata: { source_type: sourceType, dry_run: dryRun },
    })
    .select("id")
    .single();

  if (error) {
    console.error("Failed to create ingestion_jobs row:", error.message);
    return null;
  }
  return data?.id ?? null;
}

async function updateJob(
  jobId: string,
  updates: Record<string, unknown>
): Promise<boolean> {
  const { data, error } = await supabase
    .from("ingestion_jobs")
    .update(updates)
    .eq("id", jobId)
    .select("id, status")
    .maybeSingle();

  if (error) {
    console.error(`Failed to update job ${jobId}: ${error.message}`);
    return false;
  }
  if (!data) {
    console.error(`updateJob: 0 rows matched for job ${jobId}`);
    return false;
  }
  return true;
}

async function persistItems(
  jobId: string,
  items: IngestionItem[]
): Promise<string[]> {
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
    metadata: { type: item.type },
  }));

  const { data, error } = await supabase
    .from("ingestion_items")
    .insert(rows)
    .select("id");

  if (error) {
    console.error("Failed to persist ingestion_items:", error.message);
    return [];
  }
  return (data ?? []).map((row: { id: string }) => row.id);
}

// ── Tallying ────────────────────────────────────────────────────────────────

function tally(items: IngestionItem[]) {
  let added_count = 0;
  let skipped_count = 0;
  let revised_count = 0;
  let appended_count = 0;
  let failed_count = 0;

  for (const item of items) {
    if (item.status === "failed") {
      failed_count++;
      continue;
    }
    switch (item.action) {
      case "add":
        added_count++;
        break;
      case "skip":
        skipped_count++;
        break;
      case "create_revision":
        revised_count++;
        break;
      case "append_evidence":
        appended_count++;
        break;
    }
  }

  return { added_count, skipped_count, revised_count, appended_count, failed_count };
}

// ── Execute a Dry-Run Job ───────────────────────────────────────────────────

async function handleExecuteJob(req: Request): Promise<Response> {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const jobId =
    typeof body.job_id === "string" ? body.job_id : String(body.job_id ?? "");
  if (!jobId) return json({ error: "job_id is required" }, 400);

  const { data: job, error: jobErr } = await supabase
    .from("ingestion_jobs")
    .select("*")
    .eq("id", jobId)
    .single();

  if (jobErr || !job)
    return json({ error: `Job ${jobId} not found` }, 404);
  if (job.status === "complete")
    return json({ ...job, message: "Job already complete" });
  if (job.status !== "dry_run_complete")
    return json(
      {
        error: `Job status is '${job.status}', expected 'dry_run_complete'`,
      },
      400
    );

  const { data: itemRows } = await supabase
    .from("ingestion_items")
    .select("*")
    .eq("job_id", jobId)
    .order("created_at");
  const items = itemRows ?? [];

  await updateJob(jobId, { status: "executing" });

  let addedCount = 0;
  let skippedCount = 0;
  let appendedCount = 0;
  let revisedCount = 0;
  const sourceLabel = job.source_label ?? null;
  const sourceType =
    (job.metadata as Record<string, unknown>)?.source_type as string ??
    "smart_ingest";

  for (const item of items) {
    if (item.action === "skip") {
      skippedCount++;
      continue;
    }
    try {
      const fakeItem: IngestionItem = {
        content: item.extracted_content,
        type:
          ((item.metadata as Record<string, unknown>)?.type as string) ??
          "reference",
        content_fingerprint: "",
        action: item.action as ReconcileAction,
        reason: item.reason ?? "",
        matched_thought_id: item.matched_thought_id,
        similarity_score: item.similarity_score,
        status: "pending",
        error_message: null,
      };

      let embedding: number[] = [];
      try {
        embedding = await embedText(item.extracted_content);
      } catch {
        /* continue without embedding */
      }

      await executeItem(fakeItem, embedding, sourceLabel, sourceType);
      await supabase
        .from("ingestion_items")
        .update({ status: "executed" })
        .eq("id", item.id);

      if (item.action === "add") addedCount++;
      else if (item.action === "append_evidence") appendedCount++;
      else if (item.action === "create_revision") revisedCount++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await supabase
        .from("ingestion_items")
        .update({ status: "failed", error_message: msg })
        .eq("id", item.id);
    }
  }

  await updateJob(jobId, {
    status: "complete",
    added_count: addedCount,
    skipped_count: skippedCount,
    appended_count: appendedCount,
    revised_count: revisedCount,
    completed_at: new Date().toISOString(),
  });

  return json({
    job_id: jobId,
    status: "complete",
    added_count: addedCount,
    skipped_count: skippedCount,
    appended_count: appendedCount,
    revised_count: revisedCount,
  });
}

// ── Main Handler ────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  if (req.method !== "POST") {
    return json({ error: "Method not allowed. Use POST." }, 405);
  }

  if (MCP_ACCESS_KEY && !isAuthorized(req)) {
    return json({ error: "Unauthorized" }, 401);
  }

  // Route: /execute
  const url = new URL(req.url);
  const path = url.pathname
    .replace(/^\/smart-ingest/, "")
    .replace(/\/+$/, "") || "/";
  if (path === "/execute") {
    return await handleExecuteJob(req);
  }

  // Default route: extract and reconcile
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const text = typeof body.text === "string" ? body.text.trim() : "";
  if (!text) return json({ error: "Missing or empty 'text' field" }, 400);

  const sourceLabel =
    typeof body.source_label === "string" ? body.source_label.trim() : null;
  const sourceType =
    typeof body.source_type === "string" ? body.source_type.trim() : null;
  const dryRun = body.dry_run === true;
  const reprocess = body.reprocess === true;

  const baseHash = await computeHash(text);
  let inputHash = baseHash;

  // Idempotency check
  const { data: existing } = await supabase
    .from("ingestion_jobs")
    .select("*")
    .eq("input_hash", baseHash)
    .order("created_at", { ascending: false })
    .limit(1);

  if (existing && existing.length > 0 && !reprocess) {
    return json({
      status: "existing",
      job_id: existing[0].id,
      ...existing[0],
      message:
        "Identical input already processed. Set reprocess=true to run again.",
    });
  }

  if (existing && existing.length > 0 && reprocess) {
    // Version the hash for reprocessing
    const { data: versions } = await supabase
      .from("ingestion_jobs")
      .select("input_hash")
      .like("input_hash", `${baseHash}%`)
      .order("created_at", { ascending: false })
      .limit(1);

    if (versions && versions.length > 0) {
      const latest = versions[0].input_hash as string;
      const versionMatch = latest.match(/-v(\d+)$/);
      inputHash = versionMatch
        ? `${baseHash}-v${parseInt(versionMatch[1], 10) + 1}`
        : `${baseHash}-v2`;
    }
  }

  const jobId = await createJob(inputHash, sourceLabel, sourceType, dryRun);

  // Extract thoughts
  let extractedThoughts: ExtractedThought[];
  try {
    extractedThoughts = await extractThoughts(text);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (jobId) await updateJob(jobId, { status: "failed", error_message: msg });
    return json({ error: "Extraction failed", detail: msg }, 500);
  }

  if (extractedThoughts.length === 0) {
    if (jobId)
      await updateJob(jobId, { status: "complete", extracted_count: 0 });
    return json({
      status: "complete",
      job_id: jobId,
      extracted_count: 0,
      message: "No thoughts extracted.",
    });
  }

  // Reconcile each thought
  const jobFingerprints = new Set<string>();
  const items: IngestionItem[] = [];
  const embeddings: number[][] = [];

  for (const thought of extractedThoughts) {
    try {
      const fingerprint = await computeContentFingerprint(thought.content);
      const embedding = await embedText(thought.content);
      const reconciled = await reconcileThought(
        thought,
        embedding,
        fingerprint,
        jobFingerprints
      );
      jobFingerprints.add(fingerprint);
      items.push({ ...reconciled, status: "pending", error_message: null });
      embeddings.push(embedding);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      items.push({
        content: thought.content,
        type: thought.type,
        content_fingerprint: "",
        action: "skip",
        reason: `reconciliation_error: ${msg}`,
        matched_thought_id: null,
        similarity_score: null,
        status: "failed",
        error_message: msg,
      });
      embeddings.push([]);
    }
  }

  // Persist items
  let itemIds: string[] = [];
  if (jobId) itemIds = await persistItems(jobId, items);

  // Dry-run: save results and return
  if (dryRun) {
    const counts = tally(items);
    if (jobId) {
      const { failed_count: _, ...dbCounts } = counts;
      await updateJob(jobId, {
        status: "dry_run_complete",
        extracted_count: items.length,
        ...dbCounts,
      });
    }
    return json({
      status: "dry_run_complete",
      job_id: jobId,
      extracted_count: items.length,
      ...counts,
      message: `Dry run: ${items.length} extracted. Would add ${counts.added_count}, skip ${counts.skipped_count}.`,
    });
  }

  // Immediate execution
  if (jobId) await updateJob(jobId, { status: "executing" });

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const itemDbId = itemIds[i] ?? "";

    if (item.action === "skip") {
      item.status = "executed";
      if (itemDbId)
        await supabase
          .from("ingestion_items")
          .update({ status: "executed" })
          .eq("id", itemDbId);
      continue;
    }

    try {
      await executeItem(item, embeddings[i], sourceLabel, sourceType);
      item.status = "executed";
      if (itemDbId)
        await supabase
          .from("ingestion_items")
          .update({ status: "executed" })
          .eq("id", itemDbId);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      item.status = "failed";
      item.error_message = msg;
      if (itemDbId)
        await supabase
          .from("ingestion_items")
          .update({ status: "failed", error_message: msg })
          .eq("id", itemDbId);
    }
  }

  const counts = tally(items);
  const { failed_count: _fc, ...dbCounts } = counts;
  if (jobId)
    await updateJob(jobId, {
      status: "complete",
      extracted_count: items.length,
      ...dbCounts,
      completed_at: new Date().toISOString(),
    });

  return json({
    status: "complete",
    job_id: jobId,
    extracted_count: items.length,
    ...counts,
    message: `Ingestion complete. Added ${counts.added_count}, skipped ${counts.skipped_count}.`,
  });
});
