/**
 * Outer loop: acceptance behaviors A1-A24 (specs/004-self-hosted-llm/tdd/test-list.md).
 * Every test drives the real entry point, createApp(deps).fetch(Request), with only the
 * model server (modelFetch) and the database (store) faked.
 */
import { assert, assertEquals, assertStringIncludes } from "jsr:@std/assert@^1";
import { createApp } from "../lib/app.ts";
import type { Deps, SetupReport } from "../lib/types.ts";
import { axisVector, chatReply, embeddingReply, FakeFetch, modelsReply } from "./helpers/fake_fetch.ts";
import type { RecordedRequest } from "./helpers/fake_fetch.ts";
import { FakeStore } from "./helpers/fake_store.ts";
import { FUNCTION_URL, mcpCall } from "./helpers/mcp.ts";
import { todo } from "./helpers/todo.ts";

const KEY = "test-key";
const BASE = "http://model.test/v1";
const EMB_MODEL = "embed-1536";
const CHAT_MODEL = "chat-small";
const GOOD_META = '{"type":"idea","topics":["testing"],"people":[],"action_items":[],"dates_mentioned":[]}';
const CONFIG_GATE_TAIL = " Set these as function secrets (see README → Configure).";

function baseEnv(extra: Record<string, string> = {}): Record<string, string> {
  return {
    MCP_ACCESS_KEY: KEY,
    EMBEDDING_API_BASE: BASE,
    EMBEDDING_MODEL: EMB_MODEL,
    CHAT_MODEL: CHAT_MODEL,
    ...extra,
  };
}

function makeDeps(env: Record<string, string>, fake: FakeFetch, store = new FakeStore()): Deps {
  return { getEnv: (n) => env[n], modelFetch: fake.fetch, store };
}

/** Routes a healthy model server at `base`: every text embeds on axis 0, chat returns good metadata. */
function healthy(fake = new FakeFetch(), base = BASE): FakeFetch {
  return fake
    .on("POST", `${base}/embeddings`, () => embeddingReply(axisVector(0)))
    .on("POST", `${base}/chat/completions`, chatReply(GOOD_META))
    .on("GET", `${base}/models`, modelsReply([EMB_MODEL, CHAT_MODEL]));
}

/** Embeds each distinct input on its own axis (same text, same vector). */
function perTextEmbeddings(): (req: RecordedRequest) => ReturnType<typeof embeddingReply> {
  const axes = new Map<string, number>();
  return (req) => {
    const input = String((req.body as { input: string }).input);
    if (!axes.has(input)) axes.set(input, axes.size);
    return embeddingReply(axisVector(axes.get(input)!));
  };
}

async function callTool(app: { fetch: (r: Request) => Response | Promise<Response> }, name: string, args: Record<string, unknown>) {
  const { message } = await mcpCall(app.fetch, "tools/call", { name, arguments: args }, { key: KEY });
  const result = (message as { result: { content: { text: string }[]; isError?: boolean } }).result;
  return { text: result.content[0].text, isError: result.isError === true };
}

async function setupCheck(app: { fetch: (r: Request) => Response | Promise<Response> }, key: string | null = KEY) {
  const headers: Record<string, string> = key === null ? {} : { "x-brain-key": key };
  const res = await app.fetch(new Request(FUNCTION_URL + "/setup-check", { headers }));
  return { status: res.status, res, body: await res.json() };
}

Deno.test("A1 capture_thought stores one row with a 1536-length embedding and extracted metadata", async () => {
  const fake = healthy();
  const store = new FakeStore();
  const app = createApp(makeDeps(baseEnv(), fake, store));
  const r = await callTool(app, "capture_thought", { content: "Ship the self-hosted build" });
  assertEquals(r.isError, false);
  assertStringIncludes(r.text, "Captured as idea");
  assertEquals(store.rows.length, 1);
  assertEquals(store.rows[0].embedding?.length, 1536);
  assertEquals(store.rows[0].metadata.type, "idea");
  assertEquals(store.rows[0].metadata.topics, ["testing"]);
  assertEquals(store.rows[0].metadata.source, "mcp");
});

Deno.test("A2 search_thoughts with the exact text returns that thought first", async () => {
  const fake = new FakeFetch()
    .on("POST", `${BASE}/embeddings`, perTextEmbeddings())
    .on("POST", `${BASE}/chat/completions`, chatReply(GOOD_META));
  const app = createApp(makeDeps(baseEnv(), fake));
  await callTool(app, "capture_thought", { content: "alpha thought about gardens" });
  await callTool(app, "capture_thought", { content: "beta thought about engines" });
  const r = await callTool(app, "search_thoughts", { query: "alpha thought about gardens" });
  assertEquals(r.isError, false);
  assertStringIncludes(r.text, "alpha thought about gardens");
  assert(!r.text.includes("beta thought about engines"));
  assertStringIncludes(r.text, "--- Result 1 ");
});

Deno.test("A3 search_thoughts with a paraphrase near the original returns that thought", async () => {
  const original = "The quarterly review moved to Thursday";
  const paraphrase = "When is the review meeting now";
  const mix = axisVector(0).map((v, i) => (i === 0 ? 0.8 : i === 1 ? 0.6 : v));
  const fake = new FakeFetch()
    .on("POST", `${BASE}/embeddings`, (req) => {
      const input = String((req.body as { input: string }).input);
      if (input === original) return embeddingReply(axisVector(0));
      if (input === paraphrase) return embeddingReply(mix);
      return embeddingReply(axisVector(5));
    })
    .on("POST", `${BASE}/chat/completions`, chatReply(GOOD_META));
  const app = createApp(makeDeps(baseEnv(), fake));
  await callTool(app, "capture_thought", { content: original });
  const r = await callTool(app, "search_thoughts", { query: paraphrase });
  assertEquals(r.isError, false);
  assertStringIncludes(r.text, original);
});

Deno.test("A4 list_thoughts and thought_stats return core's output text for the same rows", async () => {
  const store = new FakeStore();
  store.seed({ content: "first stored note", metadata: { type: "task", topics: ["ops"], people: ["Ana"] } });
  store.seed({ content: "second stored note", metadata: { type: "idea", topics: ["ops", "design"] } });
  const app = createApp(makeDeps(baseEnv(), healthy(), store));
  const list = await callTool(app, "list_thoughts", {});
  assertEquals(list.isError, false);
  assertStringIncludes(list.text, "2 recent thought(s):");
  assertStringIncludes(list.text, "first stored note");
  assertStringIncludes(list.text, "second stored note");
  assertStringIncludes(list.text, "(task - ops)");
  const stats = await callTool(app, "thought_stats", {});
  assertEquals(stats.isError, false);
  assertStringIncludes(stats.text, "Total thoughts: 2");
  assertStringIncludes(stats.text, "Types:");
  assertStringIncludes(stats.text, "  task: 1");
  assertStringIncludes(stats.text, "Top topics:");
  assertStringIncludes(stats.text, "  ops: 2");
  assertStringIncludes(stats.text, "People mentioned:");
  assertStringIncludes(stats.text, "  Ana: 1");
});

Deno.test("A5 capture, search, list and stats succeed with every model request on the configured base", async () => {
  const fake = healthy();
  const app = createApp(makeDeps(baseEnv(), fake));
  for (
    const [name, args] of [
      ["capture_thought", { content: "hosts check thought" }],
      ["search_thoughts", { query: "hosts check thought" }],
      ["list_thoughts", {}],
      ["thought_stats", {}],
    ] as const
  ) {
    const r = await callTool(app, name, args);
    assertEquals(r.isError, false, `${name} should succeed`);
  }
  assert(fake.requests.length > 0);
  for (const req of fake.requests) assert(req.url.startsWith(BASE), `unexpected host: ${req.url}`);
  assertEquals(fake.unmatched.length, 0);
});

Deno.test("A6 capture_thought with the embedding base unreachable names the base and stores nothing", async () => {
  const fake = new FakeFetch()
    .on("POST", `${BASE}/embeddings`, { networkError: "connection refused" })
    .on("POST", `${BASE}/chat/completions`, chatReply(GOOD_META));
  const store = new FakeStore();
  const app = createApp(makeDeps(baseEnv(), fake, store));
  const r = await callTool(app, "capture_thought", { content: "will not be stored" });
  assertEquals(r.isError, true);
  assertStringIncludes(r.text, BASE);
  assertStringIncludes(r.text, "could not be reached");
  assertEquals(store.rows.length, 0);
});

Deno.test("A7 capture_thought with an unknown embedding model names the model and stores nothing", async () => {
  const fake = new FakeFetch()
    .on("POST", `${BASE}/embeddings`, { status: 404, body: { error: { message: `model "${EMB_MODEL}" not found` } } })
    .on("POST", `${BASE}/chat/completions`, chatReply(GOOD_META));
  const store = new FakeStore();
  const app = createApp(makeDeps(baseEnv(), fake, store));
  const r = await callTool(app, "capture_thought", { content: "will not be stored" });
  assertEquals(r.isError, true);
  assertStringIncludes(r.text, EMB_MODEL);
  assertEquals(store.rows.length, 0);
});

Deno.test("A8 capture_thought with 768-dimension embeddings names 768 and 1536 and stores nothing", async () => {
  const fake = new FakeFetch()
    .on("POST", `${BASE}/embeddings`, embeddingReply(axisVector(0, 768)))
    .on("POST", `${BASE}/chat/completions`, chatReply(GOOD_META));
  const store = new FakeStore();
  const app = createApp(makeDeps(baseEnv(), fake, store));
  const r = await callTool(app, "capture_thought", { content: "will not be stored" });
  assertEquals(r.isError, true);
  assertStringIncludes(
    r.text,
    `Embedding model "${EMB_MODEL}" returned 768-dimension vectors; this brain stores 1536. Choose a model that can output 1536 dimensions (see README).`,
  );
  assertEquals(store.rows.length, 0);
});

Deno.test("A9 setup-check with 768-dimension embeddings answers 503 with embedding_dimension failed", async () => {
  const fake = new FakeFetch()
    .on("POST", `${BASE}/embeddings`, embeddingReply(axisVector(0, 768)))
    .on("POST", `${BASE}/chat/completions`, chatReply(GOOD_META))
    .on("GET", `${BASE}/models`, modelsReply([EMB_MODEL, CHAT_MODEL]));
  const app = createApp(makeDeps(baseEnv(), fake));
  const { status, body } = await setupCheck(app);
  assertEquals(status, 503);
  const report = body as SetupReport;
  assertEquals(report.ok, false);
  const check = report.checks.find((c) => c.id === "embedding_dimension");
  assertEquals(check?.ok, false);
  assertStringIncludes(check?.reason ?? "", "768");
  assertStringIncludes(check?.reason ?? "", "1536");
});

Deno.test("A10 unusable chat output saves the thought with default metadata and says extraction was skipped", async () => {
  const fake = new FakeFetch()
    .on("POST", `${BASE}/embeddings`, embeddingReply(axisVector(0)))
    .on("POST", `${BASE}/chat/completions`, chatReply("this is not json at all"));
  const store = new FakeStore();
  const app = createApp(makeDeps(baseEnv(), fake, store));
  const r = await callTool(app, "capture_thought", { content: "kept despite chat failure" });
  assertEquals(r.isError, false);
  assertStringIncludes(r.text, "Metadata extraction skipped: ");
  assertStringIncludes(r.text, ". Saved with default metadata.");
  assertEquals(store.rows.length, 1);
  assertEquals(store.rows[0].embedding?.length, 1536);
  assertEquals(store.rows[0].metadata.topics, ["uncategorized"]);
  assertEquals(store.rows[0].metadata.type, "observation");
});

Deno.test("A11 capture_thought with EMBEDDING_API_BASE unset names it and sends no request", async () => {
  const env = baseEnv();
  delete env.EMBEDDING_API_BASE;
  const fake = healthy();
  const store = new FakeStore();
  const app = createApp(makeDeps(env, fake, store));
  const r = await callTool(app, "capture_thought", { content: "nothing happens" });
  assertEquals(r.isError, true);
  assertEquals(r.text, "Model endpoint not configured: missing EMBEDDING_API_BASE." + CONFIG_GATE_TAIL);
  assertEquals(fake.requests.length, 0);
  assertEquals(store.rows.length, 0);
});

Deno.test("A12 setup-check on a correctly configured server answers 200 with every check passed", async () => {
  const app = createApp(makeDeps(baseEnv(), healthy()));
  const { status, res, body } = await setupCheck(app);
  assertEquals(status, 200);
  assertStringIncludes(res.headers.get("content-type") ?? "", "application/json");
  const report = body as SetupReport;
  assertEquals(report.ok, true);
  assertEquals(report.checks.map((c) => c.id), [
    "config",
    "embedding_reachable",
    "embedding_model",
    "embedding_dimension",
    "chat_reachable",
    "chat_model",
    "chat_metadata",
  ]);
  for (const c of report.checks) assertEquals(c.ok, true, `check ${c.id}`);
});

Deno.test("A13 setup-check without the key answers 401", async () => {
  const fake = healthy();
  const app = createApp(makeDeps(baseEnv(), fake));
  const { status, body } = await setupCheck(app, null);
  assertEquals(status, 401);
  assertEquals(body, { error: "Unauthorized: missing or invalid authentication." });
  assertEquals(fake.requests.length, 0);
});

Deno.test("A14 setup-check counts 3 thoughts without embedding_model and both captured rows name the model", async () => {
  const store = new FakeStore();
  for (const c of ["old one", "old two", "old three"]) store.seed({ content: c });
  const fake = new FakeFetch()
    .on("POST", `${BASE}/embeddings`, perTextEmbeddings())
    .on("POST", `${BASE}/chat/completions`, chatReply(GOOD_META))
    .on("GET", `${BASE}/models`, modelsReply([EMB_MODEL, CHAT_MODEL]));
  const app = createApp(makeDeps(baseEnv(), fake, store));
  assertEquals((await callTool(app, "capture_thought", { content: "new one" })).isError, false);
  assertEquals((await callTool(app, "capture_thought", { content: "new two" })).isError, false);
  const { body } = await setupCheck(app);
  assertEquals((body as SetupReport).thoughts.other_model, 3);
  const fresh = store.rows.filter((r) => r.content.startsWith("new "));
  assertEquals(fresh.length, 2);
  for (const r of fresh) assertEquals(r.metadata.embedding_model, EMB_MODEL);
});

Deno.test("A15 a model server that never answers fails capture with a timeout naming FETCH_TIMEOUT_MS", async () => {
  const fake = new FakeFetch()
    .on("POST", `${BASE}/embeddings`, { hang: true })
    .on("POST", `${BASE}/chat/completions`, chatReply(GOOD_META));
  const store = new FakeStore();
  const app = createApp(makeDeps(baseEnv({ FETCH_TIMEOUT_MS: "20" }), fake, store));
  const r = await callTool(app, "capture_thought", { content: "timed out" });
  assertEquals(r.isError, true);
  assertStringIncludes(r.text, "FETCH_TIMEOUT_MS");
  assertEquals(store.rows.length, 0);
});

Deno.test("A16 a FETCH_TIMEOUT_MS larger than the server delay lets the capture succeed", async () => {
  const slow = async () => {
    await new Promise((r) => setTimeout(r, 30));
    return embeddingReply(axisVector(0));
  };
  const fake = new FakeFetch()
    .on("POST", `${BASE}/embeddings`, slow)
    .on("POST", `${BASE}/chat/completions`, chatReply(GOOD_META));
  const store = new FakeStore();
  const app = createApp(makeDeps(baseEnv({ FETCH_TIMEOUT_MS: "500" }), fake, store));
  const r = await callTool(app, "capture_thought", { content: "slow but fine" });
  assertEquals(r.isError, false);
  assertEquals(store.rows.length, 1);
});

Deno.test("A17 with no chat settings besides CHAT_MODEL the chat request goes to the embedding base", async () => {
  const fake = healthy();
  const app = createApp(makeDeps(baseEnv(), fake));
  const r = await callTool(app, "capture_thought", { content: "inherit the base" });
  assertEquals(r.isError, false);
  const chat = fake.requests.filter((q) => q.url.endsWith("/chat/completions"));
  assertEquals(chat.length, 1);
  assertEquals(chat[0].url, `${BASE}/chat/completions`);
});

Deno.test("A18 with CHAT_MODEL unset all six tools fail naming CHAT_MODEL and send no request", async () => {
  const env = baseEnv();
  delete env.CHAT_MODEL;
  const fake = healthy();
  const store = new FakeStore();
  const app = createApp(makeDeps(env, fake, store));
  const calls: [string, Record<string, unknown>][] = [
    ["search", { query: "x" }],
    ["fetch", { id: "1" }],
    ["search_thoughts", { query: "x" }],
    ["list_thoughts", {}],
    ["thought_stats", {}],
    ["capture_thought", { content: "x" }],
  ];
  for (const [name, args] of calls) {
    const r = await callTool(app, name, args);
    assertEquals(r.isError, true, name);
    assertEquals(r.text, "Model endpoint not configured: missing CHAT_MODEL." + CONFIG_GATE_TAIL, name);
  }
  assertEquals(fake.requests.length, 0);
  assertEquals(store.calls.length, 0);
});

Deno.test("A19 an unkeyed http base passes the setup check with no warning", async () => {
  const base = "http://ollama:11434/v1";
  const app = createApp(makeDeps(baseEnv({ EMBEDDING_API_BASE: base }), healthy(new FakeFetch(), base)));
  const { status, body } = await setupCheck(app);
  assertEquals(status, 200);
  assertEquals((body as SetupReport).ok, true);
  assertEquals((body as SetupReport).warnings, []);
});

Deno.test("A20 an http base with EMBEDDING_API_KEY passes with a key_over_http warning for the embedding role", async () => {
  const base = "http://ollama:11434/v1";
  const env = baseEnv({ EMBEDDING_API_BASE: base, EMBEDDING_API_KEY: "secret-embed-key" });
  const app = createApp(makeDeps(env, healthy(new FakeFetch(), base)));
  const { status, res, body } = await setupCheck(app);
  assertEquals(status, 200);
  const report = body as SetupReport;
  assertEquals(report.ok, true);
  const w = report.warnings.find((x) => x.id === "key_over_http" && x.role === "embedding");
  assert(w, "expected a key_over_http warning for the embedding role");
  assert(!JSON.stringify(report).includes("secret-embed-key"));
  assert(res.status === 200);
});

Deno.test("A21 an MCP client using only ?key= lists exactly the six tools", async () => {
  const app = createApp(makeDeps(baseEnv(), healthy()));
  const { status, message } = await mcpCall(app.fetch, "tools/list", {}, { key: KEY, via: "query" });
  assertEquals(status, 200);
  const tools = (message as { result: { tools: { name: string }[] } }).result.tools.map((t) => t.name).sort();
  assertEquals(tools, ["capture_thought", "fetch", "list_thoughts", "search", "search_thoughts", "thought_stats"]);
});

Deno.test("A22 an MCP request with a wrong key gets the JSON-RPC unauthorized error", async () => {
  const app = createApp(makeDeps(baseEnv(), healthy()));
  const { status, message } = await mcpCall(app.fetch, "tools/list", {}, { key: "wrong-key", id: 7 });
  assertEquals(status, 200);
  assertEquals(message?.id, 7);
  assertEquals(message?.error, { code: -32001, message: "Unauthorized: missing or invalid authentication." });
});

Deno.test("A23 with both roles on a cloud-style https base capture and search succeed on that base only", async () => {
  const cloud = "https://api.cloud.test/v1";
  const fake = new FakeFetch()
    .on("POST", `${cloud}/embeddings`, perTextEmbeddings())
    .on("POST", `${cloud}/chat/completions`, chatReply(GOOD_META));
  const env = baseEnv({
    EMBEDDING_API_BASE: cloud,
    EMBEDDING_API_KEY: "cloud-key",
    CHAT_API_BASE: cloud,
    CHAT_API_KEY: "cloud-key",
  });
  const app = createApp(makeDeps(env, fake));
  assertEquals((await callTool(app, "capture_thought", { content: "cloud thought" })).isError, false);
  const s = await callTool(app, "search_thoughts", { query: "cloud thought" });
  assertEquals(s.isError, false);
  assertStringIncludes(s.text, "cloud thought");
  assert(fake.requests.length > 0);
  for (const req of fake.requests) assert(req.url.startsWith(cloud), `unexpected host: ${req.url}`);
  assertEquals(fake.unmatched.length, 0);
});

Deno.test("A24 enrichment_status goes complete, fallback, then complete again on the same row", async () => {
  let chatWorks = true;
  const fake = new FakeFetch()
    .on("POST", `${BASE}/embeddings`, perTextEmbeddings())
    .on("POST", `${BASE}/chat/completions`, () => chatWorks ? chatReply(GOOD_META) : { status: 500, body: "boom" });
  const store = new FakeStore();
  const app = createApp(makeDeps(baseEnv(), fake, store));

  assertEquals((await callTool(app, "capture_thought", { content: "text X" })).isError, false);
  assertEquals(store.rows.find((r) => r.content === "text X")?.metadata.enrichment_status, "complete");

  chatWorks = false;
  assertEquals((await callTool(app, "capture_thought", { content: "text Y" })).isError, false);
  const y = store.rows.find((r) => r.content === "text Y");
  assertEquals(y?.metadata.enrichment_status, "fallback");

  chatWorks = true;
  assertEquals((await callTool(app, "capture_thought", { content: "text Y" })).isError, false);
  const ys = store.rows.filter((r) => r.content === "text Y");
  assertEquals(ys.length, 1);
  assertEquals(ys[0].id, y?.id);
  assertEquals(ys[0].metadata.enrichment_status, "complete");
});
