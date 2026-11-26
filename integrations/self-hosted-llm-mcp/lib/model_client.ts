import { EXTRACTION_PROMPT } from "./metadata.ts";
import type { EndpointConfig, ModelClient, ModelResult, OkConfig, OutcomeKind, Role } from "./types.ts";

type Failure = { ok: false; kind: OutcomeKind; message: string };
type Sent = { response: Response } | Failure;

export function createModelClient(config: OkConfig, doFetch: typeof fetch): ModelClient {
  async function send(ep: EndpointConfig, method: string, path: string, body?: unknown): Promise<Sent> {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (ep.key) headers["Authorization"] = `Bearer ${ep.key}`;
    try {
      const response = await doFetch(`${ep.base}${path}`, {
        method,
        headers,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      return { response };
    } catch (_err) {
      return {
        ok: false,
        kind: "unreachable",
        message: `The ${ep.role} model server at ${ep.base} could not be reached.`,
      };
    }
  }

  return {
    async embed(text: string): Promise<ModelResult<number[]>> {
      const ep = config.embedding;
      const sent = await send(ep, "POST", "/embeddings", { model: ep.model, input: text, dimensions: 1536 });
      if (!("response" in sent)) return sent;
      const json = await sent.response.json();
      return { ok: true, value: json.data[0].embedding };
    },
    async chat(text: string): Promise<ModelResult<string>> {
      const ep = config.chat;
      const sent = await send(ep, "POST", "/chat/completions", {
        model: ep.model,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: EXTRACTION_PROMPT },
          { role: "user", content: text },
        ],
      });
      if (!("response" in sent)) return sent;
      const json = await sent.response.json();
      return { ok: true, value: json.choices[0].message.content };
    },
    async listModels(role: Role): Promise<ModelResult<string[] | null>> {
      const sent = await send(config[role], "GET", "/models");
      if (!("response" in sent)) return sent;
      return { ok: true, value: null };
    },
  };
}
