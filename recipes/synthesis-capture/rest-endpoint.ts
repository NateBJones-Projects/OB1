/**
 * POST /synthesis — REST endpoint for Open Brain
 *
 * Paste this into your open-brain-rest Edge Function. The exported
 * `handleCaptureSynthesis` is framework-agnostic — it takes a standard
 * `Request` and returns a `Response`. Wire it up to whichever routing
 * style your REST function uses.
 *
 * For a `fetch`-style Deno.serve router, add:
 *
 *     if (path === "/synthesis" && req.method === "POST") {
 *       return await handleCaptureSynthesis(req);
 *     }
 *
 * For a Hono-style router:
 *
 *     app.post("/synthesis", (c) => handleCaptureSynthesis(c.req.raw));
 *
 * What it does
 * ------------
 * Accepts a pre-computed synthesis string plus 3+ source thought IDs and
 * stores the synthesis as a new `public.thoughts` row with
 * `derivation_layer='derived'`, `derivation_method='synthesis'`, and
 * `derived_from=[...sourceIds]`.
 *
 * It does NOT call an LLM — synthesis generation happens client-side. This
 * endpoint only persists the result with provenance. That keeps the hot path
 * cheap and deterministic, and keeps secret prompts off the server.
 *
 * Requirements
 * ------------
 * Provenance columns on `public.thoughts` (from the `provenance-chains`
 * recipe schema):
 *   - derivation_layer  (text: 'primary' | 'derived')
 *   - derivation_method (text: 'synthesis')
 *   - derived_from      (jsonb: array of parent thought IDs)
 *
 * Assumes in scope
 * ----------------
 *   - `supabase`              : Supabase service-role client
 *   - `getEmbedding(text)`    : your embedding helper
 *   - `extractMetadata(text)` : your metadata helper
 *
 * Safety rules
 * ------------
 *   1. `content` required (non-empty string).
 *   2. `source_thought_ids` must contain at least 3 distinct positive ints.
 *   3. Every source ID must exist in `public.thoughts`.
 *   4. No source may have `source_type = 'synthesis'` (anti-loop).
 *   5. At least one source must have `derivation_layer = 'primary'`.
 */

type SynthesisRequestBody = {
  content?: unknown;
  source_thought_ids?: unknown;
  question?: unknown;
  topics?: unknown;
  tags?: unknown;
  metadata?: unknown;
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export async function handleCaptureSynthesis(req: Request): Promise<Response> {
  let body: SynthesisRequestBody;
  try {
    body = (await req.json()) as SynthesisRequestBody;
  } catch {
    return jsonResponse({ error: "Invalid JSON in request body" }, 400);
  }

  const content = typeof body.content === "string" ? body.content.trim() : "";
  if (!content) {
    return jsonResponse({ error: "content is required" }, 400);
  }
  // Size cap: 50KB matches the MCP Zod schema. Guards against accidental or
  // adversarial floods that would balloon embedding and DB write costs.
  // Adjust both sides (MCP + REST) together if you need longer syntheses.
  if (content.length > 50_000) {
    return jsonResponse(
      { error: "content exceeds 50000 character limit" },
      413,
    );
  }

  // Accept either numeric BIGINT IDs or string UUIDs — OB1 installs vary.
  // Stock schema in docs/01-getting-started.md uses UUID; enhanced / provenance
  // variants may use BIGINT. We validate shape against whichever we see first.
  const rawIds = Array.isArray(body.source_thought_ids)
    ? body.source_thought_ids
    : [];
  // Cap raw input length BEFORE normalization so a caller cannot flood the
  // normalize loop with 100k items. 50 matches the MCP schema upper bound.
  if (rawIds.length > 50) {
    return jsonResponse(
      { error: "source_thought_ids exceeds 50 item limit" },
      413,
    );
  }
  const normalized = rawIds
    .map((v) => {
      if (typeof v === "number" && Number.isInteger(v) && v > 0) return v;
      if (typeof v === "string" && v.trim() !== "") return v.trim();
      return null;
    })
    .filter((v): v is number | string => v !== null);
  const sourceIds = Array.from(new Set(normalized));
  if (sourceIds.length < 3) {
    return jsonResponse(
      { error: "source_thought_ids must include at least 3 distinct IDs (positive integers or non-empty strings)" },
      400,
    );
  }

  // ── Safety check 1: all sources must exist ───────────────────────────────
  const { data: parents, error: parentsError } = await supabase
    .from("thoughts")
    .select("id, derivation_layer, source_type")
    .in("id", sourceIds);

  if (parentsError) {
    return jsonResponse(
      { error: `parent lookup failed: ${parentsError.message}` },
      500,
    );
  }

  const parentRows = (parents ?? []) as Array<{
    id: number | string;
    derivation_layer: string | null;
    source_type: string | null;
  }>;
  const foundIds = new Set(parentRows.map((p) => p.id));
  const missing = sourceIds.filter((id) => !foundIds.has(id));
  if (missing.length > 0) {
    return jsonResponse(
      { error: `parent thoughts not found: ${missing.join(", ")}` },
      400,
    );
  }

  // ── Safety check 2: reject synthesis-of-synthesis ────────────────────────
  const synthSources = parentRows.filter((p) => p.source_type === "synthesis");
  if (synthSources.length > 0) {
    return jsonResponse(
      {
        error:
          "source thoughts are themselves syntheses; synthesis-of-synthesis is forbidden",
        synthesis_source_ids: synthSources.map((p) => p.id),
      },
      400,
    );
  }

  // ── Safety check 3: at least one primary parent ──────────────────────────
  const anyPrimary = parentRows.some((p) => p.derivation_layer === "primary");
  if (!anyPrimary) {
    return jsonResponse(
      {
        error:
          "all source thoughts are derived; at least one must be primary (atomic) to prevent self-referential synthesis loops",
      },
      400,
    );
  }

  // ── Input caps on optional fields (parity with README + MCP) ─────────────
  // Each cap returns 413 Payload Too Large with a field-specific error so
  // callers can fix the offending field without guessing. Caps match the MCP
  // Zod schema so both surfaces reject identical payloads — adjust both
  // handlers together if you need higher bounds.
  let questionValue: string | null = null;
  if (body.question !== undefined && body.question !== null) {
    if (typeof body.question !== "string") {
      return jsonResponse({ error: "question must be a string" }, 400);
    }
    const trimmedQuestion = body.question.trim();
    if (trimmedQuestion.length > 2_000) {
      return jsonResponse(
        { error: "question exceeds 2000 character limit" },
        413,
      );
    }
    if (trimmedQuestion !== "") questionValue = trimmedQuestion;
  }

  let topicsValue: string[] | null = null;
  if (body.topics !== undefined && body.topics !== null) {
    if (!Array.isArray(body.topics)) {
      return jsonResponse({ error: "topics must be an array" }, 400);
    }
    if (body.topics.length > 20) {
      return jsonResponse(
        { error: "topics exceeds 20 item limit" },
        413,
      );
    }
    for (const t of body.topics) {
      if (typeof t !== "string") {
        return jsonResponse(
          { error: "topics entries must be strings" },
          400,
        );
      }
      if (t.length > 100) {
        return jsonResponse(
          { error: "topics entry exceeds 100 character limit" },
          413,
        );
      }
    }
    topicsValue = body.topics as string[];
  }

  let tagsValue: string[] | null = null;
  if (body.tags !== undefined && body.tags !== null) {
    if (!Array.isArray(body.tags)) {
      return jsonResponse({ error: "tags must be an array" }, 400);
    }
    if (body.tags.length > 20) {
      return jsonResponse(
        { error: "tags exceeds 20 item limit" },
        413,
      );
    }
    for (const t of body.tags) {
      if (typeof t !== "string") {
        return jsonResponse(
          { error: "tags entries must be strings" },
          400,
        );
      }
      if (t.length > 50) {
        return jsonResponse(
          { error: "tags entry exceeds 50 character limit" },
          413,
        );
      }
    }
    tagsValue = body.tags as string[];
  }

  let callerMetadata: Record<string, unknown> | null = null;
  if (body.metadata !== undefined && body.metadata !== null) {
    if (
      typeof body.metadata !== "object" ||
      Array.isArray(body.metadata)
    ) {
      return jsonResponse(
        { error: "metadata must be a plain object" },
        400,
      );
    }
    const keyCount = Object.keys(body.metadata as Record<string, unknown>).length;
    if (keyCount > 50) {
      return jsonResponse(
        { error: "metadata exceeds 50 key limit" },
        413,
      );
    }
    callerMetadata = body.metadata as Record<string, unknown>;
  }

  // ── Build metadata, embedding, and persist ───────────────────────────────
  let embedding: number[];
  let autoMetadata: Record<string, unknown>;
  try {
    [embedding, autoMetadata] = await Promise.all([
      getEmbedding(content),
      extractMetadata(content),
    ]);
  } catch (err) {
    return jsonResponse(
      { error: `enrichment failed: ${(err as Error).message}` },
      500,
    );
  }

  // Build metadata in a specific order so the caller's `body.metadata` cannot
  // stomp reserved provenance keys. Order:
  //   1. autoMetadata (heuristic enrichment from extractMetadata)
  //   2. caller-supplied body.metadata (may overlay topics/tags/notes etc.)
  //   3. handler-controlled fields (question/topics/tags) — override caller
  //   4. reserved provenance fields — LAST, so nothing can spoof them
  const mergedMetadata: Record<string, unknown> = {
    ...autoMetadata,
  };
  if (callerMetadata) {
    Object.assign(mergedMetadata, callerMetadata);
  }
  if (questionValue) {
    mergedMetadata.question = questionValue;
  }
  if (topicsValue) {
    mergedMetadata.topics = topicsValue;
  }
  if (tagsValue) {
    mergedMetadata.tags = tagsValue;
  }
  // Reserved keys — stamped LAST so body.metadata cannot overwrite them.
  // These identify the write channel and provenance layer for downstream
  // filtering/reporting. A caller who sets source: "capture_thought" in
  // body.metadata would otherwise impersonate an MCP-atomic write.
  mergedMetadata.source = "rest_synthesis";
  // Belt-and-suspenders: mirror provenance fields into metadata so they
  // survive the stock `upsert_thought` RPC, which only persists
  // `p_payload.metadata` and silently drops top-level `p_payload` keys.
  // TODO(synthesis-capture): once the sibling `provenance-chains` recipe
  // lands on main with an updated RPC that reads top-level provenance
  // fields, this mirror becomes redundant and can be removed. Until then,
  // this is the ONLY code path that guarantees provenance lands somewhere
  // queryable on stock installs. See DEPENDENCIES.md for full rationale.
  mergedMetadata.provenance = {
    source_type: "synthesis",
    derivation_layer: "derived",
    derivation_method: "synthesis",
    derived_from: sourceIds,
  };

  // Final size guard on the fully-merged metadata object. We check AFTER
  // merge (including provenance stamping) so callers cannot bypass the cap
  // by shrinking individual fields while still pushing the aggregate past
  // 10KB. 10KB comfortably holds tens of topics/tags plus provenance while
  // keeping the jsonb payload small enough that the RPC write stays cheap.
  const mergedSize = JSON.stringify(mergedMetadata).length;
  if (mergedSize > 10_240) {
    return jsonResponse(
      { error: `metadata exceeds 10KB limit (got ${mergedSize} bytes after merge)` },
      413,
    );
  }

  const { data: upsertResult, error: upsertError } = await supabase.rpc(
    "upsert_thought",
    {
      p_content: content,
      p_payload: {
        source_type: "synthesis",
        metadata: mergedMetadata,
        derivation_layer: "derived",
        derivation_method: "synthesis",
        derived_from: sourceIds,
      },
    },
  );

  if (upsertError) {
    return jsonResponse(
      { error: `synthesis capture failed: ${upsertError.message}` },
      500,
    );
  }

  const thoughtId = (upsertResult as { id?: number | string } | null)?.id;
  if (!thoughtId) {
    return jsonResponse(
      { error: "upsert_thought returned no thought ID" },
      500,
    );
  }

  const { error: embError } = await supabase
    .from("thoughts")
    .update({ embedding })
    .eq("id", thoughtId);

  if (embError) {
    // Thought is safely written; the embedding is a soft-fail. Surface it so
    // the caller can retry the embedding update, but keep the 200 success.
    return jsonResponse(
      {
        thought_id: thoughtId,
        source_count: sourceIds.length,
        embedding_error: embError.message,
        message: `Captured synthesis #${thoughtId} but embedding update failed`,
      },
      200,
    );
  }

  return jsonResponse(
    {
      thought_id: thoughtId,
      source_count: sourceIds.length,
      message: `Captured synthesis #${thoughtId} from ${sourceIds.length} source thoughts`,
    },
    201,
  );
}
