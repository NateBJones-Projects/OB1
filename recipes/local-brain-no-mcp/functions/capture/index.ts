// POST /functions/v1/capture
//
// Body:
//   { content: string, metadata?: object }
//
// Embeds `content` via the local Ollama sidecar and INSERTs via the
// upsert_thought() RPC (which dedupes by sha256(normalized content)).
//
// Auth: Kong gateway verifies the anon-or-service-role JWT before this
// function runs. We do not re-check.

import { corsHeaders, jsonResponse } from "../_shared/cors.ts";
import { embed, EmbedError } from "../_shared/embed.ts";
import { db } from "../_shared/db.ts";

interface CaptureBody {
  content?: unknown;
  metadata?: unknown;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return jsonResponse({ error: "method not allowed" }, 405);
  }

  let body: CaptureBody;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "body must be valid JSON" }, 400);
  }

  const content = typeof body.content === "string" ? body.content.trim() : "";
  if (!content) {
    return jsonResponse({ error: "content is required (non-empty string)" }, 400);
  }
  const metadata =
    body.metadata && typeof body.metadata === "object" && !Array.isArray(body.metadata)
      ? body.metadata
      : {};

  let vec: number[];
  try {
    vec = await embed(content);
  } catch (e) {
    if (e instanceof EmbedError) return jsonResponse({ error: e.message }, 502);
    throw e;
  }

  const { data, error } = await db.rpc("upsert_thought", {
    p_content: content,
    p_embedding: vec,
    p_metadata: metadata,
  });

  if (error) {
    return jsonResponse(
      { error: `upsert_thought failed: ${error.message}`, details: error.details ?? null },
      500,
    );
  }

  return jsonResponse({ ok: true, ...data }, 200);
});
