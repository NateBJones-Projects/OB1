import { EXTRACTION_PROMPT } from "./metadata.ts";
import type { EndpointConfig, ModelClient, ModelResult, OkConfig, OutcomeKind, Role } from "./types.ts";

const EXPECTED_DIMENSIONS = 1536;

type Failure = { ok: false; kind: OutcomeKind; message: string };
type Sent = { status: number; text: string } | Failure;

// deno-lint-ignore no-explicit-any
function parseJson(text: string): any {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

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

  function httpFailure(ep: EndpointConfig, status: number, text: string): Failure {
    if (status === 401 || status === 403) {
      return {
        ok: false,
        kind: "auth_rejected",
        message: `The ${ep.role} model server at ${ep.base} access key rejected (HTTP ${status}).`,
      };
    }
    if (status === 404) return modelNotFound(ep);
    if ((status === 400 || status === 422) && namesModelAsUnknown(ep, text)) return modelNotFound(ep);
    return {
      ok: false,
      kind: "http_error",
      message: `The ${ep.role} model server at ${ep.base} answered HTTP ${status}: ${text}`,
    };
  }

  function namesModelAsUnknown(ep: EndpointConfig, text: string): boolean {
    const body = text.toLowerCase();
    return body.includes(ep.model.toLowerCase()) && /not found|unknown|does not exist/.test(body);
  }

  function badResponse(ep: EndpointConfig, missing: string): Failure {
    return {
      ok: false,
      kind: "bad_response",
      message: `The ${ep.role} model server at ${ep.base} answered, but the reply lacks ${missing}.`,
    };
  }

  function modelNotFound(ep: EndpointConfig): Failure {
    return {
      ok: false,
      kind: "model_not_found",
      message: `The ${ep.role} model "${ep.model}" was not found on the model server at ${ep.base}.`,
    };
  }

  return {
    async embed(text: string): Promise<ModelResult<number[]>> {
      const ep = config.embedding;
      const request = { model: ep.model, input: text, dimensions: EXPECTED_DIMENSIONS };
      let sent = await send(ep, "POST", "/embeddings", request);
      if ("status" in sent && (sent.status === 400 || sent.status === 422) && /dimension|matryoshka/i.test(sent.text)) {
        const { dimensions: _dropped, ...withoutDimensions } = request;
        sent = await send(ep, "POST", "/embeddings", withoutDimensions);
      }
      if (!("status" in sent)) return sent;
      if (sent.status < 200 || sent.status > 299) return httpFailure(ep, sent.status, sent.text);
      const vector = parseJson(sent.text)?.data?.[0]?.embedding;
      if (!Array.isArray(vector) || !vector.every((n) => typeof n === "number")) {
        return badResponse(ep, "data[0].embedding (an array of numbers)");
      }
      if (vector.length !== EXPECTED_DIMENSIONS) {
        return {
          ok: false,
          kind: "wrong_dimension",
          message: `Embedding model "${ep.model}" returned ${vector.length}-dimension vectors; ` +
            `this brain stores ${EXPECTED_DIMENSIONS}. Choose a model that can output ${EXPECTED_DIMENSIONS} dimensions (see README).`,
        };
      }
      return { ok: true, value: vector };
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
      if (sent.status < 200 || sent.status > 299) return httpFailure(ep, sent.status, sent.text);
      const content = parseJson(sent.text)?.choices?.[0]?.message?.content;
      if (typeof content !== "string") return badResponse(ep, "choices[0].message.content");
      return { ok: true, value: content };
    },
    async listModels(role: Role): Promise<ModelResult<string[] | null>> {
      const ep = config[role];
      const sent = await send(ep, "GET", "/models");
      if (!("status" in sent)) return sent;
      if (sent.status < 200 || sent.status > 299) return httpFailure(ep, sent.status, sent.text);
      return { ok: true, value: null };
    },
  };
}
