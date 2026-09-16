/**
 * Simple in-memory rate limiter for serverless.
 * Resets on cold start — acceptable for personal use.
 * Prevents runaway AI agent loops from burning OpenAI credits.
 */

const WINDOW_MS = 60_000; // 1 minute
const MAX_REQUESTS = 30; // 30 captures per minute

const requests: number[] = [];

export function checkRateLimit(): { ok: boolean } {
  const now = Date.now();
  // Prune old entries
  while (requests.length > 0 && requests[0] < now - WINDOW_MS) {
    requests.shift();
  }
  if (requests.length >= MAX_REQUESTS) {
    return { ok: false };
  }
  requests.push(now);
  return { ok: true };
}
