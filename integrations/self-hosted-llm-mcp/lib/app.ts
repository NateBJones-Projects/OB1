import type { Deps, FetchApp } from "./types.ts";

export function createApp(_deps: Deps): FetchApp {
  throw new Error("not implemented");
}

export function productionDeps(): Deps {
  throw new Error("not implemented");
}
