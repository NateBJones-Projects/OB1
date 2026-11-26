import type { ModelClient, ModelResult, OkConfig } from "./types.ts";

export function createModelClient(config: OkConfig, doFetch: typeof fetch): ModelClient {
  return {
    async embed(text: string): Promise<ModelResult<number[]>> {
      const ep = config.embedding;
      await doFetch(`${ep.base}/embeddings`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: ep.model, input: text, dimensions: 1536 }),
      });
      return { ok: false, kind: "bad_response", message: "not implemented" };
    },
    chat(): Promise<ModelResult<string>> {
      throw new Error("not implemented");
    },
    listModels(): Promise<ModelResult<string[] | null>> {
      throw new Error("not implemented");
    },
  };
}
