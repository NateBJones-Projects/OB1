import { assert, assertEquals, assertStringIncludes } from "jsr:@std/assert@^1";
import { runSetupCheck } from "../lib/setup_check.ts";
import type { CheckResult, Deps } from "../lib/types.ts";
import { axisVector, chatReply, embeddingReply, FakeFetch, modelsReply } from "./helpers/fake_fetch.ts";
import { FakeStore } from "./helpers/fake_store.ts";

const BASE = "http://model.test/v1";
const BASE_ENV: Record<string, string> = {
  EMBEDDING_API_BASE: BASE,
  EMBEDDING_MODEL: "emb-m",
  CHAT_MODEL: "chat-m",
};

/** A fake model server answering every route healthily, unless a route is registered first. */
function healthyFake(base = BASE): FakeFetch {
  return new FakeFetch()
    .on("GET", `${base}/models`, modelsReply(["emb-m", "chat-m"]))
    .on("POST", `${base}/embeddings`, embeddingReply(axisVector(0)))
    .on("POST", `${base}/chat/completions`, chatReply('{"type":"idea"}'));
}

function setup(env: Record<string, string> = BASE_ENV, fake: FakeFetch = healthyFake(), store = new FakeStore()) {
  const deps: Deps = { getEnv: (n) => env[n], modelFetch: fake.fetch, store };
  return { deps, fake, store };
}

function check(checks: CheckResult[], id: string): CheckResult {
  const c = checks.find((x) => x.id === id);
  assert(c, `check ${id} missing`);
  return c;
}

Deno.test("U146 a healthy configuration and server give ok true", async () => {
  const { deps } = setup();
  const report = await runSetupCheck(deps);
  assertEquals(report.ok, true);
});

Deno.test("U147 the report lists the seven checks in the contract's order, role checks carrying role", async () => {
  const { deps } = setup();
  const { checks } = await runSetupCheck(deps);
  assertEquals(checks.map((c) => [c.id, c.role]), [
    ["config", undefined],
    ["embedding_reachable", "embedding"],
    ["embedding_model", "embedding"],
    ["embedding_dimension", "embedding"],
    ["chat_reachable", "chat"],
    ["chat_model", "chat"],
    ["chat_metadata", "chat"],
  ]);
});

Deno.test("U148 config shows each role's base, model and key_set, chat inherits, and timeout_ms", async () => {
  const { deps } = setup({ ...BASE_ENV, EMBEDDING_API_KEY: "sk-secret", FETCH_TIMEOUT_MS: "5000" });
  const { config } = await runSetupCheck(deps);
  assertEquals(config, {
    embedding: { base: BASE, model: "emb-m", key_set: true },
    chat: { base: BASE, model: "chat-m", key_set: true, inherits: ["base", "key"] },
    timeout_ms: 5000,
  });
});

Deno.test("U149 no key value appears anywhere in the report", async () => {
  const env = {
    ...BASE_ENV,
    EMBEDDING_API_KEY: "sk-emb-SECRET",
    CHAT_API_BASE: "http://chat.test/v1",
    CHAT_API_KEY: "sk-chat-SECRET",
  };
  const fake = new FakeFetch()
    .on("GET", `${BASE}/models`, { status: 500, body: "boom sk-emb-SECRET" })
    .on("POST", `${BASE}/embeddings`, { status: 500, body: "bad key sk-emb-SECRET and sk-chat-SECRET" })
    .on("GET", "http://chat.test/v1/models", modelsReply(["chat-m"]))
    .on("POST", "http://chat.test/v1/chat/completions", { status: 500, body: "bad key sk-chat-SECRET" });
  const text = JSON.stringify(await runSetupCheck(setup(env, fake).deps));
  assert(!text.includes("SECRET"), text);
});

Deno.test("U150 a missing setting fails config with a reason naming each missing setting", async () => {
  const { deps } = setup({});
  const report = await runSetupCheck(deps);
  const c = check(report.checks, "config");
  assertEquals(c.ok, false);
  for (const name of ["EMBEDDING_API_BASE", "EMBEDDING_MODEL", "CHAT_MODEL"]) assertStringIncludes(c.reason ?? "", name);
});

Deno.test("U151 an invalid setting fails config naming it with its reason", async () => {
  const { deps } = setup({ ...BASE_ENV, EMBEDDING_API_BASE: "ollama:11434/v1", FETCH_TIMEOUT_MS: "60s" });
  const c = check((await runSetupCheck(deps)).checks, "config");
  assertEquals(c.ok, false);
  assertStringIncludes(c.reason ?? "", "EMBEDDING_API_BASE");
  assertStringIncludes(c.reason ?? "", "must start with http:// or https://");
  assertStringIncludes(c.reason ?? "", "FETCH_TIMEOUT_MS");
  assertStringIncludes(c.reason ?? "", "positive whole number");
});

Deno.test("U152 with config failed, every other check reads skipped: configuration incomplete", async () => {
  const { deps } = setup({});
  const { checks } = await runSetupCheck(deps);
  assertEquals(checks.map((c) => c.id), [
    "config",
    "embedding_reachable",
    "embedding_model",
    "embedding_dimension",
    "chat_reachable",
    "chat_model",
    "chat_metadata",
  ]);
  for (const c of checks.slice(1)) {
    assertEquals(c.ok, false);
    assertEquals(c.reason, "skipped: configuration incomplete");
  }
});

Deno.test("U153 with config failed, no model request is sent", async () => {
  const { deps, fake } = setup({ CHAT_MODEL: "chat-m" });
  await runSetupCheck(deps);
  assertEquals(fake.requests.length, 0);
  assertEquals(fake.unmatched.length, 0);
});

Deno.test("U154 with config failed, ok is false and other_model is null with no store call", async () => {
  const { deps, store } = setup({});
  const report = await runSetupCheck(deps);
  assertEquals(report.ok, false);
  assertEquals(report.thoughts, { other_model: null });
  assertEquals(report.config, null);
  assertEquals(store.calls.length, 0);
});

Deno.test("U155 any single failed check makes ok false", async () => {
  const badEmbedding = new FakeFetch()
    .on("GET", `${BASE}/models`, modelsReply(["emb-m", "chat-m"]))
    .on("POST", `${BASE}/embeddings`, embeddingReply(axisVector(0, 768)))
    .on("POST", `${BASE}/chat/completions`, chatReply("{}"));
  const r1 = await runSetupCheck(setup(BASE_ENV, badEmbedding).deps);
  assertEquals(r1.checks.filter((c) => !c.ok).map((c) => c.id), ["embedding_dimension"]);
  assertEquals(r1.ok, false);

  const badChat = new FakeFetch()
    .on("GET", `${BASE}/models`, modelsReply(["emb-m", "chat-m"]))
    .on("POST", `${BASE}/embeddings`, embeddingReply(axisVector(0)))
    .on("POST", `${BASE}/chat/completions`, chatReply("not json at all"));
  const r2 = await runSetupCheck(setup(BASE_ENV, badChat).deps);
  assertEquals(r2.checks.filter((c) => !c.ok).map((c) => c.id), ["chat_metadata"]);
  assertEquals(r2.ok, false);
});

Deno.test("U156 role reachable passes on a 200 and on a 404 from /models", async () => {
  for (const status of [200, 404]) {
    const fake = new FakeFetch()
      .on("GET", `${BASE}/models`, status === 200 ? modelsReply(["emb-m", "chat-m"]) : { status: 404, body: "nope" })
      .on("POST", `${BASE}/embeddings`, embeddingReply(axisVector(0)))
      .on("POST", `${BASE}/chat/completions`, chatReply("{}"));
    const { checks } = await runSetupCheck(setup(BASE_ENV, fake).deps);
    assertEquals(check(checks, "embedding_reachable").ok, true, `status ${status}`);
    assertEquals(check(checks, "chat_reachable").ok, true, `status ${status}`);
  }
});
