import { resolveConfig } from "./config.ts";
import { createModelClient } from "./model_client.ts";
import type { Deps, SetupReport } from "./types.ts";

export async function runSetupCheck(deps: Deps): Promise<SetupReport> {
  const config = resolveConfig(deps.getEnv);
  if (!config.ok) throw new Error("not implemented");
  const client = createModelClient(config, deps.modelFetch);
  const [embedding, chat] = await Promise.all([client.embed("sample"), client.chat("sample")]);
  return { ok: embedding.ok && chat.ok, checks: [], warnings: [], thoughts: { other_model: null }, config: null };
}
