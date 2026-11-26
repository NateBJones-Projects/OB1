import { EXTRACTION_PROMPT } from "./metadata.ts";
import type { EndpointConfig, ModelClient, ModelResult, OkConfig, Role } from "./types.ts";

export function createModelClient(config: OkConfig, doFetch: typeof fetch): ModelClient {
  function send(ep: EndpointConfig, method: string, path: string, body?: unknown): Promise<Response> {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (ep.key) headers["Authorization"] = `Bearer ${ep.key}`;
    return doFetch(`${ep.base}${path}`, {
      method,
      headers,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  }

  return {
    async embed(text: string): Promise<ModelResult<number[]>> {
      const ep = config.embedding;
      const res = await send(ep, "POST", "/embeddings", { model: ep.model, input: text, dimensions: 1536 });
      const json = await res.json();
      return { ok: true, value: json.data[0].embedding };
    },
    async chat(text: string): Promise<ModelResult<string>> {
      const ep = config.chat;
      const res = await send(ep, "POST", "/chat/completions", {
        model: ep.model,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: EXTRACTION_PROMPT },
          { role: "user", content: text },
        ],
      });
      const json = await res.json();
      return { ok: true, value: json.choices[0].message.content };
    },
    async listModels(role: Role): Promise<ModelResult<string[] | null>> {
      await send(config[role], "GET", "/models");
      return { ok: true, value: null };
    },
  };
}
