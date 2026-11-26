import type { GetEnv, OkConfig, ResolvedConfig, Warning } from "./types.ts";

export function resolveConfig(_getEnv: GetEnv): ResolvedConfig {
  throw new Error("not implemented");
}

export function keyOverHttpWarnings(_config: OkConfig): Warning[] {
  throw new Error("not implemented");
}
