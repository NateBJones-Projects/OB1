/**
 * Network helpers shared between the consolidation workers.
 *
 * `fetchWithTimeout` wraps the platform `fetch` in an `AbortController` so a
 * hung upstream cannot pin the Edge Function until the 150s wall-clock kill.
 * Without this, a silently stalled provider (observed on OpenRouter during
 * hot-swap outages) blocks the three-tier fallback from ever advancing.
 *
 * `isTransientError` duplicates the classifier logic that lives in
 * `helpers.ts` (intentionally — we keep `helpers.ts` as a verbatim copy of
 * the enhanced-mcp helpers so it stays diff-clean against upstream). The
 * worker fallback loops use this to distinguish 5xx/429/network errors
 * (retry on the next provider) from 4xx/auth/parse errors (abort the chain).
 */

/** Default per-provider LLM fetch timeout. Can be overridden via FETCH_TIMEOUT_MS env. */
export const DEFAULT_LLM_FETCH_TIMEOUT_MS = 60_000;

/** Default Supabase / short-hop fetch timeout. */
export const DEFAULT_DB_FETCH_TIMEOUT_MS = 30_000;

/** Resolve the LLM fetch timeout from env, falling back to the default. */
export function resolveLlmFetchTimeoutMs(): number {
  const raw = Deno.env.get("FETCH_TIMEOUT_MS");
  if (!raw) return DEFAULT_LLM_FETCH_TIMEOUT_MS;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_LLM_FETCH_TIMEOUT_MS;
  return parsed;
}

/**
 * `fetch` with a hard `AbortController` timeout.
 *
 * Throws `Error("timeout after <ms>ms")` on abort — which matches the
 * shape that `isTransientError` recognizes, so the fallback chain
 * correctly advances to the next provider instead of crashing the job.
 */
export async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(new Error(`timeout after ${timeoutMs}ms`)),
    timeoutMs,
  );
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (err) {
    // Normalize AbortError to a transient-shaped message so fallback logic catches it.
    if (err instanceof DOMException && err.name === "AbortError") {
      throw new Error(`timeout after ${timeoutMs}ms`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * True for errors worth retrying on the next provider: network failures,
 * 429, 5xx statuses, and `AbortController` timeouts.
 *
 * Intentionally mirrors `helpers.ts:isTransientError` — see the module
 * docstring for why we duplicate the predicate here.
 */
export function isTransientError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const msg = err.message;
  if (/fetch failed|network|ECONNRESET|ETIMEDOUT|UND_ERR|timeout after/i.test(msg)) return true;
  if (/\b(429|500|502|503|504|529)\b/.test(msg)) return true;
  return false;
}
