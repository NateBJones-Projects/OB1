import type { ThoughtStore } from "./types.ts";

export function createSupabaseThoughtStore(
  _url: string,
  _serviceRoleKey: string,
  _fetch: typeof fetch,
): ThoughtStore {
  throw new Error("not implemented");
}
