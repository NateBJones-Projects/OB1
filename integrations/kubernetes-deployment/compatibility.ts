export type ThoughtId = string | number | bigint;

export function normalizeThoughtId(id: ThoughtId): string {
  return String(id);
}