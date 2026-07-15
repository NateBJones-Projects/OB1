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

  const { data, error } = await supabase.rpc("upsert_thought", {
    p_content: content,
    p_payload: payload,
    p_embedding: embedding,
  });
  if (error || !data?.id) {
    throw new Error(`derived thought upsert failed: ${error?.message ?? "unknown"}`);
  }
  return data.id as string;
}
