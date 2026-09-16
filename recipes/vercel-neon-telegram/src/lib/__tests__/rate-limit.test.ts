import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Each test gets a fresh module to avoid shared state
async function freshRateLimiter() {
  const mod = await import("../rate-limit");
  return mod.checkRateLimit;
}

describe("checkRateLimit", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.resetModules();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("allows requests under the limit", async () => {
    const checkRateLimit = await freshRateLimiter();
    for (let i = 0; i < 10; i++) {
      expect(checkRateLimit().ok).toBe(true);
    }
  });

  it("blocks after 30 requests in a minute", async () => {
    const checkRateLimit = await freshRateLimiter();
    for (let i = 0; i < 30; i++) {
      expect(checkRateLimit().ok).toBe(true);
    }
    expect(checkRateLimit().ok).toBe(false);
  });

  it("resets after the window expires", async () => {
    const checkRateLimit = await freshRateLimiter();
    // Exhaust the limit
    for (let i = 0; i < 30; i++) {
      checkRateLimit();
    }
    expect(checkRateLimit().ok).toBe(false);

    // Advance past the 1-minute window
    vi.advanceTimersByTime(61_000);

    expect(checkRateLimit().ok).toBe(true);
  });

  it("prunes old entries as time passes", async () => {
    const checkRateLimit = await freshRateLimiter();
    // Use 20 requests
    for (let i = 0; i < 20; i++) {
      checkRateLimit();
    }

    // Advance 61s — those 20 should expire
    vi.advanceTimersByTime(61_000);

    // Should be able to use 30 more
    for (let i = 0; i < 30; i++) {
      expect(checkRateLimit().ok).toBe(true);
    }
    expect(checkRateLimit().ok).toBe(false);
  });
});
