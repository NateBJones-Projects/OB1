import { resolveConfig } from "./config.ts";
import { createModelClient } from "./model_client.ts";
import type { CheckResult, Deps, OkConfig, SetupConfigBlock, SetupReport } from "./types.ts";

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
    return { ok: false, checks: [{ id: "config", ok: false, reason }], warnings: [], thoughts: { other_model: null }, config: null };
  }
  const client = createModelClient(config, deps.modelFetch);
  const [embedding, chat] = await Promise.all([client.embed("sample"), client.chat("sample")]);
  const checks: CheckResult[] = [
    { id: "config", ok: true },
    { id: "embedding_reachable", role: "embedding", ok: true },
    { id: "embedding_model", role: "embedding", ok: true },
    { id: "embedding_dimension", role: "embedding", ok: embedding.ok },
    { id: "chat_reachable", role: "chat", ok: true },
    { id: "chat_model", role: "chat", ok: true },
    { id: "chat_metadata", role: "chat", ok: chat.ok },
  ];
  return { ok: checks.every((c) => c.ok), checks, warnings: [], thoughts: { other_model: null }, config: configBlock(config) };
}
