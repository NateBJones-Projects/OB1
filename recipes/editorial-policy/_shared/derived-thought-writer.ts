// supabase/functions/_shared/derived-thought-writer.ts
//
// Canonical writer for synthesis / derived thoughts (hygiene roadmap Phase 1).
//
// Every function that stores an LLM-produced thought (auditor, morning-briefing,
// weekly-summary, future compilers) should call storeDerivedThought() instead of
// hand-rolling an insert. It guarantees, in one place:
//   - content_fingerprint dedup (via the upsert_thought RPC)
//   - provenance columns (derived_from / derivation_method / derivation_layer)
//   - an EMBEDDING computed at write time, so derived thoughts are never
//     invisible to semantic search (best-effort: an embedding-provider outage
//     stores the thought without one rather than failing the synthesis run;
//     the ops monitor watches for residual NULLs)
//
// Embedding provider order matches the rest of OB1: OpenRouter → OpenAI.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

const EMBEDDING_DIMENSION = 1536;

/** Generate a text embedding via OpenRouter (primary) or OpenAI (fallback). */
async function embedText(text: string): Promise<number[]> {
  const openRouterKey = Deno.env.get("OPENROUTER_API_KEY") ?? "";
  const openAiKey = Deno.env.get("OPENAI_API_KEY") ?? "";
  const openRouterModel = Deno.env.get("OPENROUTER_EMBEDDING_MODEL") ?? "openai/text-embedding-3-small";
  const openAiModel = Deno.env.get("OPENAI_EMBEDDING_MODEL") ?? "text-embedding-3-small";
  // Embedding models cap input length; briefings/audits are short but clip defensively.
  const input = text.slice(0, 8000);

  if (openRouterKey) {
    const response = await fetch("https://openrouter.ai/api/v1/embeddings", {
      method: "POST",
      headers: { Authorization: `Bearer ${openRouterKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: openRouterModel, input }),
    });
    if (!response.ok) {
      throw new Error(`OpenRouter embedding failed (${response.status}): ${await response.text()}`);
    }
    const embedding = (await response.json())?.data?.[0]?.embedding;
    if (!Array.isArray(embedding) || embedding.length !== EMBEDDING_DIMENSION) {
      throw new Error(`OpenRouter embedding malformed (len=${embedding?.length})`);
    }
    return embedding as number[];
  }

  if (openAiKey) {
    const response = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: { Authorization: `Bearer ${openAiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: openAiModel, input }),
    });
    if (!response.ok) {
      throw new Error(`OpenAI embedding failed (${response.status}): ${await response.text()}`);
    }
    const embedding = (await response.json())?.data?.[0]?.embedding;
    if (!Array.isArray(embedding) || embedding.length !== EMBEDDING_DIMENSION) {
      throw new Error(`OpenAI embedding malformed (len=${embedding?.length})`);
    }
    return embedding as number[];
  }

  throw new Error("No embedding API key configured (OPENROUTER_API_KEY or OPENAI_API_KEY)");
}

export interface DerivedThoughtPayload {
  metadata: Record<string, unknown>;
  derived_from?: string[];
  derivation_method?: "synthesis";
  derivation_layer?: "primary" | "derived";
}

/**
 * Store a derived/synthesis thought through the canonical dedup path with a
 * write-time embedding. Returns the thought id.
 *
 * Enrichment exemption (belt AND suspenders): synthesis artifacts must NEVER
 * be picked up by the enrichment worker and re-classified.
 *   - Belt (predicate-level, schema-independent): every stored row carries
 *     metadata.enrichment_status = 'exempt', which the queue predicate excludes
 *     regardless of whether the provenance columns exist.
 *   - Suspenders (column-level): we also stamp the provenance columns
 *     derivation_layer='derived' + derivation_method='synthesis' on the row.
 *
 * Portability: the 3-arg upsert_thought(p_content, p_payload, p_embedding) only
 * exists via an optional migration. We attempt it first; if the RPC is missing
 * (PGRST202 / SQLSTATE 42883) we fall back to the canonical 2-arg
 * upsert_thought and set the embedding in the follow-up UPDATE.
 */
export async function storeDerivedThought(
  supabase: SupabaseClient,
  content: string,
  payload: DerivedThoughtPayload,
): Promise<string> {
  let embedding: number[] | null = null;
  try {
    embedding = await embedText(content);
  } catch (err) {
    // Best-effort: never fail a synthesis run over an embedding outage.
    console.warn("derived-thought-writer: embedding failed, storing without:", (err as Error).message);
  }

  const derivationLayer = payload.derivation_layer ?? "derived";
  const derivationMethod = payload.derivation_method ?? "synthesis";

  // Belt: force enrichment_status='exempt' onto the metadata. Applied last so a
  // caller can never accidentally override it back to an enrichable status.
  const metadata: Record<string, unknown> = {
    ...payload.metadata,
    enrichment_status: "exempt",
  };
  const fullPayload = {
    ...payload,
    metadata,
    derivation_layer: derivationLayer,
    derivation_method: derivationMethod,
  };

  // Attempt the optional 3-arg upsert (carries the embedding server-side).
  let id: string | null = null;
  let usedTwoArg = false;
  const three = await supabase.rpc("upsert_thought", {
    p_content: content,
    p_payload: fullPayload,
    p_embedding: embedding,
  });
  const notFound = three.error &&
    ((three.error as { code?: string }).code === "PGRST202" ||
     (three.error as { code?: string }).code === "42883");
  if (notFound) {
    // Canonical 2-arg fallback: no embedding param — set it in the UPDATE below.
    usedTwoArg = true;
    const two = await supabase.rpc("upsert_thought", {
      p_content: content,
      p_payload: fullPayload,
    });
    if (two.error || !two.data?.id) {
      throw new Error(`derived thought upsert failed: ${two.error?.message ?? "unknown"}`);
    }
    id = two.data.id as string;
  } else if (three.error || !three.data?.id) {
    throw new Error(`derived thought upsert failed: ${three.error?.message ?? "unknown"}`);
  } else {
    id = three.data.id as string;
  }

  // Suspenders: stamp provenance columns directly (neither RPC is guaranteed to
  // write them), plus the embedding when the 2-arg path was used. Best-effort:
  // if the provenance columns aren't installed the 'exempt' belt still holds, so
  // don't fail the synthesis run over it.
  const rowUpdate: Record<string, unknown> = {
    derivation_layer: derivationLayer,
    derivation_method: derivationMethod,
  };
  if (payload.derived_from) rowUpdate.derived_from = payload.derived_from;
  if (usedTwoArg && embedding) rowUpdate.embedding = embedding;
  const { error: updateError } = await supabase
    .from("thoughts")
    .update(rowUpdate)
    .eq("id", id);
  if (updateError) {
    console.warn(
      "derived-thought-writer: provenance/embedding stamp failed (belt 'exempt' status still applies):",
      updateError.message,
    );
  }

  return id;
}
