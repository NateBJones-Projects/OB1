/**
 * Scripted `fetch` standing in for the model server (and for PostgREST in the
 * thought-store tests). No network: tests run without --allow-net.
 */

export interface RecordedRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  /** Parsed JSON body, the raw text when it is not JSON, or undefined. */
  body: unknown;
}

export interface Reply {
  status?: number;
  /** An object is sent as JSON; a string is sent as-is. */
  body?: unknown;
  headers?: Record<string, string>;
}

export type Handler =
  | Reply
  | { networkError: string }
  /** Never answers; rejects with an AbortError once the request's signal fires. */
  | { hang: true }
  /** Answers `reply` only after `release()` is called (or rejects on abort). */
  | { hold: Reply }
  | ((req: RecordedRequest) => Reply | Promise<Reply>);

interface Route {
  method: string;
  url: string;
  handlers: Handler[];
  calls: number;
}

function abortError(): DOMException {
  return new DOMException("The signal has been aborted", "AbortError");
}

export class FakeFetch {
  readonly requests: RecordedRequest[] = [];
  readonly unmatched: RecordedRequest[] = [];
  private routes: Route[] = [];
  private held: Array<() => void> = [];
  /** Requests that have started and not yet settled. */
  inFlight = 0;

  /**
   * Register a route. `url` matches the full request URL, or the URL without
   * its query string. With several handlers, call N uses handler N and the
   * last one repeats.
   */
  on(method: string, url: string, ...handlers: Handler[]): this {
    if (handlers.length === 0) throw new Error("FakeFetch.on needs a handler");
    this.routes.push({ method: method.toUpperCase(), url, handlers, calls: 0 });
    return this;
  }

  /** Release every held reply. */
  release(): void {
    const pending = this.held.splice(0);
    for (const go of pending) go();
  }

  /** Number of held replies waiting for release(). */
  get heldCount(): number {
    return this.held.length;
  }

  readonly fetch: typeof fetch = async (input: string | URL | Request, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(input, init);
    const signal = init?.signal ?? request.signal;
    const headers: Record<string, string> = {};
    request.headers.forEach((v, k) => (headers[k] = v));
    const text = request.body ? await request.text() : "";
    let body: unknown = undefined;
    if (text) {
      try {
        body = JSON.parse(text);
      } catch {
        body = text;
      }
    }
    const rec: RecordedRequest = { url: request.url, method: request.method.toUpperCase(), headers, body };
    this.requests.push(rec);

    const bare = rec.url.split("?")[0];
    const route = this.routes.find((r) => r.method === rec.method && (r.url === rec.url || r.url === bare));
    if (!route) {
      this.unmatched.push(rec);
      throw new TypeError(`FakeFetch: no route for ${rec.method} ${rec.url}`);
    }
    const handler = route.handlers[Math.min(route.calls, route.handlers.length - 1)];
    route.calls++;

    this.inFlight++;
    try {
      return await this.answer(handler, rec, signal);
    } finally {
      this.inFlight--;
    }
  };

  private async answer(handler: Handler, rec: RecordedRequest, signal?: AbortSignal | null): Promise<Response> {
    if (signal?.aborted) throw abortError();
    if (typeof handler === "function") return toResponse(await handler(rec));
    if ("networkError" in handler) throw new TypeError(handler.networkError);
    if ("hang" in handler) {
      return await new Promise<Response>((_, reject) => {
        signal?.addEventListener("abort", () => reject(abortError()), { once: true });
      });
    }
    if ("hold" in handler) {
      const reply = handler.hold;
      return await new Promise<Response>((resolve, reject) => {
        this.held.push(() => resolve(toResponse(reply)));
        signal?.addEventListener("abort", () => reject(abortError()), { once: true });
      });
    }
    return toResponse(handler);
  }
}

function toResponse(reply: Reply): Response {
  const status = reply.status ?? 200;
  const headers = new Headers(reply.headers ?? {});
  let payload: string | null = null;
  if (reply.body !== undefined) {
    if (typeof reply.body === "string") {
      payload = reply.body;
    } else {
      payload = JSON.stringify(reply.body);
      if (!headers.has("content-type")) headers.set("content-type", "application/json");
    }
  }
  const nullBody = status === 204 || status === 304;
  return new Response(nullBody ? null : payload, { status, headers });
}

/** A unit-length 1536-dimension vector pointing along axis `axis` (for scripted similarity). */
export function axisVector(axis: number, length = 1536): number[] {
  const v = new Array(length).fill(0);
  v[axis % length] = 1;
  return v;
}

/** An OpenAI-compatible embeddings reply. */
export function embeddingReply(vector: number[]): Reply {
  return { status: 200, body: { object: "list", data: [{ object: "embedding", index: 0, embedding: vector }] } };
}

/** An OpenAI-compatible chat-completions reply. */
export function chatReply(content: string): Reply {
  return { status: 200, body: { choices: [{ index: 0, message: { role: "assistant", content } }] } };
}

/** An OpenAI-compatible /models listing. */
export function modelsReply(ids: string[]): Reply {
  return { status: 200, body: { object: "list", data: ids.map((id) => ({ id, object: "model" })) } };
}
