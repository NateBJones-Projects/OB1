import { resolveConfig } from "./config.ts";
import { parseUsableMetadata } from "./metadata.ts";
import { createModelClient } from "./model_client.ts";
import type { CheckResult, Deps, ModelResult, OkConfig, Role, SetupConfigBlock, SetupReport } from "./types.ts";

const CHECK_IDS: [CheckResult["id"], Role][] = [
  ["embedding_reachable", "embedding"],
  ["embedding_model", "embedding"],
  ["embedding_dimension", "embedding"],
  ["chat_reachable", "chat"],
  ["chat_model", "chat"],
  ["chat_metadata", "chat"],
];

/** The server answered unless the call itself failed or the key was refused. */
function reachable(role: Role, listing: ModelResult<string[] | null>): CheckResult {
  const id = role === "embedding" ? "embedding_reachable" : "chat_reachable";
  if (!listing.ok && ["unreachable", "timeout", "auth_rejected"].includes(listing.kind)) {
    return { id, role, ok: false, reason: listing.message };
  }
  return { id, role, ok: true };
}

function configBlock(c: OkConfig): SetupConfigBlock {
  return {
    embedding: { base: c.embedding.base, model: c.embedding.model, key_set: c.embedding.key !== undefined },
    chat: { base: c.chat.base, model: c.chat.model, key_set: c.chat.key !== undefined, inherits: c.chatInherits },
    timeout_ms: c.timeoutMs,
  };
}

export async function runSetupCheck(deps: Deps): Promise<SetupReport> {
  const config = resolveConfig(deps.getEnv);
  if (!config.ok) {
    const parts: string[] = [];
    if (config.missing.length > 0) parts.push(`Missing required settings: ${config.missing.join(", ")}.`);
    for (const i of config.invalid) parts.push(`${i.setting} is invalid: ${i.reason}.`);
    const reason = parts.join(" ");
    const skipped = "skipped: configuration incomplete";
    const checks: CheckResult[] = [
      { id: "config", ok: false, reason },
      ...CHECK_IDS.map(([id, role]) => ({ id, role, ok: false, reason: skipped })),
    ];
    return { ok: false, checks, warnings: [], thoughts: { other_model: null }, config: null };
  }
  const client = createModelClient(config, deps.modelFetch);
  const [embedding, chat, embeddingModels, chatModels] = await Promise.all([
    client.embed("sample"),
    client.chat("sample"),
    client.listModels("embedding"),
    client.listModels("chat"),
  ]);
  const checks: CheckResult[] = [
    { id: "config", ok: true },
    reachable("embedding", embeddingModels),
    { id: "embedding_model", role: "embedding", ok: true },
    { id: "embedding_dimension", role: "embedding", ok: embedding.ok },
    reachable("chat", chatModels),
    { id: "chat_model", role: "chat", ok: true },
    { id: "chat_metadata", role: "chat", ok: chat.ok && parseUsableMetadata(chat.value) !== null },
  ];
  return { ok: checks.every((c) => c.ok), checks, warnings: [], thoughts: { other_model: null }, config: configBlock(config) };
}
