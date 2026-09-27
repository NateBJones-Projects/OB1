// Tests for model selection from the environment in classify-edges.mjs:
// LLM_MODEL / LLM_FILTER_MODEL / LLM_CLASSIFY_MODEL as defaults for
// --model / --filter-model / --classify-model, the precedence between them,
// and that a model chosen from the environment reaches the pricing guard
// and the wire exactly like one passed as a flag. No Supabase, no network.
//
// Run:  node --test recipes/typed-edge-classifier/test/*.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

import {
  DEFAULT_CLASSIFY_MODEL,
  DEFAULT_FILTER_MODEL,
  assertPricingKnown,
  callAnthropicOnce,
  loadEnv,
  modelSelectionSummary,
  parseArgs,
  resolveModelSelection,
  worstCasePerPair,
} from "../classify-edges.mjs";

const SCRIPT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "classify-edges.mjs");

const BASE = {
  OPEN_BRAIN_URL: "https://example.supabase.co",
  OPEN_BRAIN_SERVICE_KEY: "service-role-placeholder",
};

/** The four model fields of a parsed args object, for compact assertions. */
function models(args) {
  return {
    filterModel: args.filterModel,
    classifyModel: args.classifyModel,
    singleModel: args.singleModel,
    hybrid: args.hybrid,
  };
}

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

// ── defaults: nothing set means the historical behaviour ──────────────────

test("defaults: no flags and no variables keep the Haiku -> Opus hybrid", () => {
  assert.deepEqual(models(parseArgs([], {})), {
    filterModel: DEFAULT_FILTER_MODEL,
    classifyModel: DEFAULT_CLASSIFY_MODEL,
    singleModel: null,
    hybrid: true,
  });
  assert.equal(DEFAULT_FILTER_MODEL, "claude-haiku-4-5-20251001");
  assert.equal(DEFAULT_CLASSIFY_MODEL, "claude-opus-4-7");
});

test("defaults: parseArgs reads process.env when no source is given", () => {
  const saved = { ...process.env };
  try {
    delete process.env.LLM_MODEL;
    delete process.env.LLM_FILTER_MODEL;
    process.env.LLM_CLASSIFY_MODEL = "from-process-env";
    assert.equal(parseArgs([]).classifyModel, "from-process-env");
    assert.equal(parseArgs([]).hybrid, true);
  } finally {
    for (const k of ["LLM_MODEL", "LLM_FILTER_MODEL", "LLM_CLASSIFY_MODEL"]) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  }
});

test("defaults: blank or whitespace-only variables count as unset", () => {
  const env = { LLM_MODEL: "", LLM_FILTER_MODEL: "   ", LLM_CLASSIFY_MODEL: "\t" };
  assert.deepEqual(models(parseArgs([], env)), models(parseArgs([], {})));
  assert.deepEqual(parseArgs([], env).modelSources, { filter: "default", classify: "default", single: null });
});

test("defaults: variable values are trimmed", () => {
  const args = parseArgs([], { LLM_FILTER_MODEL: "  fast  ", LLM_CLASSIFY_MODEL: " strong\n" });
  assert.equal(args.filterModel, "fast");
  assert.equal(args.classifyModel, "strong");
});

// ── stage variables ───────────────────────────────────────────────────────

test("LLM_FILTER_MODEL and LLM_CLASSIFY_MODEL set the two hybrid legs", () => {
  const args = parseArgs([], { LLM_FILTER_MODEL: "local-fast", LLM_CLASSIFY_MODEL: "local-strong" });
  assert.deepEqual(models(args), {
    filterModel: "local-fast",
    classifyModel: "local-strong",
    singleModel: null,
    hybrid: true,
  });
  assert.deepEqual(args.modelSources, { filter: "LLM_FILTER_MODEL", classify: "LLM_CLASSIFY_MODEL", single: null });
});

test("a single stage variable leaves the other leg on its default", () => {
  const filterOnly = parseArgs([], { LLM_FILTER_MODEL: "local-fast" });
  assert.deepEqual(models(filterOnly), {
    filterModel: "local-fast",
    classifyModel: DEFAULT_CLASSIFY_MODEL,
    singleModel: null,
    hybrid: true,
  });
  const classifyOnly = parseArgs([], { LLM_CLASSIFY_MODEL: "local-strong" });
  assert.deepEqual(models(classifyOnly), {
    filterModel: DEFAULT_FILTER_MODEL,
    classifyModel: "local-strong",
    singleModel: null,
    hybrid: true,
  });
});

// ── LLM_MODEL ─────────────────────────────────────────────────────────────

test("LLM_MODEL alone runs that model end-to-end with the hybrid off (like --model)", () => {
  const fromEnv = parseArgs([], { LLM_MODEL: "local" });
  const fromFlag = parseArgs(["--model", "local"], {});
  assert.deepEqual(models(fromEnv), {
    filterModel: "local",
    classifyModel: "local",
    singleModel: "local",
    hybrid: false,
  });
  // What runs is identical to --model; only the unused stage legs differ
  // (LLM_MODEL fills them, a flag leaves them on their defaults).
  assert.equal(fromFlag.singleModel, fromEnv.singleModel);
  assert.equal(fromFlag.hybrid, fromEnv.hybrid);
  assert.equal(fromEnv.singleModel || fromEnv.classifyModel, fromFlag.singleModel || fromFlag.classifyModel);
  assert.deepEqual(fromEnv.modelSources, { filter: "LLM_MODEL", classify: "LLM_MODEL", single: "LLM_MODEL" });
  assert.deepEqual(fromFlag.modelSources, { filter: "default", classify: "default", single: "--model" });
});

test("LLM_MODEL fills the leg a stage variable leaves unnamed and keeps the hybrid on", () => {
  assert.deepEqual(models(parseArgs([], { LLM_MODEL: "haiku-alias", LLM_CLASSIFY_MODEL: "opus-alias" })), {
    filterModel: "haiku-alias",
    classifyModel: "opus-alias",
    singleModel: null,
    hybrid: true,
  });
  assert.deepEqual(models(parseArgs([], { LLM_MODEL: "strong", LLM_FILTER_MODEL: "fast" })), {
    filterModel: "fast",
    classifyModel: "strong",
    singleModel: null,
    hybrid: true,
  });
});

test("LLM_MODEL fills the leg a stage flag leaves unnamed and keeps the hybrid on", () => {
  const args = parseArgs(["--filter-model", "flag-fast"], { LLM_MODEL: "env-model" });
  assert.deepEqual(models(args), {
    filterModel: "flag-fast",
    classifyModel: "env-model",
    singleModel: null,
    hybrid: true,
  });
  assert.deepEqual(args.modelSources, { filter: "--filter-model", classify: "LLM_MODEL", single: null });
});

test("LLM_MODEL is ignored for a leg both stage variables already name", () => {
  const args = parseArgs([], { LLM_MODEL: "ignored", LLM_FILTER_MODEL: "fast", LLM_CLASSIFY_MODEL: "strong" });
  assert.deepEqual(models(args), {
    filterModel: "fast",
    classifyModel: "strong",
    singleModel: null,
    hybrid: true,
  });
});

// ── flags beat variables ──────────────────────────────────────────────────

test("flags beat their variables on every leg", () => {
  const env = { LLM_MODEL: "env-single", LLM_FILTER_MODEL: "env-fast", LLM_CLASSIFY_MODEL: "env-strong" };
  const args = parseArgs(["--filter-model", "flag-fast", "--classify-model", "flag-strong"], env);
  assert.deepEqual(models(args), {
    filterModel: "flag-fast",
    classifyModel: "flag-strong",
    singleModel: null,
    hybrid: true,
  });
  assert.deepEqual(args.modelSources, { filter: "--filter-model", classify: "--classify-model", single: null });
});

test("--model beats LLM_MODEL and the stage variables, and turns the hybrid off", () => {
  const env = { LLM_MODEL: "env-single", LLM_FILTER_MODEL: "env-fast", LLM_CLASSIFY_MODEL: "env-strong" };
  const args = parseArgs(["--model", "flag-single"], env);
  assert.equal(args.singleModel, "flag-single");
  assert.equal(args.hybrid, false);
  assert.equal(args.modelSources.single, "--model");
  // The stage legs are still resolved (unused in single mode), stage variables first.
  assert.equal(args.filterModel, "env-fast");
  assert.equal(args.classifyModel, "env-strong");
});

test("--model wins regardless of its position relative to the stage flags", () => {
  const a = parseArgs(["--model", "one", "--filter-model", "two"], {});
  const b = parseArgs(["--filter-model", "two", "--model", "one"], {});
  assert.deepEqual(models(a), models(b));
  assert.equal(a.singleModel, "one");
  assert.equal(a.hybrid, false);
});

test("a flag present without a value still wins over its variable (unchanged error path)", () => {
  // Before the variables existed a trailing --filter-model left the model
  // undefined and the pricing guard refused. That must not silently turn
  // into "use the variable" now.
  const args = parseArgs(["--filter-model"], { LLM_FILTER_MODEL: "env-fast" });
  assert.equal(args.filterModel, undefined);
  assert.equal(args.modelSources.filter, "--filter-model");
  assert.throws(() => assertPricingKnown(args, loadEnv({ ...BASE, OPENROUTER_API_KEY: "k" })), /Refusing to run/);
});

// ── --no-hybrid ───────────────────────────────────────────────────────────

test("--no-hybrid with LLM_MODEL runs that model on every pair", () => {
  const args = parseArgs(["--no-hybrid"], { LLM_MODEL: "local" });
  assert.equal(args.hybrid, false);
  assert.equal(args.singleModel, "local");
});

test("--no-hybrid with LLM_CLASSIFY_MODEL runs that model on every pair", () => {
  const args = parseArgs(["--no-hybrid"], { LLM_CLASSIFY_MODEL: "local-strong" });
  assert.equal(args.hybrid, false);
  assert.equal(args.singleModel, null);
  assert.equal(args.classifyModel, "local-strong");
  assert.equal(args.singleModel || args.classifyModel, "local-strong", "what processPair will call");
});

// ── resolveModelSelection directly ────────────────────────────────────────

test("resolveModelSelection: a null source and empty flags give the defaults", () => {
  // (An undefined source means process.env, by default-parameter rules,
  // which the parseArgs test above covers.)
  assert.deepEqual(resolveModelSelection({}, null), {
    filterModel: DEFAULT_FILTER_MODEL,
    classifyModel: DEFAULT_CLASSIFY_MODEL,
    singleModel: null,
    hybrid: true,
    modelSources: { filter: "default", classify: "default", single: null },
  });
  assert.equal(resolveModelSelection(undefined, null).hybrid, true, "missing flags object");
  assert.equal(resolveModelSelection({}, null, false).hybrid, false, "--no-hybrid is honoured");
});

test("resolveModelSelection: does not read inherited properties as flags", () => {
  const flags = Object.create({ model: "from-prototype" });
  assert.equal(resolveModelSelection(flags, {}).singleModel, null);
});

// ── the startup summary line ──────────────────────────────────────────────

test("modelSelectionSummary names each model and where it came from", () => {
  assert.equal(
    modelSelectionSummary(parseArgs([], {})),
    `filter=${DEFAULT_FILTER_MODEL} (default) classify=${DEFAULT_CLASSIFY_MODEL} (default)`,
  );
  assert.equal(
    modelSelectionSummary(parseArgs([], { LLM_FILTER_MODEL: "fast", LLM_MODEL: "strong" })),
    "filter=fast (LLM_FILTER_MODEL) classify=strong (LLM_MODEL)",
  );
  assert.equal(modelSelectionSummary(parseArgs([], { LLM_MODEL: "local" })), "model=local (LLM_MODEL) for every pair");
  assert.equal(modelSelectionSummary(parseArgs(["--model", "x"], {})), "model=x (--model) for every pair");
  assert.equal(
    modelSelectionSummary(parseArgs(["--no-hybrid"], { LLM_CLASSIFY_MODEL: "y" })),
    "model=y (LLM_CLASSIFY_MODEL) for every pair",
  );
  assert.equal(
    modelSelectionSummary(parseArgs(["--no-hybrid"], {})),
    `model=${DEFAULT_CLASSIFY_MODEL} (default) for every pair`,
  );
});

test("modelSelectionSummary copes with args that carry no modelSources", () => {
  assert.equal(
    modelSelectionSummary({ hybrid: true, filterModel: "a", classifyModel: "b" }),
    "filter=a classify=b",
  );
  assert.equal(modelSelectionSummary({ hybrid: false, singleModel: "c" }), "model=c for every pair");
});

// ── env-selected models meet the pricing guard like flag-selected ones ────

test("pricing guard: router aliases from the variables are a single notice on a self-hosted host", () => {
  const args = parseArgs([], { LLM_FILTER_MODEL: "router-haiku", LLM_CLASSIFY_MODEL: "router-opus" });
  const env = loadEnv({ ...BASE, LLM_BASE_URL: "http://router.internal:4000/v1", LLM_API_KEY: "k" });
  const lines = captureConsole(() => assertPricingKnown(args, env));
  assert.equal(lines.log.length, 1);
  assert.equal(lines.warn.length, 0);
  assert.match(lines.log[0], /no pricing entry for model\(s\) router-haiku, router-opus/);
  assert.equal(worstCasePerPair(args), 0, "clamp is off for unpriced models, as with flags");
});

test("pricing guard: LLM_MODEL alone lists only the one model that will run", () => {
  const args = parseArgs([], { LLM_MODEL: "router-only" });
  const env = loadEnv({ ...BASE, LLM_BASE_URL: "http://router.internal:4000/v1", LLM_API_KEY: "k" });
  const lines = captureConsole(() => assertPricingKnown(args, env));
  assert.equal(lines.log.length, 1);
  assert.match(lines.log[0], /model\(s\) router-only;/);
});

test("pricing guard: an unpriced model from a variable still refuses on OpenRouter", () => {
  const args = parseArgs([], { LLM_MODEL: "openai/gpt-4o-mini" });
  const env = loadEnv({ ...BASE, OPENROUTER_API_KEY: "k" });
  assert.throws(() => assertPricingKnown(args, env), /Refusing to run: no pricing info for model\(s\) openai\/gpt-4o-mini/);
  const acknowledged = parseArgs(["--no-cost-cap"], { LLM_MODEL: "openai/gpt-4o-mini" });
  const lines = captureConsole(() => assertPricingKnown(acknowledged, env));
  assert.equal(lines.warn.length, 1);
});

test("pricing guard: priced names from the variables are silent, prefixed or bare", () => {
  const env = loadEnv({ ...BASE, OPENROUTER_API_KEY: "k" });
  for (const vars of [
    { LLM_FILTER_MODEL: "anthropic/claude-haiku-4-5", LLM_CLASSIFY_MODEL: "anthropic/claude-opus-4-7" },
    { LLM_MODEL: "claude-haiku-4-5-20251001" },
    { LLM_CLASSIFY_MODEL: "claude-opus-4-6" },
  ]) {
    const args = parseArgs([], vars);
    const lines = captureConsole(() => assertPricingKnown(args, env));
    assert.deepEqual(lines, { log: [], warn: [] }, JSON.stringify(vars));
    assert.ok(worstCasePerPair(args) > 0, "priced models keep the parallelism clamp");
  }
});

// ── the env-selected model is what reaches the wire ───────────────────────

async function withStubbedFetch(fn) {
  const calls = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), body: JSON.parse(init.body) });
    const isMessages = String(url).endsWith("/v1/messages");
    return new Response(
      JSON.stringify(
        isMessages
          ? { content: [{ type: "text", text: "{}" }], usage: { input_tokens: 1, output_tokens: 1 } }
          : { choices: [{ message: { content: "{}" } }], usage: { prompt_tokens: 1, completion_tokens: 1 } },
      ),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  };
  try {
    await fn();
  } finally {
    globalThis.fetch = realFetch;
  }
  return calls;
}

test("wire: a router alias from LLM_MODEL is sent untouched to a self-hosted LLM_BASE_URL", async () => {
  const source = { ...BASE, LLM_BASE_URL: "http://router.internal:4000/v1", LLM_API_KEY: "k", LLM_MODEL: "local" };
  const env = loadEnv(source);
  const args = parseArgs([], source);
  const calls = await withStubbedFetch(() => callAnthropicOnce(env, args.singleModel, "s", "u", 64));
  assert.deepEqual(
    calls.map((c) => [c.url, c.body.model]),
    [["http://router.internal:4000/v1/chat/completions", "local"]],
  );
});

test("wire: bare Anthropic names from the stage variables are prefixed on OpenRouter, like the flags", async () => {
  const source = { ...BASE, OPENROUTER_API_KEY: "k", LLM_FILTER_MODEL: "claude-haiku-4-5", LLM_CLASSIFY_MODEL: "claude-opus-4-7" };
  const env = loadEnv(source);
  const args = parseArgs([], source);
  const calls = await withStubbedFetch(async () => {
    await callAnthropicOnce(env, args.filterModel, "s", "u", 64);
    await callAnthropicOnce(env, args.classifyModel, "s", "u", 64);
  });
  assert.deepEqual(
    calls.map((c) => c.body.model),
    ["anthropic/claude-haiku-4-5", "anthropic/claude-opus-4-7"],
  );
  for (const c of calls) assert.equal(c.url, "https://openrouter.ai/api/v1/chat/completions");
});

test("wire: the direct Anthropic path sends the variable's name as-is", async () => {
  const source = { ...BASE, ANTHROPIC_API_KEY: "k", LLM_CLASSIFY_MODEL: "claude-opus-4-7" };
  const env = loadEnv(source);
  const args = parseArgs([], source);
  const calls = await withStubbedFetch(() => callAnthropicOnce(env, args.classifyModel, "s", "u", 64));
  assert.deepEqual(
    calls.map((c) => [c.url, c.body.model]),
    [["https://api.anthropic.com/v1/messages", "claude-opus-4-7"]],
  );
});

// ── --help documents the variables and still exits 0 ──────────────────────

test("--help lists the three variables and keeps the flag lines", () => {
  const env = { ...process.env };
  for (const k of ["LLM_MODEL", "LLM_FILTER_MODEL", "LLM_CLASSIFY_MODEL"]) delete env[k];
  const run = spawnSync(process.execPath, [SCRIPT, "--help"], { encoding: "utf8", env });
  assert.equal(run.status, 0, run.stderr);
  for (const needle of [
    "LLM_MODEL",
    "LLM_FILTER_MODEL",
    "LLM_CLASSIFY_MODEL",
    `--filter-model MODEL     Haiku model for candidate filter (default ${DEFAULT_FILTER_MODEL})`,
    `--classify-model MODEL   Opus model for final classification (default ${DEFAULT_CLASSIFY_MODEL})`,
    "Flags always win",
  ]) {
    assert.ok(run.stdout.includes(needle), `--help should mention: ${needle}`);
  }
});
