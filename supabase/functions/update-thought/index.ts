// update-thought Edge Function
//
// Server-to-server endpoint for the dashboard to edit / soft-delete / undelete
// a single thought row by id. Edits regenerate the embedding using the same
// model as ingest-thought so search stays consistent.
//
// Auth: shared secret in `x-dashboard-secret` header. Never call from a browser.
//
// Request body:
//   { action: "edit", id: string, content: string }
//   { action: "delete", id: string }
//   { action: "undelete", id: string }
//
// Required Supabase secrets: OPENROUTER_API_KEY, UPDATE_THOUGHT_SECRET.
// (SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are auto-injected.)

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const OPENROUTER_API_KEY = Deno.env.get("OPENROUTER_API_KEY")!;
const UPDATE_THOUGHT_SECRET = Deno.env.get("UPDATE_THOUGHT_SECRET")!;

const EMBEDDING_PROVIDER = "openrouter";
const EMBEDDING_MODEL = "openai/text-embedding-3-small";

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

async function getEmbedding(text: string): Promise<number[]> {
  const r = await fetch("https://openrouter.ai/api/v1/embeddings", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENROUTER_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ model: EMBEDDING_MODEL, input: text }),
  });
  if (!r.ok) {
    const msg = await r.text().catch(() => "");
    throw new Error(`OpenRouter embeddings ${r.status}: ${msg.slice(0, 200)}`);
  }
  const d = await r.json();
  return d.data[0].embedding;
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

type Body =
  | { action: "edit"; id: string; content: string }
  | { action: "delete"; id: string }
  | { action: "undelete"; id: string };

function parseBody(raw: unknown): Body | null {
  if (!raw || typeof raw !== "object") return null;
  const b = raw as Record<string, unknown>;
  const action = b.action;
  const id = b.id;
  if (typeof id !== "string" || id.length === 0) return null;
  if (action === "edit") {
    if (typeof b.content !== "string" || b.content.trim().length === 0) return null;
    if (b.content.length > 100_000) return null;
    return { action: "edit", id, content: b.content };
  }
  if (action === "delete") return { action: "delete", id };
  if (action === "undelete") return { action: "undelete", id };
  return null;
}

async function handleEdit(id: string, content: string): Promise<Response> {
  const trimmed = content.trim();

  // Re-embed first; if it fails, abort before touching the row so we don't
  // leave content + stale embedding mismatched.
  let embedding: number[];
  try {
    embedding = await getEmbedding(trimmed);
  } catch (err) {
    console.error("re-embed failed:", err);
    return Response.json({ error: "re-embed failed" }, { status: 502 });
  }

  // Read existing metadata so we can preserve it and stamp edit fields.
  const { data: existing, error: readErr } = await supabase
    .from("thoughts")
    .select("metadata")
    .eq("id", id)
    .is("deleted_at", null)
    .maybeSingle();
  if (readErr) {
    console.error("read failed:", readErr.message);
    return Response.json({ error: "read failed" }, { status: 500 });
  }
  if (!existing) {
    return Response.json({ error: "not found" }, { status: 404 });
  }

  const md = (existing.metadata as Record<string, unknown> | null) ?? {};
  const newMetadata = {
    ...md,
    embedding_provider: EMBEDDING_PROVIDER,
    embedding_model: EMBEDDING_MODEL,
    edited_at: new Date().toISOString(),
  };

  const { error: updErr } = await supabase
    .from("thoughts")
    .update({ content: trimmed, embedding, metadata: newMetadata })
    .eq("id", id);
  if (updErr) {
    console.error("edit update failed:", updErr.message);
    return Response.json({ error: "update failed" }, { status: 500 });
  }
  return Response.json({ ok: true });
}

async function handleDelete(id: string): Promise<Response> {
  const { error } = await supabase
    .from("thoughts")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", id)
    .is("deleted_at", null);
  if (error) {
    console.error("soft delete failed:", error.message);
    return Response.json({ error: "delete failed" }, { status: 500 });
  }
  return Response.json({ ok: true });
}

async function handleUndelete(id: string): Promise<Response> {
  const { error } = await supabase
    .from("thoughts")
    .update({ deleted_at: null })
    .eq("id", id);
  if (error) {
    console.error("undelete failed:", error.message);
    return Response.json({ error: "undelete failed" }, { status: 500 });
  }
  return Response.json({ ok: true });
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method !== "POST") {
    return new Response("method not allowed", { status: 405 });
  }

  const provided = req.headers.get("x-dashboard-secret") ?? "";
  if (!constantTimeEqual(provided, UPDATE_THOUGHT_SECRET)) {
    return new Response("unauthorized", { status: 401 });
  }

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return Response.json({ error: "invalid json" }, { status: 400 });
  }

  const body = parseBody(raw);
  if (!body) return Response.json({ error: "invalid body" }, { status: 400 });

  if (body.action === "edit") return handleEdit(body.id, body.content);
  if (body.action === "delete") return handleDelete(body.id);
  return handleUndelete(body.id);
});
