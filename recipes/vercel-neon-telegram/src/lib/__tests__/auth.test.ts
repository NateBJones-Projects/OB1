import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { extractKey, validateAccessKey, requireAuth } from "../auth";

const TEST_KEY = "a".repeat(64);

describe("extractKey", () => {
  it("extracts from x-brain-key header", () => {
    const req = new Request("http://localhost/api/mcp", {
      headers: { "x-brain-key": TEST_KEY },
    });
    expect(extractKey(req)).toBe(TEST_KEY);
  });

  it("extracts from Authorization Bearer header", () => {
    const req = new Request("http://localhost/api/mcp", {
      headers: { Authorization: `Bearer ${TEST_KEY}` },
    });
    expect(extractKey(req)).toBe(TEST_KEY);
  });

  it("extracts from query param", () => {
    const req = new Request(`http://localhost/api/mcp?key=${TEST_KEY}`);
    expect(extractKey(req)).toBe(TEST_KEY);
  });

  it("returns null when no key is present", () => {
    const req = new Request("http://localhost/api/mcp");
    expect(extractKey(req)).toBeNull();
  });

  it("prefers x-brain-key header over Bearer", () => {
    const req = new Request("http://localhost/api/mcp", {
      headers: {
        "x-brain-key": "header-key",
        Authorization: "Bearer bearer-key",
      },
    });
    expect(extractKey(req)).toBe("header-key");
  });

  it("prefers Bearer over query param", () => {
    const req = new Request("http://localhost/api/mcp?key=query-key", {
      headers: { Authorization: "Bearer bearer-key" },
    });
    expect(extractKey(req)).toBe("bearer-key");
  });

  it("ignores non-Bearer Authorization schemes", () => {
    const req = new Request("http://localhost/api/mcp", {
      headers: { Authorization: "Basic dXNlcjpwYXNz" },
    });
    expect(extractKey(req)).toBeNull();
  });
});

describe("validateAccessKey", () => {
  beforeEach(() => {
    vi.stubEnv("BRAIN_ACCESS_KEY", TEST_KEY);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns true for matching key", () => {
    expect(validateAccessKey(TEST_KEY)).toBe(true);
  });

  it("returns false for wrong key", () => {
    expect(validateAccessKey("b".repeat(64))).toBe(false);
  });

  it("returns false for different length key", () => {
    expect(validateAccessKey("short")).toBe(false);
  });

  it("throws when env var is not set", () => {
    vi.stubEnv("BRAIN_ACCESS_KEY", "");
    expect(() => validateAccessKey(TEST_KEY)).toThrow(
      "BRAIN_ACCESS_KEY is not configured",
    );
  });
});

describe("requireAuth", () => {
  beforeEach(() => {
    vi.stubEnv("BRAIN_ACCESS_KEY", TEST_KEY);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns no error for valid key", () => {
    const req = new Request("http://localhost/api/mcp", {
      headers: { "x-brain-key": TEST_KEY },
    });
    const { error } = requireAuth(req);
    expect(error).toBeUndefined();
  });

  it("returns 401 for missing key", async () => {
    const req = new Request("http://localhost/api/mcp");
    const { error } = requireAuth(req);
    expect(error).toBeDefined();
    expect(error!.status).toBe(401);
  });

  it("returns 401 for wrong key", async () => {
    const req = new Request("http://localhost/api/mcp", {
      headers: { "x-brain-key": "wrong" },
    });
    const { error } = requireAuth(req);
    expect(error).toBeDefined();
    expect(error!.status).toBe(401);
  });
});
