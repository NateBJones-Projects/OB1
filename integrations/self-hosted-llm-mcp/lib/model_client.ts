import { EXTRACTION_PROMPT } from "./metadata.ts";
import type { EndpointConfig, ModelClient, ModelResult, OkConfig, OutcomeKind, Role } from "./types.ts";

type Failure = { ok: false; kind: OutcomeKind; message: string };
type Sent = { status: number; text: string } | Failure;

export function createModelClient(config: OkConfig, doFetch: typeof fetch): ModelClient {
  async function send(ep: EndpointConfig, method: string, path: string, body?: unknown): Promise<Sent> {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (ep.key) headers["Authorization"] = `Bearer ${ep.key}`;
    const signal = AbortSignal.timeout(config.timeoutMs);
    try {
      const response = await doFetch(`${ep.base}${path}`, {
        method,
        headers,
        signal,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      return { status: response.status, text: await response.text() };
    } catch (_err) {
      if (signal.aborted) {
        return {
          ok: false,
          kind: "timeout",
          message: `The ${ep.role} model server at ${ep.base} gave no complete response within ${config.timeoutMs} ms. ` +
            `Raise FETCH_TIMEOUT_MS if the server is slow.`,
        };
      }
      return {
        ok: false,
        kind: "unreachable",
        message: `The ${ep.role} model server at ${ep.base} could not be reached.`,
      };
    }
  }

  function httpFailure(ep: EndpointConfig, status: number): Failure {
    if (status === 401 || status === 403) {
      return {
        ok: false,
        kind: "auth_rejected",
        message: `The ${ep.role} model server at ${ep.base} access key rejected (HTTP ${status}).`,
      };
    }
    throw new Error("not implemented");
  }

  return {
    async embed(text: string): Promise<ModelResult<number[]>> {
      const ep = config.embedding;
      const sent = await send(ep, "POST", "/embeddings", { model: ep.model, input: text, dimensions: 1536 });
      if (!("status" in sent)) return sent;
      if (sent.status < 200 || sent.status > 299) return httpFailure(ep, sent.status);
      const json = JSON.parse(sent.text);
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
      if (!("status" in sent)) return sent;
      if (sent.status < 200 || sent.status > 299) return httpFailure(ep, sent.status);
      const json = JSON.parse(sent.text);
      return { ok: true, value: json.choices[0].message.content };
    },
    async listModels(role: Role): Promise<ModelResult<string[] | null>> {
      const ep = config[role];
      const sent = await send(ep, "GET", "/models");
      if (!("status" in sent)) return sent;
      if (sent.status < 200 || sent.status > 299) return httpFailure(ep, sent.status);
      return { ok: true, value: null };
    },
  };
}
