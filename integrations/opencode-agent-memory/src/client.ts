import { readFile } from "node:fs/promises";
import { homedir } from "node:os";

export interface Options {
  endpoint: string;
  workspaceId: string;
  projectId?: string;
  keyEnv: string;
  keyFile?: string;
  autoCapture: boolean;
  maxItems: number;
  maxTokens: number;
  maxContextBytes: number;
  timeoutMs: number;
  captureTimeoutMs: number;
  autoReview: boolean;
  reviewModel?: { providerID: string; id: string; variant?: string };
  reviewTimeoutMs: number;
}

export function options(input: Record<string, unknown>, env = process.env): Options {
  const text = (key: string, fallback?: string) => {
    const value = input[key] ?? fallback;
    if (value === undefined) return undefined;
    if (typeof value !== "string" || !value.trim()) throw new Error(`Invalid ${key}`);
    return value.trim();
  };
  const number = (key: string, fallback: number, min: number, max: number) => {
    const value = input[key] ?? fallback;
    if (!Number.isInteger(value) || (value as number) < min || (value as number) > max)
      throw new Error(`Invalid ${key}`);
    return value as number;
  };
  for (const key of ["autoCapture", "autoReview", "allowInsecureHttp"]) {
    if (input[key] !== undefined && typeof input[key] !== "boolean") throw new Error(`Invalid ${key}`);
  }
  const endpoint = text("endpoint", env.OB1_AGENT_MEMORY_ENDPOINT);
  const workspaceId = text("workspaceId", env.OB1_AGENT_MEMORY_WORKSPACE_ID);
  if (!endpoint || !workspaceId) throw new Error("endpoint and workspaceId are required");
  const url = new URL(endpoint);
  let reviewModel: Options["reviewModel"];
  if (input.reviewModel !== undefined) {
    const m = input.reviewModel as Record<string, unknown>;
    if (!m || typeof m !== "object" || typeof m.providerID !== "string" || !m.providerID.trim() ||
      typeof m.id !== "string" || !m.id.trim() || (m.variant !== undefined && typeof m.variant !== "string"))
      throw new Error("Invalid reviewModel");
    reviewModel = { providerID: m.providerID, id: m.id, ...(m.variant ? { variant: m.variant as string } : {}) };
  }
  if (input.autoReview === true && !reviewModel) throw new Error("autoReview requires an explicit reviewModel");
  if (url.username || url.password || url.search || url.hash) throw new Error("Use a credential-free endpoint URL");
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && (local || input.allowInsecureHttp === true)))
    throw new Error("Remote endpoints require HTTPS (or explicit allowInsecureHttp for a trusted LAN)");
  return {
    endpoint: url.href.replace(/\/$/, ""), workspaceId,
    projectId: text("projectId"), keyEnv: text("keyEnv") ?? "OB1_AGENT_MEMORY_KEY",
    keyFile: text("keyFile", env.OB1_AGENT_MEMORY_KEY_FILE),
    autoCapture: input.autoCapture === true,
    maxItems: number("maxItems", 3, 1, 10), maxTokens: number("maxTokens", 1500, 256, 4000),
    maxContextBytes: number("maxContextBytes", 6000, 512, 16000),
    timeoutMs: number("timeoutMs", 5000, 100, 30000),
    captureTimeoutMs: number("captureTimeoutMs", 30000, 100, 120000),
    autoReview: input.autoReview === true, reviewModel,
    reviewTimeoutMs: number("reviewTimeoutMs", 120000, 100, 300000),
  };
}

export class MemoryClient {
  constructor(readonly config: Options, private readonly request = fetch) {}

  async post(path: string, body: unknown, signal?: AbortSignal): Promise<unknown> {
    return this.send("POST", path, body, signal);
  }

  async get(path: string, signal?: AbortSignal): Promise<unknown> {
    return this.send("GET", path, undefined, signal);
  }

  async patch(path: string, body: unknown, signal?: AbortSignal): Promise<unknown> {
    return this.send("PATCH", path, body, signal);
  }

  private async send(method: string, path: string, body: unknown, signal?: AbortSignal): Promise<unknown> {
    const c = this.config;
    const key = process.env[c.keyEnv] || (c.keyFile
      ? (await readFile(c.keyFile.replace(/^~(?=\/)/, homedir()), "utf8")).trim() : "");
    if (!key) throw new Error("OB1 credential unavailable");
    const response = await this.request(c.endpoint + path, {
      method, redirect: "error",
      signal: AbortSignal.any([AbortSignal.timeout(c.timeoutMs), ...(signal ? [signal] : [])]),
      headers: { "Content-Type": "application/json", "x-brain-key": key },
      body: JSON.stringify(body),
    });
    if (!response.ok) throw new Error(`OB1 HTTP ${response.status}`);
    const reader = response.body?.getReader();
    if (!reader) throw new Error("OB1 empty response");
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > 1_048_576) throw new Error("OB1 response too large");
        chunks.push(value);
      }
      return JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } finally {
      await reader.cancel().catch(() => {});
      reader.releaseLock();
    }
  }
}
