import type { Context } from "hono";

// Consistent JSON error shape used across every route. The dashboard's
// fetch wrapper (lib/api.ts → ApiError) reads `error` from the body — no
// other field is required by the consumer. Status codes follow standard
// REST conventions: 400 for malformed input, 401 for auth failures, 404
// for missing rows, 500 for server-side faults.
export function fail(c: Context, status: number, message: string) {
  return c.json({ error: message }, status as 400 | 401 | 404 | 500);
}

// Wrap a thrown error into a 500. Squashes the stack out of the response
// because this is a public API; the actual stack lands in `console.error`
// where Workers Logs can pick it up.
export function fromError(c: Context, err: unknown, fallback = "Internal error") {
  const msg = err instanceof Error ? err.message : String(err ?? fallback);
  console.error("rest-gateway error:", msg, err);
  return fail(c, 500, msg || fallback);
}

// Parse a positive-integer query param with a default. Returns the default
// for missing/blank/NaN/negative input. Used for pagination + window sizes.
export function intParam(value: string | undefined, fallback: number, max?: number): number {
  if (!value) return fallback;
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n) || n < 0) return fallback;
  return max && n > max ? max : n;
}

// Parse a boolean-ish query param. Accepts "true"/"1"/"yes" as true; everything
// else (including missing) returns the fallback. Used for `exclude_restricted`,
// `dry_run`, etc.
export function boolParam(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  return /^(true|1|yes)$/i.test(value);
}
