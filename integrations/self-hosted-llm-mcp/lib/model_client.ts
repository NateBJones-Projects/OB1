import { EXTRACTION_PROMPT } from "./metadata.ts";
import type { ModelClient, ModelResult, OkConfig } from "./types.ts";

export function createModelClient(config: OkConfig, doFetch: typeof fetch): ModelClient {
  return {
    async embed(text: string): Promise<ModelResult<number[]>> {
      const ep = config.embedding;
      const res = await doFetch(`${ep.base}/embeddings`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: ep.model, input: text, dimensions: 1536 }),
      });
      const json = await res.json();
      return { ok: true, value: json.data[0].embedding };
    },
    async chat(text: string): Promise<ModelResult<string>> {
      const ep = config.chat;
      await doFetch(`${ep.base}/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: ep.model,
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: EXTRACTION_PROMPT },
            { role: "user", content: text },
          ],
        }),
      });
      return { ok: false, kind: "bad_response", message: "not implemented" };
    },
    listModels(): Promise<ModelResult<string[] | null>> {
      throw new Error("not implemented");
    },
  };
}
