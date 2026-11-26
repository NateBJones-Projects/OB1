import type { EndpointConfig, GetEnv, OkConfig, ResolvedConfig, Warning } from "./types.ts";

export function resolveConfig(getEnv: GetEnv): ResolvedConfig {
  const missing = ["EMBEDDING_API_BASE", "EMBEDDING_MODEL", "CHAT_MODEL"].filter((n) => getEnv(n) === undefined);
  if (missing.length > 0) return { ok: false, missing, invalid: [] };
  const embedding: EndpointConfig = {
    role: "embedding",
    base: getEnv("EMBEDDING_API_BASE")!,
    key: getEnv("EMBEDDING_API_KEY"),
    model: getEnv("EMBEDDING_MODEL")!,
  };
  const chatBase = getEnv("CHAT_API_BASE");
  const chatInherits: ("base" | "key")[] = [];
  if (chatBase === undefined) chatInherits.push("base");
  const chatKey = getEnv("CHAT_API_KEY");
  if (chatKey === undefined && chatBase === undefined && embedding.key !== undefined) chatInherits.push("key");
  const chat: EndpointConfig = {
    role: "chat",
    base: chatBase ?? embedding.base,
    key: getEnv("CHAT_API_KEY") ?? (chatBase === undefined ? embedding.key : undefined),
    model: getEnv("CHAT_MODEL")!,
  };
  return { ok: true, embedding, chat, timeoutMs: 60000, chatInherits };
}

export function keyOverHttpWarnings(_config: OkConfig): Warning[] {
  throw new Error("not implemented");
}
