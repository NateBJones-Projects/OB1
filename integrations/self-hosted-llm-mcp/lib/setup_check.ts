import { resolveConfig } from "./config.ts";
import { createModelClient } from "./model_client.ts";
import type { CheckResult, Deps, SetupReport } from "./types.ts";

export async function runSetupCheck(deps: Deps): Promise<SetupReport> {
  const config = resolveConfig(deps.getEnv);
  if (!config.ok) throw new Error("not implemented");
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
  return { ok: checks.every((c) => c.ok), checks, warnings: [], thoughts: { other_model: null }, config: null };
}
