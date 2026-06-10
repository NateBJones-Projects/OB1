// Server-side embedding via a local Ollama sidecar. Dev hosts never need
// Ollama -- the capture and search Edge Functions both call this helper.

const OLLAMA_URL = Deno.env.get("OLLAMA_URL") ?? "http://ollama:11434";
const EMBED_MODEL = Deno.env.get("EMBED_MODEL") ?? "nomic-embed-text";
const EMBED_DIM = Number(Deno.env.get("EMBED_DIM") ?? "768");

export class EmbedError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = "EmbedError";
  }
}

export async function embed(text: string): Promise<number[]> {
  const trimmed = text?.trim();
  if (!trimmed) throw new EmbedError("empty text");

  let r: Response;
  try {
    r = await fetch(`${OLLAMA_URL}/api/embeddings`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: EMBED_MODEL, prompt: trimmed }),
    });
  } catch (e) {
    throw new EmbedError(
      `unable to reach Ollama at ${OLLAMA_URL} -- is the ollama container running?`,
      e,
    );
  }

  if (!r.ok) {
    const body = await r.text().catch(() => "");
    throw new EmbedError(
      `Ollama embedding failed: HTTP ${r.status} ${r.statusText} -- ${body.slice(0, 200)}`,
    );
  }

  const data = await r.json();
  const v = data?.embedding;
  if (!Array.isArray(v) || v.length === 0) {
    throw new EmbedError(
      `Ollama returned no embedding -- did you 'ollama pull ${EMBED_MODEL}'?`,
    );
  }
  if (v.length !== EMBED_DIM) {
    throw new EmbedError(
      `embedding-dim mismatch: env EMBED_DIM=${EMBED_DIM} but Ollama returned ${v.length}. ` +
        `Either change EMBED_MODEL to one that produces ${EMBED_DIM} dims, or wipe the Postgres volume and re-bootstrap with the new dim.`,
    );
  }
  return v;
}

export const config = { EMBED_MODEL, EMBED_DIM, OLLAMA_URL };
