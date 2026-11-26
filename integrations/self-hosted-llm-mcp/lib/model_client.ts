import type { ModelClient, OkConfig } from "./types.ts";

export function createModelClient(_config: OkConfig, _fetch: typeof fetch): ModelClient {
  throw new Error("not implemented");
}
