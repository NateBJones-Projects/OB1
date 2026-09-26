// Unit tests for the pure helpers in classify-edges.mjs: env resolution,
// model-name prefixing and the pricing guard. No network, no Supabase.
//
// Run:  node --test recipes/typed-edge-classifier/test/*.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_ANTHROPIC_BASE_URL,
  DEFAULT_LLM_BASE_URL,
  assertPricingKnown,
  estimateCost,
  isOpenRouterHost,
  isPublicMeteredHost,
  loadEnv,
  normalizeModelForPricing,
  parseArgs,
  resolveModel,
  worstCasePerPair,
} from "../classify-edges.mjs";

const BASE = {
  OPEN_BRAIN_URL: "https://example.supabase.co",
  OPEN_BRAIN_SERVICE_KEY: "service-role-placeholder",
};

/** Capture console.log / console.warn lines while fn runs. */
function captureConsole(fn) {
  const lines = { log: [], warn: [] };
  const origLog = console.log;
  const origWarn = console.warn;
  console.log = (...a) => lines.log.push(a.join(" "));
  console.warn = (...a) => lines.warn.push(a.join(" "));
  try {
    fn();
  } finally {
    console.log = origLog;
    console.warn = origWarn;
  }
  return lines;
}

// ── loadEnv: provider detection and precedence ────────────────────────────

test("loadEnv: OPENROUTER_API_KEY alone selects the generic path with OpenRouter defaults", () => {
  const env = loadEnv({ ...BASE, OPENROUTER_API_KEY: "or-key" });
  assert.equal(env.LLM_PROVIDER, "openrouter");
  assert.equal(env.LLM_BASE_URL, DEFAULT_LLM_BASE_URL);
  assert.equal(env.LLM_API_KEY, "or-key");
  assert.equal(env.ANTHROPIC_BASE_URL, DEFAULT_ANTHROPIC_BASE_URL);
  assert.equal(env.ANTHROPIC_API_KEY, "");
});

test("loadEnv: ANTHROPIC_API_KEY alone selects the direct path", () => {
  const env = loadEnv({ ...BASE, ANTHROPIC_API_KEY: "ant-key" });
  assert.equal(env.LLM_PROVIDER, "anthropic");
  assert.equal(env.ANTHROPIC_API_KEY, "ant-key");
  assert.equal(env.ANTHROPIC_BASE_URL, DEFAULT_ANTHROPIC_BASE_URL);
});

test("loadEnv: OpenRouter wins when both legacy keys are set (unchanged behaviour)", () => {
  const env = loadEnv({ ...BASE, OPENROUTER_API_KEY: "or-key", ANTHROPIC_API_KEY: "ant-key" });
  assert.equal(env.LLM_PROVIDER, "openrouter");
  assert.equal(env.LLM_API_KEY, "or-key");
});

test("loadEnv: LLM_API_KEY takes precedence over OPENROUTER_API_KEY", () => {
  const env = loadEnv({ ...BASE, LLM_API_KEY: "llm-key", OPENROUTER_API_KEY: "or-key" });
  assert.equal(env.LLM_PROVIDER, "openrouter");
  assert.equal(env.LLM_API_KEY, "llm-key");
});

test("loadEnv: LLM_API_KEY alone selects the generic path", () => {
  const env = loadEnv({ ...BASE, LLM_API_KEY: "llm-key", ANTHROPIC_API_KEY: "ant-key" });
  assert.equal(env.LLM_PROVIDER, "openrouter");
  assert.equal(env.LLM_API_KEY, "llm-key");
});

test("loadEnv: LLM_BASE_URL selects the generic path and is normalised", () => {
  const env = loadEnv({
    ...BASE,
    LLM_BASE_URL: "http://router.internal:4000/v1///",
    LLM_API_KEY: "llm-key",
  });
  assert.equal(env.LLM_PROVIDER, "openrouter");
  assert.equal(env.LLM_BASE_URL, "http://router.internal:4000/v1");
});

test("loadEnv: LLM_BASE_URL with only an Anthropic key still requires LLM_API_KEY", () => {
  assert.throws(
    () => loadEnv({ ...BASE, LLM_BASE_URL: "http://router.internal:4000/v1", ANTHROPIC_API_KEY: "ant-key" }),
    /Missing env vars: LLM_API_KEY \(or OPENROUTER_API_KEY\)/,
  );
});

test("loadEnv: ANTHROPIC_BASE_URL is honoured and normalised", () => {
  const env = loadEnv({
    ...BASE,
    ANTHROPIC_API_KEY: "ant-key",
    ANTHROPIC_BASE_URL: "https://anthropic-proxy.internal/",
  });
  assert.equal(env.LLM_PROVIDER, "anthropic");
  assert.equal(env.ANTHROPIC_BASE_URL, "https://anthropic-proxy.internal");
});

test("loadEnv: explicit LLM_PROVIDER=anthropic beats key detection", () => {
  const env = loadEnv({
    ...BASE,
    LLM_PROVIDER: "anthropic",
    OPENROUTER_API_KEY: "or-key",
    LLM_API_KEY: "llm-key",
    ANTHROPIC_API_KEY: "ant-key",
  });
  assert.equal(env.LLM_PROVIDER, "anthropic");
});

test("loadEnv: explicit LLM_PROVIDER=openrouter beats key detection", () => {
  const env = loadEnv({ ...BASE, LLM_PROVIDER: "openrouter", LLM_API_KEY: "llm-key" });
  assert.equal(env.LLM_PROVIDER, "openrouter");
});

test("loadEnv: LLM_PROVIDER is case- and whitespace-insensitive", () => {
  const env = loadEnv({ ...BASE, LLM_PROVIDER: "  Anthropic ", ANTHROPIC_API_KEY: "ant-key" });
  assert.equal(env.LLM_PROVIDER, "anthropic");
});

test("loadEnv: explicit provider without its credential fails with a targeted message", () => {
  assert.throws(
    () => loadEnv({ ...BASE, LLM_PROVIDER: "anthropic", OPENROUTER_API_KEY: "or-key" }),
    /Missing env vars: ANTHROPIC_API_KEY$/,
  );
  assert.throws(
    () => loadEnv({ ...BASE, LLM_PROVIDER: "openrouter", ANTHROPIC_API_KEY: "ant-key" }),
    /Missing env vars: LLM_API_KEY \(or OPENROUTER_API_KEY\)$/,
  );
});

test("loadEnv: unknown LLM_PROVIDER is rejected", () => {
  assert.throws(
    () => loadEnv({ ...BASE, LLM_PROVIDER: "bedrock", ANTHROPIC_API_KEY: "ant-key" }),
    /LLM_PROVIDER="bedrock" is not recognised/,
  );
});

test("loadEnv: no LLM credential at all lists every accepted variable", () => {
  assert.throws(
    () => loadEnv({ ...BASE }),
    /Missing env vars: LLM_API_KEY, OPENROUTER_API_KEY or ANTHROPIC_API_KEY/,
  );
});

test("loadEnv: still requires the Supabase variables", () => {
  assert.throws(
    () => loadEnv({ OPENROUTER_API_KEY: "or-key" }),
    /Missing env vars: OPEN_BRAIN_URL, OPEN_BRAIN_SERVICE_KEY/,
  );
});

test("loadEnv: OPEN_BRAIN_URL is stripped of trailing slash and /rest/v1 (unchanged behaviour)", () => {
  const env = loadEnv({ ...BASE, OPEN_BRAIN_URL: "https://x.supabase.co/rest/v1/", OPENROUTER_API_KEY: "k" });
  assert.equal(env.OPEN_BRAIN_URL, "https://x.supabase.co");
});

// ── resolveModel: prefix only for openrouter.ai ────────────────────────────

test("resolveModel: bare names are prefixed for the default (OpenRouter) base URL", () => {
  assert.equal(resolveModel("claude-opus-4-7", "openrouter"), "anthropic/claude-opus-4-7");
  assert.equal(
    resolveModel("claude-haiku-4-5-20251001", "openrouter", "https://openrouter.ai/api/v1"),
    "anthropic/claude-haiku-4-5-20251001",
  );
  assert.equal(
    resolveModel("claude-opus-4-7", "openrouter", "https://openrouter.ai/api/v1/"),
    "anthropic/claude-opus-4-7",
  );
});

test("resolveModel: already-prefixed names pass through on OpenRouter", () => {
  assert.equal(resolveModel("anthropic/claude-opus-4-7", "openrouter"), "anthropic/claude-opus-4-7");
  assert.equal(resolveModel("openai/gpt-4o-mini", "openrouter"), "openai/gpt-4o-mini");
});

test("resolveModel: any other host receives the name untouched", () => {
  for (const base of [
    "http://127.0.0.1:4000/v1",
    "http://localhost:11434/v1",
    "https://router.internal/v1",
    "https://api.openai.com/v1",
    "https://openrouter.ai.evil.example/v1", // substring match must NOT count
    "not a url at all",
  ]) {
    assert.equal(resolveModel("claude-opus-4-7", "openrouter", base), "claude-opus-4-7", base);
    assert.equal(resolveModel("my-router-alias", "openrouter", base), "my-router-alias", base);
  }
});

test("resolveModel: the direct Anthropic path never prefixes", () => {
  assert.equal(resolveModel("claude-opus-4-7", "anthropic"), "claude-opus-4-7");
  assert.equal(resolveModel("claude-opus-4-7", "anthropic", "https://openrouter.ai/api/v1"), "claude-opus-4-7");
});

test("resolveModel: empty model is returned as-is", () => {
  assert.equal(resolveModel("", "openrouter"), "");
  assert.equal(resolveModel(undefined, "openrouter"), undefined);
});

test("isOpenRouterHost / isPublicMeteredHost", () => {
  assert.equal(isOpenRouterHost("https://openrouter.ai/api/v1"), true);
  assert.equal(isOpenRouterHost("https://api.openrouter.ai/v1"), true);
  assert.equal(isOpenRouterHost("https://openrouter.ai.evil.example/v1"), false);
  assert.equal(isOpenRouterHost("http://127.0.0.1:4000/v1"), false);
  assert.equal(isPublicMeteredHost("https://api.anthropic.com/v1/messages"), true);
  assert.equal(isPublicMeteredHost("https://openrouter.ai/api/v1/chat/completions"), true);
  assert.equal(isPublicMeteredHost("http://router.internal:4000/v1/chat/completions"), false);
});

// ── pricing: unknown models never throw; the startup guard is host-aware ──

test("normalizeModelForPricing strips only the anthropic/ prefix", () => {
  assert.equal(normalizeModelForPricing("anthropic/claude-opus-4-7"), "claude-opus-4-7");
  assert.equal(normalizeModelForPricing("openai/gpt-4o"), "openai/gpt-4o");
  assert.equal(normalizeModelForPricing("router-alias"), "router-alias");
});

test("estimateCost: unknown model returns $0 and does not throw", () => {
  let cost;
  const lines = captureConsole(() => {
    cost = estimateCost("some-router-alias-never-seen-before", 1000, 1000);
  });
  assert.equal(cost, 0);
  assert.equal(lines.warn.length, 1, "warns once for a model nobody announced at startup");
  const again = captureConsole(() => estimateCost("some-router-alias-never-seen-before", 1000, 1000));
  assert.equal(again.warn.length, 0, "does not repeat the warning");
});

test("estimateCost: known model prices from the table (prefixed or bare)", () => {
  const bare = estimateCost("claude-opus-4-7", 1_000_000, 0);
  const prefixed = estimateCost("anthropic/claude-opus-4-7", 1_000_000, 0);
  assert.equal(bare, 15.0);
  assert.equal(prefixed, 15.0);
});

test("assertPricingKnown: unknown model on a self-hosted LLM_BASE_URL is a single notice, not an error", () => {
  const args = parseArgs(["--filter-model", "router-haiku", "--classify-model", "router-opus"]);
  const env = loadEnv({ ...BASE, LLM_BASE_URL: "http://router.internal:4000/v1", LLM_API_KEY: "k" });
  const lines = captureConsole(() => assertPricingKnown(args, env));
  assert.equal(lines.log.length, 1, "exactly one notice line");
  assert.equal(lines.warn.length, 0);
  assert.match(lines.log[0], /no pricing entry for model\(s\) router-haiku, router-opus/);
  assert.match(lines.log[0], /router\.internal:4000/);
  assert.match(lines.log[0], /\$0/);

  // The notice covers those models: per-call estimation stays silent.
  const later = captureConsole(() => {
    assert.equal(estimateCost("router-haiku", 500, 100), 0);
    assert.equal(estimateCost("router-opus", 800, 200), 0);
  });
  assert.equal(later.warn.length, 0);
  assert.equal(later.log.length, 0);

  // And --max-cost-usd keeps working: the proactive clamp is simply off.
  assert.equal(worstCasePerPair(args), 0);
});

test("assertPricingKnown: unknown model on a custom ANTHROPIC_BASE_URL is also a notice", () => {
  const args = parseArgs(["--model", "proxy-alias"]);
  const env = loadEnv({ ...BASE, ANTHROPIC_API_KEY: "k", ANTHROPIC_BASE_URL: "https://anthropic-proxy.internal" });
  const lines = captureConsole(() => assertPricingKnown(args, env));
  assert.equal(lines.log.length, 1);
  assert.match(lines.log[0], /proxy-alias/);
});

test("assertPricingKnown: unknown model on OpenRouter still refuses (unchanged behaviour)", () => {
  const args = parseArgs(["--model", "openai/gpt-4o-mini"]);
  const env = loadEnv({ ...BASE, OPENROUTER_API_KEY: "k" });
  assert.throws(() => assertPricingKnown(args, env), /Refusing to run: no pricing info for model\(s\) openai\/gpt-4o-mini/);
  // Explicit LLM_BASE_URL pointing at OpenRouter is the same host, same rule.
  const env2 = loadEnv({ ...BASE, LLM_BASE_URL: "https://openrouter.ai/api/v1", LLM_API_KEY: "k" });
  assert.throws(() => assertPricingKnown(args, env2), /Refusing to run/);
});

test("assertPricingKnown: unknown model on api.anthropic.com still refuses (unchanged behaviour)", () => {
  const args = parseArgs(["--model", "claude-future-model"]);
  const env = loadEnv({ ...BASE, ANTHROPIC_API_KEY: "k" });
  assert.throws(() => assertPricingKnown(args, env), /Refusing to run/);
});

test("assertPricingKnown: --no-cost-cap still acknowledges on a metered host", () => {
  const args = parseArgs(["--model", "claude-future-model", "--no-cost-cap"]);
  const env = loadEnv({ ...BASE, ANTHROPIC_API_KEY: "k" });
  const lines = captureConsole(() => assertPricingKnown(args, env));
  assert.equal(lines.warn.length, 1);
  assert.match(lines.warn[0], /--no-cost-cap acknowledged/);
});

test("assertPricingKnown: known default models are silent on every host", () => {
  const args = parseArgs([]);
  for (const env of [
    loadEnv({ ...BASE, OPENROUTER_API_KEY: "k" }),
    loadEnv({ ...BASE, ANTHROPIC_API_KEY: "k" }),
    loadEnv({ ...BASE, LLM_BASE_URL: "http://router.internal:4000/v1", LLM_API_KEY: "k" }),
  ]) {
    const lines = captureConsole(() => assertPricingKnown(args, env));
    assert.deepEqual(lines, { log: [], warn: [] });
  }
  assert.ok(worstCasePerPair(args) > 0, "default models are priced, so the clamp is active");
});

test("assertPricingKnown: without env behaves like before (refuses unless --no-cost-cap)", () => {
  assert.throws(() => assertPricingKnown(parseArgs(["--model", "mystery"])), /Refusing to run/);
  const lines = captureConsole(() => assertPricingKnown(parseArgs(["--model", "mystery", "--no-cost-cap"])));
  assert.equal(lines.warn.length, 1);
});
