import type { EndpointConfig, GetEnv, OkConfig, ResolvedConfig, Warning } from "./types.ts";

const HTTP_URL = /^https?:\/\//;
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

  const embeddingBase = getEnv("EMBEDDING_API_BASE");
  const embeddingModel = getEnv("EMBEDDING_MODEL");
  const chatModel = getEnv("CHAT_MODEL");
  const chatBase = getEnv("CHAT_API_BASE");
  const chatKey = getEnv("CHAT_API_KEY");
  const embeddingKey = getEnv("EMBEDDING_API_KEY");
  const rawTimeout = getEnv("FETCH_TIMEOUT_MS");

  const missing: string[] = [];
  if (embeddingBase === undefined) missing.push("EMBEDDING_API_BASE");
  if (embeddingModel === undefined) missing.push("EMBEDDING_MODEL");
  if (chatModel === undefined) missing.push("CHAT_MODEL");

  const invalid: { setting: string; reason: string }[] = [];
  if (embeddingBase !== undefined && !HTTP_URL.test(embeddingBase)) {
    invalid.push({ setting: "EMBEDDING_API_BASE", reason: BASE_REASON });
  }
  if (chatBase !== undefined && !HTTP_URL.test(chatBase)) {
    invalid.push({ setting: "CHAT_API_BASE", reason: BASE_REASON });
  }
  if (rawTimeout !== undefined && !(/^[0-9]+$/.test(rawTimeout) && Number(rawTimeout) >= 1)) {
    invalid.push({ setting: "FETCH_TIMEOUT_MS", reason: "must be a positive whole number of milliseconds" });
  }
  if (missing.length > 0 || invalid.length > 0) return { ok: false, missing, invalid };

  const embedding: EndpointConfig = {
    role: "embedding",
    base: stripSlash(embeddingBase!),
    key: embeddingKey,
    model: embeddingModel!,
  };
  // The chat role takes the embedding base when it has none of its own, and the
  // embedding key only together with that base (spec Session 2026-11-26 Q11).
  const inheritsBase = chatBase === undefined;
  const inheritsKey = inheritsBase && chatKey === undefined && embeddingKey !== undefined;
  const chat: EndpointConfig = {
    role: "chat",
    base: inheritsBase ? embedding.base : stripSlash(chatBase),
    key: inheritsBase ? (chatKey ?? embeddingKey) : chatKey,
    model: chatModel!,
  };
  const chatInherits: ("base" | "key")[] = [];
  if (inheritsBase) chatInherits.push("base");
  if (inheritsKey) chatInherits.push("key");
  return { ok: true, embedding, chat, timeoutMs: rawTimeout === undefined ? 60000 : Number(rawTimeout), chatInherits };
}

export function keyOverHttpWarnings(config: OkConfig): Warning[] {
  return [config.embedding, config.chat]
    .filter((e) => e.key !== undefined && e.base.startsWith("http://"))
    .map((e) => ({
      id: "key_over_http",
      role: e.role,
      message: `An access key is configured for the ${e.role} endpoint, but it uses http://; the key travels unencrypted.`,
    }));
}
