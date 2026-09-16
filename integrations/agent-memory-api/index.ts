import "jsr:@supabase/functions-js/edge-runtime.d.ts";

import { Hono } from "hono";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const OPENROUTER_API_KEY = Deno.env.get("OPENROUTER_API_KEY")!;
const MCP_ACCESS_KEY = Deno.env.get("MCP_ACCESS_KEY")!;
const OPENROUTER_BASE = "https://openrouter.ai/api/v1";

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-brain-key",
  "Access-Control-Allow-Methods": "GET, POST, PATCH, OPTIONS",
};

const runtimeSchema = z.object({
  name: z.string().default("unknown"),
  version: z.string().nullable().optional(),
});

const channelSchema = z.object({
  kind: z.string().nullable().optional(),
  id: z.string().nullable().optional(),
  thread_id: z.string().nullable().optional(),
});

const recallSchemaVersion = z.union([
  z.literal("openbrain.agent_memory.recall.v1"),
  z.literal("openbrain.openclaw.recall.v1"),
]);

const writebackSchemaVersion = z.union([
  z.literal("openbrain.agent_memory.writeback.v1"),
  z.literal("openbrain.openclaw.writeback.v1"),
]);

const recallSchema = z.object({
  schema_version: recallSchemaVersion,
  workspace_id: z.string().min(1),
  project_id: z.string().nullable().optional(),
  task_id: z.string().nullable().optional(),
  flow_id: z.string().nullable().optional(),
  task_type: z.string().nullable().optional(),
  channel: channelSchema.default({}),
  runtime: runtimeSchema.default({ name: "unknown" }),
  model_intent: z.object({
    provider: z.string().nullable().optional(),
    model: z.string().nullable().optional(),
  }).default({}),
  query: z.string().min(1),
  entities: z.record(z.string(), z.array(z.string())).default({}),
  scope: z.object({
    visibility: z.string().nullable().optional(),
    project_only: z.boolean().default(true),
    include_unconfirmed: z.boolean().default(false),
    include_stale: z.boolean().default(false),
  }).default({ project_only: true, include_unconfirmed: false, include_stale: false }),
  limits: z.object({
    max_items: z.number().int().min(1).max(50).default(10),
    max_tokens: z.number().int().min(256).max(20000).default(4000),
    recency_days: z.number().int().positive().nullable().optional(),
  }).default({ max_items: 10, max_tokens: 4000 }),
  sensitivity: z.record(z.string(), z.boolean()).default({}),
});

const memoryPayloadSchema = z.object({
  decisions: z.array(z.string()).default([]),
  outputs: z.array(z.string()).default([]),
  lessons: z.array(z.string()).default([]),
  constraints: z.array(z.string()).default([]),
  unresolved_questions: z.array(z.string()).default([]),
  next_steps: z.array(z.string()).default([]),
  failures: z.array(z.string()).default([]),
  artifacts: z.array(z.object({
    kind: z.string(),
    uri: z.string(),
    description: z.string().nullable().optional(),
  })).default([]),
  entities: z.record(z.string(), z.array(z.string())).default({}),
});

const writebackSchema = z.object({
  schema_version: writebackSchemaVersion,
  workspace_id: z.string().min(1),
  project_id: z.string().nullable().optional(),
  task_id: z.string().nullable().optional(),
  flow_id: z.string().nullable().optional(),
  step_id: z.string().nullable().optional(),
  idempotency_key: z.string().nullable().optional(),
  content_hash: z.string().nullable().optional(),
  channel: channelSchema.default({}),
  runtime: runtimeSchema.default({ name: "unknown" }),
  models_used: z.array(z.object({
    provider: z.string(),
    model: z.string(),
    role: z.string(),
  })).default([]),
  source_refs: z.array(z.object({
    kind: z.string(),
    uri: z.string().nullable().optional(),
    title: z.string().nullable().optional(),
    timestamp: z.string().nullable().optional(),
  })).default([]),
  memory_payload: memoryPayloadSchema,
  provenance: z.object({
    default_status: z.enum(["observed", "inferred", "user_confirmed", "imported", "generated"]).default("generated"),
    confidence: z.number().min(0).max(1).default(0.5),
    requires_review: z.boolean().default(true),
  }).default({ default_status: "generated", confidence: 0.5, requires_review: true }),
  retention: z.object({
    ttl_days: z.number().int().positive().nullable().optional(),
    stale_after_days: z.number().int().positive().nullable().optional(),
  }).default({}),
  visibility: z.object({
    workspace: z.string().nullable().optional(),
    project: z.string().nullable().optional(),
    channel: z.string().nullable().optional(),
  }).default({}),
});

const usageSchema = z.object({
  used_memory_ids: z.array(z.string()).default([]),
  ignored: z.array(z.object({
    memory_id: z.string(),
    reason: z.string().optional(),
  })).default([]),
});

const reviewSchema = z.object({
  action: z.enum(["confirm", "edit", "evidence_only", "restrict_scope", "mark_stale", "merge", "reject", "dispute", "supersede"]),
  actor_id: z.string().nullable().optional(),
  actor_label: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  content: z.string().optional(),
  summary: z.string().optional(),
  visibility: z.string().optional(),
  related_memory_id: z.string().optional(),
});

type AgentMemory = {
  id: string;
  thought_id: string | null;
  workspace_id: string;
  project_id: string | null;
  channel_id: string | null;
  visibility: string;
  memory_type: string;
  summary: string;
  content: string;
  lifecycle_status: string;
  provenance_status: string;
  confidence: number;
  created_by: string;
  runtime_name: string | null;
  runtime_version: string | null;
  provider: string | null;
  model: string | null;
  task_id: string | null;
  flow_id: string | null;
  can_use_as_instruction: boolean;
  can_use_as_evidence: boolean;
  requires_user_confirmation: boolean;
  review_status: string;
  last_confirmed_at: string | null;
  stale_after: string | null;
  created_at: string;
  metadata: Record<string, unknown>;
  similarity?: number;
};

async function sha256Hex(text: string): Promise<string> {
  const data = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function getEmbedding(text: string): Promise<number[]> {
  const r = await fetch(`${OPENROUTER_BASE}/embeddings`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENROUTER_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "openai/text-embedding-3-small",
      input: text,
    }),
  });
  if (!r.ok) throw new Error(`OpenRouter embeddings failed: ${r.status} ${await r.text()}`);
  const d = await r.json();
  return d.data[0].embedding;
}

function auth(c: { req: { header: (name: string) => string | undefined; url: string } }) {
  const provided = c.req.header("x-brain-key") || new URL(c.req.url).searchParams.get("key");
  return provided && provided === MCP_ACCESS_KEY;
}

function unsafeReasons(text: string): string[] {
  const reasons: string[] = [];
  if (/-----BEGIN (?:RSA |OPENSSH |EC |DSA )?PRIVATE KEY-----/.test(text)) reasons.push("private_key");
  if (/(?:sk-[A-Za-z0-9_-]{20,}|sk-or-v1-[A-Za-z0-9_-]{20,})/.test(text)) reasons.push("api_key");
  if (/(?:password|passwd|secret|token)\s*[:=]\s*\S{12,}/i.test(text)) reasons.push("credential_like_string");
  if ((text.match(/```/g) || []).length >= 4 || text.split("\n").filter((l) => l.length > 120).length > 20) reasons.push("large_code_block");
  if (text.length > 15000 || text.split("\n").filter((l) => /^(user|assistant|system|agent|human):/i.test(l.trim())).length > 8) reasons.push("raw_transcript_like");
  return reasons;
}

function staleAfter(days?: number | null): string | null {
  if (!days) return null;
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString();
}

function memoryRows(payload: z.infer<typeof writebackSchema>) {
  const p = payload.memory_payload;
  const rows: { memory_type: string; content: string }[] = [];
  for (const content of p.decisions) rows.push({ memory_type: "decision", content });
  for (const content of p.outputs) rows.push({ memory_type: "output", content });
  for (const content of p.lessons) rows.push({ memory_type: "lesson", content });
  for (const content of p.constraints) rows.push({ memory_type: "constraint", content });
  for (const content of p.unresolved_questions) rows.push({ memory_type: "open_question", content });
  for (const content of p.next_steps) rows.push({ memory_type: "work_log", content: `Next step: ${content}` });
  for (const content of p.failures) rows.push({ memory_type: "failure", content });
  for (const artifact of p.artifacts) {
    rows.push({
      memory_type: "artifact_reference",
      content: `${artifact.kind}: ${artifact.description || artifact.uri}\n${artifact.uri}`,
    });
  }
  return rows;
}

function scopeMatches(memory: AgentMemory, req: z.infer<typeof recallSchema>): boolean {
  if (memory.workspace_id !== req.workspace_id) return false;
  if (req.scope.project_only && req.project_id && memory.project_id !== req.project_id) return false;
  if (!req.scope.include_stale && ["stale", "superseded", "rejected", "disputed"].includes(memory.lifecycle_status)) return false;
  if (!req.scope.include_unconfirmed && memory.requires_user_confirmation && memory.review_status === "pending") return false;
  if (memory.visibility === "personal" && req.scope.visibility !== "personal") return false;
  return true;
}

function rankMemory(memory: AgentMemory, similarity = 0): number {
  const provenance = memory.provenance_status === "user_confirmed" ? 0.3
    : memory.provenance_status === "imported" ? 0.22
    : memory.provenance_status === "observed" ? 0.15
    : memory.provenance_status === "generated" ? 0.05
    : 0;
  const policy = memory.can_use_as_instruction ? 0.2 : memory.can_use_as_evidence ? 0.08 : -0.2;
  const review = memory.review_status === "confirmed" ? 0.15
    : memory.review_status === "evidence_only" ? 0.05
    : memory.review_status === "pending" ? -0.08
    : -0.25;
  return similarity + provenance + policy + review + Number(memory.confidence || 0) * 0.15;
}

function responseMemory(memory: AgentMemory) {
  return {
    memory_id: memory.id,
    summary: memory.summary,
    content: memory.content,
    source: {
      kind: "agent_memory",
      uri: null,
      title: memory.summary,
      timestamp: memory.created_at,
    },
    provenance: {
      status: memory.provenance_status,
      confidence: Number(memory.confidence),
      created_by: memory.created_by,
      model: memory.model,
      runtime: memory.runtime_name,
    },
    scope: {
      workspace_id: memory.workspace_id,
      project_id: memory.project_id,
      channel_id: memory.channel_id,
      visibility: memory.visibility,
    },
    use_policy: {
      can_use_as_instruction: memory.can_use_as_instruction,
      can_use_as_evidence: memory.can_use_as_evidence,
      requires_user_confirmation: memory.requires_user_confirmation,
    },
    freshness: {
      created_at: memory.created_at,
      last_confirmed_at: memory.last_confirmed_at,
      stale_after: memory.stale_after,
    },
    related_artifacts: [],
  };
}

function recallResponseSchema(reqSchemaVersion: string) {
  return reqSchemaVersion === "openbrain.openclaw.recall.v1"
    ? "openbrain.openclaw.recall_response.v1"
    : "openbrain.agent_memory.recall_response.v1";
}

function writebackResponseSchema(reqSchemaVersion: string) {
  return reqSchemaVersion === "openbrain.openclaw.writeback.v1"
    ? "openbrain.openclaw.writeback_response.v1"
    : "openbrain.agent_memory.writeback_response.v1";
}

async function audit(event_type: string, payload: Record<string, unknown>) {
  await supabase.from("agent_memory_audit_events").insert({
    event_type,
    workspace_id: payload.workspace_id ?? null,
    project_id: payload.project_id ?? null,
    memory_id: payload.memory_id ?? null,
    trace_id: payload.trace_id ?? null,
    actor_kind: payload.actor_kind ?? "system",
    actor_label: payload.actor_label ?? null,
    runtime_name: payload.runtime_name ?? null,
    task_id: payload.task_id ?? null,
    payload,
  });
}

const app = new Hono();

app.options("*", (c) => c.text("ok", 200, corsHeaders));

app.use("*", async (c, next) => {
  if (!auth(c)) return c.json({ error: "Invalid or missing access key" }, 401, corsHeaders);
  await next();
});

app.get("/health", (c) => c.json({ ok: true, service: "agent-memory-api", version: "0.1.0" }, 200, corsHeaders));

app.post("/recall", async (c) => {
  const parsed = recallSchema.safeParse(await c.req.json());
  if (!parsed.success) return c.json({ error: "Invalid recall payload", details: parsed.error.flatten() }, 400, corsHeaders);
  const req = parsed.data;

  const embedding = await getEmbedding(req.query);
  const { data: matches, error: matchError } = await supabase.rpc("match_thoughts", {
    query_embedding: embedding,
    match_threshold: 0.25,
    match_count: Math.max(req.limits.max_items * 4, 20),
    filter: {},
  });
  if (matchError) return c.json({ error: matchError.message }, 500, corsHeaders);

  const similarityByThought = new Map<string, number>();
  for (const item of matches || []) similarityByThought.set(item.id, item.similarity);
  const thoughtIds = Array.from(similarityByThought.keys());

  let memoryQuery = supabase
    .from("agent_memories")
    .select("*")
    .eq("workspace_id", req.workspace_id)
    .order("created_at", { ascending: false })
    .limit(100);
  if (thoughtIds.length > 0) memoryQuery = memoryQuery.in("thought_id", thoughtIds);

  const { data: rawMemories, error: memoryError } = await memoryQuery;
  if (memoryError) return c.json({ error: memoryError.message }, 500, corsHeaders);

  const ranked = ((rawMemories || []) as AgentMemory[])
    .filter((m) => scopeMatches(m, req))
    .map((m) => {
      const similarity = similarityByThought.get(m.thought_id || "") || 0;
      return { ...m, similarity, ranking_score: rankMemory(m, similarity) };
    })
    .sort((a, b) => b.ranking_score - a.ranking_score)
    .slice(0, req.limits.max_items);

  const { data: trace, error: traceError } = await supabase.from("agent_memory_recall_traces").insert({
    workspace_id: req.workspace_id,
    project_id: req.project_id ?? null,
    runtime_name: req.runtime.name,
    runtime_version: req.runtime.version ?? null,
    task_id: req.task_id ?? null,
    flow_id: req.flow_id ?? null,
    channel_kind: req.channel.kind ?? null,
    channel_id: req.channel.id ?? null,
    query: req.query,
    schema_version: req.schema_version,
    request_payload: req,
    response_policy: { max_items: req.limits.max_items, include_unconfirmed: req.scope.include_unconfirmed },
  }).select("*").single();
  if (traceError) return c.json({ error: traceError.message }, 500, corsHeaders);

  if (ranked.length > 0) {
    await supabase.from("agent_memory_recall_items").insert(ranked.map((memory, index) => ({
      trace_id: trace.id,
      memory_id: memory.id,
      rank: index + 1,
      similarity: memory.similarity,
      ranking_score: memory.ranking_score,
      use_policy_snapshot: {
        can_use_as_instruction: memory.can_use_as_instruction,
        can_use_as_evidence: memory.can_use_as_evidence,
        requires_user_confirmation: memory.requires_user_confirmation,
      },
    })));
  }

  await audit("recall_requested", {
    workspace_id: req.workspace_id,
    project_id: req.project_id,
    trace_id: trace.id,
    runtime_name: req.runtime.name,
    task_id: req.task_id,
    returned_count: ranked.length,
  });

  return c.json({
    schema_version: recallResponseSchema(req.schema_version),
    request_id: trace.request_id,
    memories: ranked.map(responseMemory),
  }, 200, corsHeaders);
});

app.post("/writeback", async (c) => {
  const parsed = writebackSchema.safeParse(await c.req.json());
  if (!parsed.success) return c.json({ error: "Invalid write-back payload", details: parsed.error.flatten() }, 400, corsHeaders);
  const req = parsed.data;
  const rows = memoryRows(req);
  if (rows.length === 0) return c.json({ error: "memory_payload produced no memory rows" }, 400, corsHeaders);

  const unsafe = rows.flatMap((row) => unsafeReasons(row.content).map((reason) => ({ reason, memory_type: row.memory_type })));
  if (unsafe.length > 0) {
    await audit("memory_rejected", {
      workspace_id: req.workspace_id,
      project_id: req.project_id,
      runtime_name: req.runtime.name,
      task_id: req.task_id,
      actor_kind: "system",
      reason: "unsafe_writeback",
      unsafe,
    });
    return c.json({ error: "Unsafe write-back blocked", unsafe }, 422, corsHeaders);
  }

  const created = [];
  const provider = req.models_used[0]?.provider ?? null;
  const model = req.models_used[0]?.model ?? null;
  const defaultInstruction = ["user_confirmed", "imported"].includes(req.provenance.default_status) && !req.provenance.requires_review;

  for (const [index, row] of rows.entries()) {
    const content_hash = await sha256Hex(`${row.memory_type}:${row.content}`);
    const baseKey = req.idempotency_key || `${req.workspace_id}:${req.runtime.name}:${req.task_id || "taskless"}:${req.step_id || "step"}:${content_hash}`;
    const idempotency_key = `${baseKey}:${index}`;

    const { data: existing } = await supabase
      .from("agent_memories")
      .select("*")
      .eq("idempotency_key", idempotency_key)
      .maybeSingle();
    if (existing) {
      created.push(existing);
      continue;
    }

    const embedding = await getEmbedding(row.content);
    const { data: upsertResult, error: upsertError } = await supabase.rpc("upsert_thought", {
      p_content: row.content,
      p_payload: {
        metadata: {
          source: "agent_memory",
          source_type: "agent_memory",
          type: row.memory_type,
          topics: req.memory_payload.entities.topics || [],
          people: req.memory_payload.entities.people || [],
          agent_memory: {
            runtime: req.runtime.name,
            task_id: req.task_id,
            flow_id: req.flow_id,
            provenance_status: req.provenance.default_status,
          },
        },
      },
    });
    if (upsertError) return c.json({ error: upsertError.message }, 500, corsHeaders);

    const thoughtId = upsertResult?.id;
    if (thoughtId) await supabase.from("thoughts").update({ embedding }).eq("id", thoughtId);

    const { data: memory, error: memoryError } = await supabase.from("agent_memories").insert({
      thought_id: thoughtId ?? null,
      workspace_id: req.workspace_id,
      project_id: req.project_id ?? null,
      channel_kind: req.channel.kind ?? null,
      channel_id: req.channel.id ?? null,
      channel_thread_id: req.channel.thread_id ?? null,
      visibility: req.project_id ? "project" : "personal",
      memory_type: row.memory_type,
      summary: row.content.replace(/\s+/g, " ").slice(0, 140),
      content: row.content,
      provenance_status: req.provenance.default_status,
      confidence: req.provenance.confidence,
      created_by: req.provenance.default_status === "imported" ? "import" : "agent",
      runtime_name: req.runtime.name,
      runtime_version: req.runtime.version ?? null,
      provider,
      model,
      task_id: req.task_id ?? null,
      flow_id: req.flow_id ?? null,
      can_use_as_instruction: defaultInstruction,
      can_use_as_evidence: true,
      requires_user_confirmation: !defaultInstruction,
      review_status: defaultInstruction ? "confirmed" : "pending",
      last_confirmed_at: defaultInstruction ? new Date().toISOString() : null,
      stale_after: staleAfter(req.retention.stale_after_days),
      idempotency_key,
      content_hash,
      metadata: {
        source_refs: req.source_refs,
        models_used: req.models_used,
        retention: req.retention,
        writeback_schema_version: req.schema_version,
      },
    }).select("*").single();
    if (memoryError) return c.json({ error: memoryError.message }, 500, corsHeaders);

    if (req.source_refs.length > 0) {
      await supabase.from("agent_memory_source_refs").insert(req.source_refs.map((source) => ({
        memory_id: memory.id,
        source_kind: source.kind,
        uri: source.uri ?? null,
        title: source.title ?? null,
        source_timestamp: source.timestamp ?? null,
      })));
    }

    if (row.memory_type === "artifact_reference") {
      for (const artifact of req.memory_payload.artifacts) {
        await supabase.from("agent_memory_artifacts").insert({
          memory_id: memory.id,
          artifact_kind: artifact.kind,
          uri: artifact.uri,
          description: artifact.description ?? null,
        });
      }
    }

    await audit("memory_written", {
      workspace_id: req.workspace_id,
      project_id: req.project_id,
      memory_id: memory.id,
      runtime_name: req.runtime.name,
      task_id: req.task_id,
      actor_kind: "agent",
      provenance_status: req.provenance.default_status,
      review_status: memory.review_status,
    });
    created.push(memory);
  }

  return c.json({ schema_version: writebackResponseSchema(req.schema_version), memories: created.map(responseMemory) }, 200, corsHeaders);
});

app.post("/recall/:request_id/usage", async (c) => {
  const request_id = c.req.param("request_id");
  const parsed = usageSchema.safeParse(await c.req.json());
  if (!parsed.success) return c.json({ error: "Invalid usage payload", details: parsed.error.flatten() }, 400, corsHeaders);

  const { data: trace, error } = await supabase.from("agent_memory_recall_traces").select("*").eq("request_id", request_id).single();
  if (error) return c.json({ error: error.message }, 404, corsHeaders);

  for (const memory_id of parsed.data.used_memory_ids) {
    await supabase.from("agent_memory_recall_items").update({ used: true }).eq("trace_id", trace.id).eq("memory_id", memory_id);
    await audit("memory_used", { workspace_id: trace.workspace_id, project_id: trace.project_id, trace_id: trace.id, memory_id, runtime_name: trace.runtime_name, task_id: trace.task_id });
  }
  for (const ignored of parsed.data.ignored) {
    await supabase.from("agent_memory_recall_items").update({ used: false, ignored_reason: ignored.reason ?? null }).eq("trace_id", trace.id).eq("memory_id", ignored.memory_id);
    await audit("memory_ignored", { workspace_id: trace.workspace_id, project_id: trace.project_id, trace_id: trace.id, memory_id: ignored.memory_id, reason: ignored.reason });
  }

  return c.json({ ok: true }, 200, corsHeaders);
});

app.get("/memories/review", async (c) => {
  const workspace_id = c.req.query("workspace_id");
  if (!workspace_id) return c.json({ error: "workspace_id is required" }, 400, corsHeaders);
  const project_id = c.req.query("project_id");
  let q = supabase.from("agent_memories").select("*").eq("workspace_id", workspace_id).eq("review_status", "pending").order("created_at", { ascending: false }).limit(100);
  if (project_id) q = q.eq("project_id", project_id);
  const { data, error } = await q;
  if (error) return c.json({ error: error.message }, 500, corsHeaders);
  return c.json({ memories: (data || []).map(responseMemory) }, 200, corsHeaders);
});

app.get("/memories", async (c) => {
  const workspace_id = c.req.query("workspace_id");
  if (!workspace_id) return c.json({ error: "workspace_id is required" }, 400, corsHeaders);

  const limit = Math.min(Math.max(parseInt(c.req.query("limit") || "50", 10), 1), 200);
  let q = supabase
    .from("agent_memories")
    .select("*")
    .eq("workspace_id", workspace_id)
    .order("created_at", { ascending: false })
    .limit(limit);

  const project_id = c.req.query("project_id");
  const review_status = c.req.query("review_status");
  const lifecycle_status = c.req.query("lifecycle_status");
  const runtime_name = c.req.query("runtime_name");
  const memory_type = c.req.query("memory_type");
  const task_id_prefix = c.req.query("task_id_prefix");

  if (project_id) q = q.eq("project_id", project_id);
  if (review_status) q = q.eq("review_status", review_status);
  if (lifecycle_status) q = q.eq("lifecycle_status", lifecycle_status);
  if (runtime_name) q = q.eq("runtime_name", runtime_name);
  if (memory_type) q = q.eq("memory_type", memory_type);
  if (task_id_prefix) q = q.like("task_id", `${task_id_prefix}%`);

  const { data, error } = await q;
  if (error) return c.json({ error: error.message }, 500, corsHeaders);
  return c.json({ memories: (data || []).map(responseMemory), count: data?.length || 0 }, 200, corsHeaders);
});

app.get("/memories/:id", async (c) => {
  const id = c.req.param("id");
  const { data, error } = await supabase.from("agent_memories").select("*, agent_memory_source_refs(*), agent_memory_artifacts(*)").eq("id", id).single();
  if (error) return c.json({ error: error.message }, 404, corsHeaders);
  return c.json({ memory: data }, 200, corsHeaders);
});

app.patch("/memories/:id/review", async (c) => {
  const id = c.req.param("id");
  const parsed = reviewSchema.safeParse(await c.req.json());
  if (!parsed.success) return c.json({ error: "Invalid review payload", details: parsed.error.flatten() }, 400, corsHeaders);
  const req = parsed.data;

  const { data: before, error: beforeError } = await supabase.from("agent_memories").select("*").eq("id", id).single();
  if (beforeError) return c.json({ error: beforeError.message }, 404, corsHeaders);

  const updates: Record<string, unknown> = {};
  if (req.action === "confirm") {
    updates.review_status = "confirmed";
    updates.provenance_status = "user_confirmed";
    updates.can_use_as_instruction = true;
    updates.requires_user_confirmation = false;
    updates.last_confirmed_at = new Date().toISOString();
  } else if (req.action === "evidence_only") {
    updates.review_status = "evidence_only";
    updates.can_use_as_instruction = false;
    updates.can_use_as_evidence = true;
    updates.requires_user_confirmation = false;
  } else if (req.action === "reject") {
    updates.review_status = "rejected";
    updates.lifecycle_status = "rejected";
    updates.can_use_as_instruction = false;
    updates.can_use_as_evidence = false;
  } else if (req.action === "mark_stale") {
    updates.review_status = "stale";
    updates.lifecycle_status = "stale";
    updates.can_use_as_instruction = false;
  } else if (req.action === "dispute") {
    updates.lifecycle_status = "disputed";
    updates.provenance_status = "disputed";
    updates.can_use_as_instruction = false;
  } else if (req.action === "restrict_scope") {
    updates.review_status = "restricted";
    updates.visibility = req.visibility || "personal";
  } else if (req.action === "edit") {
    if (req.content) updates.content = req.content;
    if (req.summary) updates.summary = req.summary;
  }

  const { data: after, error: updateError } = await supabase.from("agent_memories").update(updates).eq("id", id).select("*").single();
  if (updateError) return c.json({ error: updateError.message }, 500, corsHeaders);

  await supabase.from("agent_memory_review_actions").insert({
    memory_id: id,
    action: req.action,
    actor_id: req.actor_id ?? null,
    actor_label: req.actor_label ?? null,
    notes: req.notes ?? null,
    before,
    after,
  });

  if (req.related_memory_id && ["merge", "supersede"].includes(req.action)) {
    await supabase.from("agent_memory_relations").insert({
      from_memory_id: id,
      to_memory_id: req.related_memory_id,
      relation: req.action === "merge" ? "merged_into" : "supersedes",
      confidence: 1,
    });
  }

  const eventMap: Record<string, string> = {
    confirm: "memory_confirmed",
    edit: "memory_edited",
    reject: "memory_rejected",
    supersede: "memory_superseded",
    dispute: "memory_disputed",
  };
  await audit(eventMap[req.action] || "memory_edited", {
    workspace_id: before.workspace_id,
    project_id: before.project_id,
    memory_id: id,
    actor_kind: "user",
    actor_label: req.actor_label,
    action: req.action,
  });

  return c.json({ memory: after }, 200, corsHeaders);
});

app.get("/recall-traces/:request_id", async (c) => {
  const request_id = c.req.param("request_id");
  const { data: trace, error } = await supabase.from("agent_memory_recall_traces").select("*").eq("request_id", request_id).single();
  if (error) return c.json({ error: error.message }, 404, corsHeaders);
  const { data: items, error: itemError } = await supabase.from("agent_memory_recall_items").select("*, agent_memories(*)").eq("trace_id", trace.id).order("rank");
  if (itemError) return c.json({ error: itemError.message }, 500, corsHeaders);
  return c.json({ trace, items }, 200, corsHeaders);
});

Deno.serve((req) => {
  const url = new URL(req.url);
  if (url.pathname === "/agent-memory-api") {
    url.pathname = "/";
  } else if (url.pathname.startsWith("/agent-memory-api/")) {
    url.pathname = url.pathname.slice("/agent-memory-api".length);
  }
  return app.fetch(new Request(url, req));
});
