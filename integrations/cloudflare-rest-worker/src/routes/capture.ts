import { Hono } from "hono";
import type { Env } from "../lib/types";
import { supabaseFor } from "../lib/supabase";
import { fail, fromError } from "../lib/responses";
import { generateEmbedding } from "../lib/embedding";

// /capture mirrors the open-brain-mcp `capture_thought` MCP tool: extract
// metadata via LLM (gpt-4o-mini JSON mode), generate the embedding, then
// call the existing upsert_thought RPC (defined in docs/01-getting-started.md
// Step 2.6) which handles dedup via the content fingerprint. Embedding is
// written back in a follow-up UPDATE since upsert_thought's signature only
// accepts content + metadata, not the vector.

const OPENROUTER_BASE = "https://openrouter.ai/api/v1";
const METADATA_MODEL = "openai/gpt-4o-mini";

const METADATA_PROMPT = [
  'Extract metadata from the user\'s captured thought. Return STRICT JSON with keys:',
  '- "people": array of people mentioned (empty if none)',
  '- "action_items": array of implied to-dos (empty if none)',
  '- "dates_mentioned": array of dates YYYY-MM-DD (empty if none)',
  '- "topics": array of 1-3 short topic tags (always at least one)',
  '- "type": one of "observation", "task", "idea", "reference", "person_note"',
  "Only extract what's explicitly there.",
].join("\n");

interface ExtractedMetadata {
  people?: string[];
  action_items?: string[];
  dates_mentioned?: string[];
  topics?: string[];
  type?: string;
}

async function extractMetadata(env: Env, text: string): Promise<ExtractedMetadata> {
  const res = await fetch(`${OPENROUTER_BASE}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.OPENROUTER_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: METADATA_MODEL,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: METADATA_PROMPT },
        { role: "user", content: text },
      ],
    }),
  });
  if (!res.ok) {
    // Treat metadata extraction as best-effort: a model failure shouldn't
    // block the capture. The RPC will accept an empty metadata object.
    console.warn("metadata extraction failed:", res.status);
    return { topics: ["uncategorized"], type: "observation" };
  }
  const payload = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = payload?.choices?.[0]?.message?.content ?? "";
  try {
    return JSON.parse(content) as ExtractedMetadata;
  } catch {
    return { topics: ["uncategorized"], type: "observation" };
  }
}

const VALID_TYPES = new Set([
  "observation",
  "task",
  "idea",
  "reference",
  "person_note",
]);

export const capture = new Hono<{ Bindings: Env }>();

capture.post("/capture", async (c) => {
  try {
    const body = (await c.req.json().catch(() => ({}))) as { content?: string };
    const content = (body.content ?? "").trim();
    if (!content) return fail(c, 400, "content is required");

    // Run metadata extraction and embedding in parallel — they don't depend
    // on each other and both call OpenRouter, so this saves one round-trip
    // worth of latency.
    const [metadata, embedding] = await Promise.all([
      extractMetadata(c.env, content),
      generateEmbedding(c.env, content),
    ]);

    const type = VALID_TYPES.has(metadata.type ?? "")
      ? (metadata.type as string)
      : "observation";

    const sb = supabaseFor(c.env);
    const { data: rpcResult, error: rpcErr } = await sb.rpc("upsert_thought", {
      p_content: content,
      p_payload: { metadata: { ...metadata, source: "rest-gateway" } },
    });
    if (rpcErr) return fail(c, 500, rpcErr.message);

    const result = (rpcResult ?? {}) as { id?: string; fingerprint?: string };
    if (!result.id) return fail(c, 500, "upsert_thought returned no id");

    // Backfill the embedding + the new top-level columns the dashboard reads
    // (type, source_type). sensitivity_tier defaults to 'standard' via the
    // schema definition; we don't classify here in v1.
    const { data: row, error: updateErr } = await sb
      .from("thoughts")
      .update({
        embedding,
        type,
        source_type: "rest-gateway",
      })
      .eq("id", result.id)
      .select("id, type, sensitivity_tier, content_fingerprint")
      .single();
    if (updateErr) return fail(c, 500, updateErr.message);

    return c.json({
      thought_id: row.id,
      action: "captured",
      type: row.type ?? type,
      sensitivity_tier: row.sensitivity_tier ?? "standard",
      content_fingerprint: row.content_fingerprint ?? result.fingerprint ?? "",
      message: "Thought captured",
    });
  } catch (err) {
    return fromError(c, err);
  }
});
