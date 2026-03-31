// Slack Capture — Supabase Edge Function for Open Brain
// Receives Slack Events API webhooks, verifies signatures, and stores
// messages as thoughts via the upsert_thought RPC.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type SlackEvent = {
  type?: string;
  subtype?: string;
  text?: string;
  channel?: string;
  channel_type?: string;
  user?: string;
  bot_id?: string;
  ts?: string;
  thread_ts?: string;
};

type SlackEnvelope = {
  token?: string;
  team_id?: string;
  api_app_id?: string;
  type?: string;
  challenge?: string;
  event_id?: string;
  event_time?: number;
  event?: SlackEvent;
};

type ThoughtMetadata = {
  type: string;
  summary: string;
  topics: string[];
  tags: string[];
  people: string[];
  action_items: string[];
  confidence: number;
};

// ---------------------------------------------------------------------------
// Environment
// ---------------------------------------------------------------------------

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const OPENROUTER_API_KEY = Deno.env.get("OPENROUTER_API_KEY") ?? "";
const SLACK_SIGNING_SECRET = Deno.env.get("SLACK_SIGNING_SECRET") ?? "";
const SLACK_CAPTURE_CHANNEL_ID = (Deno.env.get("SLACK_CAPTURE_CHANNEL_ID") ?? "").trim();

const OPENROUTER_BASE = "https://openrouter.ai/api/v1";
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

Deno.serve(async (req) => {
  // CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: corsHeaders(),
    });
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  if (!SLACK_SIGNING_SECRET) {
    console.error("SLACK_SIGNING_SECRET is not configured");
    return jsonResponse({ error: "Server misconfiguration" }, 500);
  }

  // Read raw body once — needed for both signature verification and parsing
  const rawBody = await req.text();

  // Verify Slack request signature (HMAC-SHA256)
  const signatureValid = await verifySlackSignature(req.headers, rawBody, SLACK_SIGNING_SECRET);
  if (!signatureValid) {
    return jsonResponse({ error: "Invalid Slack signature" }, 401);
  }

  let payload: SlackEnvelope;
  try {
    payload = JSON.parse(rawBody) as SlackEnvelope;
  } catch {
    return jsonResponse({ error: "Invalid JSON payload" }, 400);
  }

  // Slack URL verification challenge (one-time during Event Subscription setup)
  if (payload.type === "url_verification") {
    return jsonResponse({ challenge: payload.challenge ?? "" });
  }

  if (payload.type !== "event_callback") {
    return jsonResponse({ ok: true, skipped: "Unsupported Slack payload type" });
  }

  if (!payload.event_id) {
    return jsonResponse({ ok: true, skipped: "Missing event_id" });
  }

  // Process asynchronously if Deno Edge Runtime supports waitUntil,
  // otherwise await inline. Either way Slack gets a fast 200.
  const processing = processSlackEvent(payload).catch((error) => {
    console.error("ingest-slack processing failed", {
      event_id: payload.event_id,
      error: String(error),
    });
  });

  const edgeRuntime = (globalThis as unknown as {
    EdgeRuntime?: { waitUntil?: (promise: Promise<unknown>) => void };
  }).EdgeRuntime;

  if (edgeRuntime?.waitUntil) {
    edgeRuntime.waitUntil(processing);
    return jsonResponse({ ok: true, queued: true });
  }

  await processing;
  return jsonResponse({ ok: true, queued: false });
});

// ---------------------------------------------------------------------------
// Core processing
// ---------------------------------------------------------------------------

async function processSlackEvent(payload: SlackEnvelope): Promise<void> {
  const eventId = payload.event_id ?? "";

  // Event-level dedup via slack_events table (unique constraint on event_id)
  const duplicate = await registerSlackEvent(eventId);
  if (duplicate) {
    console.log("Duplicate Slack event_id, skipping", { event_id: eventId });
    return;
  }

  const event = payload.event;

  if (!event || event.type !== "message") {
    console.log("Skipped non-message event", { event_type: event?.type ?? "", event_id: eventId });
    return;
  }

  if (event.subtype || event.bot_id) {
    console.log("Skipped bot or subtype message", {
      subtype: event.subtype ?? "",
      bot_id: event.bot_id ?? "",
      event_id: eventId,
    });
    return;
  }

  const text = (event.text ?? "").trim();
  if (!text) {
    console.log("Skipped empty message", { event_id: eventId });
    return;
  }

  // Channel filter — only capture from configured channel (if set)
  const channelId = (event.channel ?? "").trim();
  if (SLACK_CAPTURE_CHANNEL_ID && channelId !== SLACK_CAPTURE_CHANNEL_ID) {
    console.log("Message not in configured capture channel", {
      channel: channelId,
      capture_channel: SLACK_CAPTURE_CHANNEL_ID,
      event_id: eventId,
    });
    return;
  }

  // Enrich: embedding + metadata extraction in parallel
  const { embedding, extracted, warnings } = await resolveThoughtEnrichment(text);

  const metadata: Record<string, unknown> = {
    type: extracted.type,
    summary: extracted.summary,
    topics: extracted.topics,
    tags: extracted.tags,
    people: extracted.people,
    action_items: extracted.action_items,
    confidence: extracted.confidence,
    source: "slack",
    slack_event_id: eventId,
    slack_team_id: payload.team_id ?? "",
    slack_channel_id: channelId,
    slack_channel_type: event.channel_type ?? "",
    slack_user_id: event.user ?? "",
    slack_ts: event.ts ?? "",
    slack_thread_ts: event.thread_ts ?? "",
    captured_at: new Date().toISOString(),
    capture_warnings: warnings,
  };

  const upsertPayload: Record<string, unknown> = {
    type: extracted.type,
    importance: 3,
    quality_score: extracted.confidence * 100,
    source_type: "slack",
    metadata,
    created_at: new Date().toISOString(),
  };

  if (embedding) {
    upsertPayload.embedding = JSON.stringify(embedding);
  }

  const { data, error } = await supabase.rpc("upsert_thought", {
    p_content: text,
    p_payload: upsertPayload,
  });

  if (error) {
    console.error("Failed to upsert thought", {
      event_id: eventId,
      error: error.message,
    });
    throw new Error(`Failed to upsert thought: ${error.message}`);
  }

  const thoughtId = extractThoughtId(data);
  console.log("Captured Slack thought", {
    thought_id: thoughtId,
    event_id: eventId,
    channel: channelId,
    type: extracted.type,
    embedding_status: embedding ? "present" : "missing",
  });
}

// ---------------------------------------------------------------------------
// Enrichment: embedding + metadata
// ---------------------------------------------------------------------------

async function resolveThoughtEnrichment(text: string): Promise<{
  embedding: number[] | null;
  extracted: ThoughtMetadata;
  warnings: string[];
}> {
  const [embeddingResult, metadataResult] = await Promise.allSettled([
    getEmbedding(text),
    extractMetadata(text),
  ]);

  const warnings: string[] = [];
  let embedding: number[] | null = null;
  let extracted = fallbackMetadata(text);

  if (embeddingResult.status === "fulfilled") {
    embedding = embeddingResult.value;
  } else {
    warnings.push("embedding_unavailable");
    console.warn("Slack capture continuing without embedding", embeddingResult.reason);
  }

  if (metadataResult.status === "fulfilled") {
    extracted = metadataResult.value;
  } else {
    warnings.push("metadata_fallback");
    console.warn("Slack capture falling back to basic metadata", metadataResult.reason);
  }

  return { embedding, extracted, warnings };
}

async function getEmbedding(text: string): Promise<number[]> {
  const response = await fetch(`${OPENROUTER_BASE}/embeddings`, {
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

  if (!response.ok) {
    throw new Error(`Embedding request failed: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();
  return data.data[0].embedding;
}

async function extractMetadata(text: string): Promise<ThoughtMetadata> {
  const response = await fetch(`${OPENROUTER_BASE}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENROUTER_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "openai/gpt-4o-mini",
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: `Extract metadata from the user's captured thought. Return JSON with:
- "type": one of "idea", "task", "person_note", "reference", "decision", "lesson", "meeting", "journal"
- "summary": one-sentence summary (max 120 chars)
- "topics": array of 1-3 short topic tags (always at least one)
- "tags": array of 0-3 categorical tags
- "people": array of people mentioned (empty if none)
- "action_items": array of implied to-dos (empty if none)
- "confidence": number 0-1 indicating extraction confidence
Only extract what's explicitly there. Default type is "reference".`,
        },
        { role: "user", content: text },
      ],
    }),
  });

  if (!response.ok) {
    throw new Error(`Metadata extraction failed: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();
  try {
    const parsed = JSON.parse(data.choices[0].message.content);
    return {
      type: parsed.type ?? "reference",
      summary: parsed.summary ?? text.slice(0, 120),
      topics: Array.isArray(parsed.topics) ? parsed.topics : ["uncategorized"],
      tags: Array.isArray(parsed.tags) ? parsed.tags : [],
      people: Array.isArray(parsed.people) ? parsed.people : [],
      action_items: Array.isArray(parsed.action_items) ? parsed.action_items : [],
      confidence: typeof parsed.confidence === "number" ? parsed.confidence : 0.5,
    };
  } catch {
    return fallbackMetadata(text);
  }
}

function fallbackMetadata(text: string): ThoughtMetadata {
  return {
    type: "reference",
    summary: text.slice(0, 120),
    topics: ["uncategorized"],
    tags: [],
    people: [],
    action_items: [],
    confidence: 0.1,
  };
}

// ---------------------------------------------------------------------------
// Slack signature verification (HMAC-SHA256)
// ---------------------------------------------------------------------------

async function verifySlackSignature(
  headers: Headers,
  rawBody: string,
  secret: string,
): Promise<boolean> {
  const signature = (headers.get("x-slack-signature") ?? "").trim();
  const timestamp = (headers.get("x-slack-request-timestamp") ?? "").trim();

  if (!signature || !timestamp) {
    return false;
  }

  const timestampNum = Number(timestamp);
  if (!Number.isFinite(timestampNum)) {
    return false;
  }

  // Reject requests older than 5 minutes to prevent replay attacks
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - timestampNum) > 300) {
    return false;
  }

  const baseString = `v0:${timestamp}:${rawBody}`;
  const expected = await computeSlackSignature(secret, baseString);
  return timingSafeEqual(signature, expected);
}

async function computeSlackSignature(secret: string, baseString: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );

  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(baseString));
  const bytes = new Uint8Array(signature);
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return `v0=${hex}`;
}

function timingSafeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) {
    return false;
  }
  let mismatch = 0;
  for (let index = 0; index < left.length; index += 1) {
    mismatch |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return mismatch === 0;
}

// ---------------------------------------------------------------------------
// Event dedup via slack_events table
// ---------------------------------------------------------------------------

async function registerSlackEvent(eventId: string): Promise<boolean> {
  const { error } = await supabase
    .from("slack_events")
    .insert({ event_id: eventId });

  if (!error) {
    return false;
  }

  // Unique constraint violation = duplicate
  if (error.code === "23505") {
    return true;
  }

  // Transient timeout — proceed without dedupe checkpoint rather than fail
  if ((error.message ?? "").toLowerCase().includes("timeout")) {
    console.warn("slack_events insert timed out; continuing without dedupe checkpoint", error);
    return false;
  }

  throw new Error(`Failed to register Slack event: ${error.message}`);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...corsHeaders(),
    },
  });
}

function corsHeaders(): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, x-slack-signature, x-slack-request-timestamp",
  };
}

function extractThoughtId(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (value && typeof value === "object" && "thought_id" in value) {
    const thoughtId = (value as { thought_id?: number }).thought_id;
    if (typeof thoughtId === "number" && Number.isFinite(thoughtId)) {
      return thoughtId;
    }
  }
  return null;
}
