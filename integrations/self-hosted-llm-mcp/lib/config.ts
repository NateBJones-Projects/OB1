import type { EndpointConfig, GetEnv, OkConfig, ResolvedConfig, Warning } from "./types.ts";

export function resolveConfig(getEnv: GetEnv): ResolvedConfig {
  const embedding: EndpointConfig = {
    role: "embedding",
    base: getEnv("EMBEDDING_API_BASE")!,
    key: getEnv("EMBEDDING_API_KEY"),
    model: getEnv("EMBEDDING_MODEL")!,
  };
  const chat: EndpointConfig = {
    role: "chat",
    base: getEnv("CHAT_API_BASE")!,
    key: getEnv("CHAT_API_KEY"),
    model: getEnv("CHAT_MODEL")!,
  };
  return { ok: true, embedding, chat, timeoutMs: 60000, chatInherits: [] };
}

export function keyOverHttpWarnings(_config: OkConfig): Warning[] {
  throw new Error("not implemented");
}
