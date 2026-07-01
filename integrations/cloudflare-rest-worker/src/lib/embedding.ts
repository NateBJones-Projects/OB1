import type { Env } from "./types";

// Same model the core open-brain-mcp uses for `search_thoughts` (see
// server/index.ts in the upstream MCP). Keeping them in sync means
// query-time embeddings match the dimensionality of the stored vectors
// (1536) without any extra projection.
const EMBEDDING_MODEL = "openai/text-embedding-3-small";
const OPENROUTER_BASE = "https://openrouter.ai/api/v1";

export async function generateEmbedding(env: Env, text: string): Promise<number[]> {
  if (!env.OPENROUTER_API_KEY) {
    throw new Error("OPENROUTER_API_KEY not configured on Worker");
  }
  const res = await fetch(`${OPENROUTER_BASE}/embeddings`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.OPENROUTER_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ model: EMBEDDING_MODEL, input: text }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`OpenRouter embedding failed (${res.status}): ${detail}`);
  }
  const payload = (await res.json()) as { data?: Array<{ embedding?: number[] }> };
  const vec = payload?.data?.[0]?.embedding;
  if (!Array.isArray(vec)) {
    throw new Error("OpenRouter response missing embedding vector");
  }
  return vec;
}
