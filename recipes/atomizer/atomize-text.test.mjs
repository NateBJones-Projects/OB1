/**
 * atomize-text.test.mjs — credential-free tests for the atomizer.
 *
 * Run: node --test atomize-text.test.mjs   (from recipes/atomizer/)
 *
 * No network and no real keys: globalThis.fetch is replaced per test, and
 * test-atomize.mjs is spawned either with empty keys (skip path) or with a
 * dummy key plus the test-support/fetch-stub.mjs preload (live path, stubbed).
 *
 * Case IDs (C1…, K1…) match the contract tables in the fork's spec for
 * staged upstream PR #532.
 */

import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { atomizeText } from "./lib/atomize-text.mjs";

const DUMMY_KEY = "test-key-not-real";
const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const SCRIPT = fileURLToPath(new URL("./test-atomize.mjs", import.meta.url));
const FETCH_STUB = new URL("./test-support/fetch-stub.mjs", import.meta.url).href;

// ── In-process fetch stub ────────────────────────────────────────────────────

const realFetch = globalThis.fetch;
let calls;

function cannedResponse(url) {
  const atoms = JSON.stringify(["a", "b"]);
  if (url === ANTHROPIC_URL) {
    return { content: [{ type: "text", text: atoms }] };
  }
  if (url === OPENROUTER_URL) {
    return { choices: [{ message: { content: atoms } }] };
  }
  return null;
}

beforeEach(() => {
  calls = [];
  globalThis.fetch = async (input, init = {}) => {
    const url = typeof input === "string" ? input : input.url;
    const payload = cannedResponse(url);
    if (!payload) throw new Error(`test fetch stub: unexpected request to ${url}`);
    calls.push({ url, body: JSON.parse(init.body) });
    return new Response(JSON.stringify(payload), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

// ── Child-process helper for test-atomize.mjs ────────────────────────────────

function runScript(args, envOverrides, { preload = false } = {}) {
  const { NODE_TEST_CONTEXT: _ignored, ...baseEnv } = process.env;
  const nodeArgs = preload ? ["--import", FETCH_STUB, SCRIPT, ...args] : [SCRIPT, ...args];
  const res = spawnSync(process.execPath, nodeArgs, {
    env: { ...baseEnv, ...envOverrides },
    encoding: "utf8",
    timeout: 15_000,
  });
  return { code: res.status, stdout: res.stdout ?? "", stderr: res.stderr ?? "" };
}

// ── US1: Anthropic default model (FR-002, FR-003) ────────────────────────────

test("C1 anthropic default model is claude-sonnet-5-5", async () => {
  const atoms = await atomizeText("x", { provider: "anthropic", anthropicApiKey: DUMMY_KEY });
  assert.deepEqual(atoms, ["a", "b"]);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, ANTHROPIC_URL);
  assert.equal(calls[0].body.model, "claude-sonnet-5-5");
});

test("C2 anthropic explicit model is sent verbatim", async () => {
  await atomizeText("x", {
    provider: "anthropic",
    anthropicApiKey: DUMMY_KEY,
    anthropicModel: "claude-opus-5-5",
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].body.model, "claude-opus-5-5");
});

test("K4 anthropic CLI with key requests the default model (stubbed)", () => {
  const r = runScript(["--provider=anthropic"], { ANTHROPIC_API_KEY: DUMMY_KEY }, { preload: true });
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /\[test\] PASS — got 2 atoms/);
  assert.match(r.stderr, /\[fetch-stub\] api\.anthropic\.com model=claude-sonnet-5-5/);
});

// ── US2: OpenRouter default, guards, no network (FR-003, FR-004, FR-005) ────

test("C3 openrouter default model is unchanged", async () => {
  const atoms = await atomizeText("x", { provider: "openrouter", openrouterApiKey: DUMMY_KEY });
  assert.deepEqual(atoms, ["a", "b"]);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, OPENROUTER_URL);
  assert.equal(calls[0].body.model, "anthropic/claude-sonnet-4.5");
});

test("C4 openrouter explicit model is sent verbatim", async () => {
  await atomizeText("x", {
    provider: "openrouter",
    openrouterApiKey: DUMMY_KEY,
    openrouterModel: "some/other-model",
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].body.model, "some/other-model");
});

test("C5 anthropic and openrouter without a key reject before any fetch", async () => {
  await assert.rejects(atomizeText("x", { provider: "anthropic" }), /requires opts\.anthropicApiKey/);
  await assert.rejects(atomizeText("x", { provider: "openrouter" }), /requires opts\.openrouterApiKey/);
  assert.equal(calls.length, 0);
});

test("C6 unknown provider rejects before any fetch", async () => {
  await assert.rejects(atomizeText("x", { provider: "codex" }), /unknown provider 'codex'/);
  assert.equal(calls.length, 0);
});

test("network guard: the test stub refuses any other host", async () => {
  await assert.rejects(globalThis.fetch("https://example.invalid/"), /unexpected request/);
});

// ── US2: test-atomize.mjs skips cleanly without a key (FR-007) ───────────────

test("K1 openrouter CLI without a key skips with exit 0", () => {
  const r = runScript([], { OPENROUTER_API_KEY: "", ANTHROPIC_API_KEY: "" });
  assert.equal(r.code, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /skipped: no API key for openrouter/);
  assert.doesNotMatch(r.stdout, /\[test\] provider:/);
});

test("K2 anthropic CLI without a key skips with exit 0", () => {
  const r = runScript(["--provider=anthropic"], { ANTHROPIC_API_KEY: "", OPENROUTER_API_KEY: "" });
  assert.equal(r.code, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /skipped: no API key for anthropic/);
  assert.doesNotMatch(r.stdout, /\[test\] provider:/);
});

test("K3 openrouter CLI with key is unchanged (stubbed)", () => {
  const r = runScript([], { OPENROUTER_API_KEY: DUMMY_KEY }, { preload: true });
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /\[test\] PASS — got 2 atoms/);
  assert.match(r.stderr, /\[fetch-stub\] openrouter\.ai model=anthropic\/claude-sonnet-4\.5/);
});
