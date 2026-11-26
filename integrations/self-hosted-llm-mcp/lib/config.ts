import type { EndpointConfig, GetEnv, OkConfig, ResolvedConfig, Warning } from "./types.ts";

const BASE_REASON = "must start with http:// or https://";

function stripSlash(base: string): string {
  return base.replace(/\/+$/, "");
}

export function resolveConfig(rawGetEnv: GetEnv): ResolvedConfig {
  // A blank value (empty or whitespace only) counts as unset.
  const getEnv: GetEnv = (name) => {
    const v = rawGetEnv(name);
    return v === undefined || v.trim() === "" ? undefined : v;
  };
  const missing = ["EMBEDDING_API_BASE", "EMBEDDING_MODEL", "CHAT_MODEL"].filter((n) => getEnv(n) === undefined);
  if (missing.length > 0) return { ok: false, missing, invalid: [] };
  const invalid: { setting: string; reason: string }[] = [];
  if (!/^https?:\/\//.test(getEnv("EMBEDDING_API_BASE")!)) {
    invalid.push({ setting: "EMBEDDING_API_BASE", reason: BASE_REASON });
  }
  const rawChatBase = getEnv("CHAT_API_BASE");
  if (rawChatBase !== undefined && !/^https?:\/\//.test(rawChatBase)) {
    invalid.push({ setting: "CHAT_API_BASE", reason: BASE_REASON });
  }
  if (invalid.length > 0) return { ok: false, missing: [], invalid };
  const embedding: EndpointConfig = {
    role: "embedding",
    base: stripSlash(getEnv("EMBEDDING_API_BASE")!),
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
    base: chatBase === undefined ? embedding.base : stripSlash(chatBase),
    key: getEnv("CHAT_API_KEY") ?? (chatBase === undefined ? embedding.key : undefined),
    model: getEnv("CHAT_MODEL")!,
  };
  return { ok: true, embedding, chat, timeoutMs: 60000, chatInherits };
}

export function keyOverHttpWarnings(_config: OkConfig): Warning[] {
  throw new Error("not implemented");
}
