import { assert, assertEquals, assertStringIncludes } from "jsr:@std/assert@^1";
import { buildServer } from "../lib/tools.ts";
import { axisVector, chatReply, embeddingReply, FakeFetch, type Handler } from "./helpers/fake_fetch.ts";
import { FakeStore } from "./helpers/fake_store.ts";
import { inMemoryClient } from "./helpers/mcp.ts";

const BASE = "http://model.test/v1";
const GOOD_ENV: Record<string, string> = {
  EMBEDDING_API_BASE: BASE,
  EMBEDDING_MODEL: "embed-1",
  CHAT_MODEL: "chat-1",
};

interface Rig {
  env: Record<string, string | undefined>;
  fake: FakeFetch;
  store: FakeStore;
  // deno-lint-ignore no-explicit-any
  client: any;
}

/** A server over the real config, client and metadata modules; only the model server and database are fake. */
async function rig(
  env: Record<string, string | undefined> = GOOD_ENV,
  opts: { embedding?: Handler; chat?: Handler | Handler[] } = {},
): Promise<Rig> {
  const e = { ...env };
  const fake = new FakeFetch();
  fake.on("POST", `${BASE}/embeddings`, opts.embedding ?? embeddingReply(axisVector(0)));
  const chat = opts.chat ?? chatReply('{"topics":["alpha"],"type":"idea"}');
  fake.on("POST", `${BASE}/chat/completions`, ...(Array.isArray(chat) ? chat : [chat]));
  const store = new FakeStore();
  const client = await inMemoryClient(buildServer({ getEnv: (n) => e[n], modelFetch: fake.fetch, store }));
  return { env: e, fake, store, client };
}

// deno-lint-ignore no-explicit-any
function textOf(result: any): string {
  return result.content.map((c: { text: string }) => c.text).join("\n");
}

Deno.test("U100 tools/list returns exactly the six tools named as core", async () => {
  const { client } = await rig();
  const { tools } = await client.listTools();
  assertEquals(
    tools.map((t: { name: string }) => t.name).sort(),
    ["capture_thought", "fetch", "list_thoughts", "search", "search_thoughts", "thought_stats"],
  );
});

const CORE_TOOLS: Record<string, { title: string; description: string; annotations: Record<string, boolean>; properties: Record<string, Record<string, unknown>>; required: string[] }> = {
  search: {
    title: "Search Open Brain",
    description:
      "Search Open Brain memories by meaning. Use this read-only compatibility tool when ChatGPT needs search/fetch-style access to stored thoughts.",
    annotations: { readOnlyHint: true },
    properties: { query: { type: "string", description: "The search query to run against Open Brain thoughts" } },
    required: ["query"],
  },
  fetch: {
    title: "Fetch Open Brain Thought",
    description:
      "Fetch one Open Brain thought by ID after using search. Use this read-only compatibility tool to retrieve the full text and metadata for citation.",
    annotations: { readOnlyHint: true },
    properties: { id: { type: "string", description: "The Open Brain thought ID returned by the search tool" } },
    required: ["id"],
  },
  search_thoughts: {
    title: "Search Thoughts",
    description:
      "Search captured thoughts by meaning. Use this when the user asks about a topic, person, or idea they've previously captured.",
    annotations: { readOnlyHint: true },
    properties: {
      query: { type: "string", description: "What to search for" },
      limit: { type: "number", default: 10 },
      threshold: { type: "number", default: 0.5 },
    },
    required: ["query"],
  },
  list_thoughts: {
    title: "List Recent Thoughts",
    description: "List recently captured thoughts with optional filters by type, topic, person, or time range.",
    annotations: { readOnlyHint: true },
    properties: {
      limit: { type: "number", default: 10 },
      type: { type: "string", description: "Filter by type: observation, task, idea, reference, person_note" },
      topic: { type: "string", description: "Filter by topic tag" },
      person: { type: "string", description: "Filter by person mentioned" },
      days: { type: "number", description: "Only thoughts from the last N days" },
    },
    required: [],
  },
  thought_stats: {
    title: "Thought Statistics",
    description: "Get a summary of all captured thoughts: totals, types, top topics, and people.",
    annotations: { readOnlyHint: true },
    properties: {},
    required: [],
  },
  capture_thought: {
    title: "Capture Thought",
    description:
      "Save a new thought to the Open Brain. Generates an embedding and extracts metadata automatically. Use this when the user wants to save something to their brain directly from any AI client — notes, insights, decisions, or migrated content from other systems.",
    annotations: { readOnlyHint: false, openWorldHint: false, destructiveHint: false, idempotentHint: false },
    properties: {
      content: {
        type: "string",
        description: "The thought to capture — a clear, standalone statement that will make sense when retrieved later by any AI",
      },
    },
    required: ["content"],
  },
};

Deno.test("U101 each tool's title, description, input schema and annotations equal core's", async () => {
  const { client } = await rig();
  const { tools } = await client.listTools();
  for (const t of tools) {
    const want = CORE_TOOLS[t.name];
    assert(want, `unexpected tool ${t.name}`);
    assertEquals(t.title, want.title, t.name);
    assertEquals(t.description, want.description, t.name);
    assertEquals(t.annotations, want.annotations, t.name);
    assertEquals(t.inputSchema.properties, want.properties, t.name);
    assertEquals([...(t.inputSchema.required ?? [])].sort(), [...want.required].sort(), t.name);
  }
});

/** Core's thoughtTitle, restated for expected values. */
function title(content: string, createdAt?: string): string {
  const firstLine = content.replace(/\s+/g, " ").trim().slice(0, 80);
  const datePrefix = createdAt ? new Date(createdAt).toLocaleDateString() : "Open Brain";
  return firstLine ? `${datePrefix} - ${firstLine}` : `${datePrefix} thought`;
}

Deno.test("U102 fetch of an existing id returns core's document text", async () => {
  const { client, store } = await rig();
  const row = store.seed({ id: "abc-1", content: "Remember the milk", metadata: { type: "task", topics: ["home"] } });
  const result = await client.callTool({ name: "fetch", arguments: { id: "abc-1" } });
  assert(!result.isError);
  assertEquals(JSON.parse(textOf(result)), {
    id: "abc-1",
    title: title(row.content, row.created_at),
    text: "Remember the milk",
    url: "https://openbrain.local/thoughts/abc-1",
    metadata: { type: "task", topics: ["home"], created_at: row.created_at, updated_at: row.updated_at },
  });
  assertEquals(store.calls.map((c) => c.method), ["fetchThought"]);
});

Deno.test("U103 fetch with a store error returns core's isError text", async () => {
  const { client, store } = await rig();
  store.fail.fetchThought = "row not found";
  const result = await client.callTool({ name: "fetch", arguments: { id: "nope" } });
  assertEquals(result.isError, true);
  assertEquals(textOf(result), "Fetch error: row not found");
});

Deno.test("U104 list_thoughts returns core's listing text for rows", async () => {
  const { client, store } = await rig();
  const a = store.seed({ content: "First thought", metadata: { type: "idea", topics: ["x", "y"] } });
  const b = store.seed({ content: "Second thought", metadata: {} });
  const result = await client.callTool({ name: "list_thoughts", arguments: {} });
  assert(!result.isError);
  // Newest first (the fake store sorts by created_at descending).
  assertEquals(
    textOf(result),
    `2 recent thought(s):\n\n1. [${new Date(b.created_at).toLocaleDateString()}] (??)\n   Second thought\n\n` +
      `2. [${new Date(a.created_at).toLocaleDateString()}] (idea - x, y)\n   First thought`,
  );
});

Deno.test("U105 list_thoughts with no rows returns core's empty text", async () => {
  const { client } = await rig();
  const result = await client.callTool({ name: "list_thoughts", arguments: {} });
  assert(!result.isError);
  assertEquals(textOf(result), "No thoughts found.");
});

Deno.test("U106 list_thoughts with a store error returns core's isError text", async () => {
  const { client, store } = await rig();
  store.fail.listThoughts = "db down";
  const result = await client.callTool({ name: "list_thoughts", arguments: {} });
  assertEquals(result.isError, true);
  assertEquals(textOf(result), "Error: db down");
});

Deno.test("U107 list_thoughts forwards limit, type, topic, person and days to the store", async () => {
  const { client, store } = await rig();
  await client.callTool({ name: "list_thoughts", arguments: { limit: 3, type: "idea", topic: "ai", person: "Ada", days: 7 } });
  assertEquals(store.calls.length, 1);
  assertEquals(store.calls[0].args, [{ limit: 3, type: "idea", topic: "ai", person: "Ada", days: 7 }]);
  await client.callTool({ name: "list_thoughts", arguments: {} });
  assertEquals(store.calls[1].args, [{ limit: 10 }]);
});

Deno.test("U108 thought_stats returns core's stats text", async () => {
  const { client, store } = await rig();
  const a = store.seed({ content: "a", metadata: { type: "idea", topics: ["x", "y"], people: ["Ada"] } });
  store.seed({ content: "b", metadata: { type: "idea", topics: ["x"] } });
  const c = store.seed({ content: "c", metadata: { type: "task" } });
  const d = (r: { created_at: string }) => new Date(r.created_at).toLocaleDateString();
  const result = await client.callTool({ name: "thought_stats", arguments: {} });
  assert(!result.isError);
  assertEquals(
    textOf(result),
    [
      "Total thoughts: 3",
      `Date range: ${d(a)} → ${d(c)}`,
      "",
      "Types:",
      "  idea: 2",
      "  task: 1",
      "",
      "Top topics:",
      "  x: 2",
      "  y: 1",
      "",
      "People mentioned:",
      "  Ada: 1",
    ].join("\n"),
  );
});

Deno.test("U109 search_thoughts embeds the query and matches with that vector, threshold 0.5 and count 10", async () => {
  const { client, fake, store } = await rig(GOOD_ENV, { embedding: embeddingReply(axisVector(3)) });
  await client.callTool({ name: "search_thoughts", arguments: { query: "where is the milk" } });
  const embedReq = fake.requests.find((r) => r.url === `${BASE}/embeddings`);
  assertEquals((embedReq?.body as { input: string }).input, "where is the milk");
  const match = store.calls.filter((c) => c.method === "matchThoughts");
  assertEquals(match.length, 1);
  assertEquals(match[0].args, [axisVector(3), 0.5, 10]);
});

Deno.test("U110 search_thoughts forwards an explicit limit and threshold", async () => {
  const { client, store } = await rig();
  await client.callTool({ name: "search_thoughts", arguments: { query: "q", limit: 3, threshold: 0.8 } });
  const match = store.calls.filter((c) => c.method === "matchThoughts");
  assertEquals(match.length, 1);
  assertEquals(match[0].args, [axisVector(0), 0.8, 3]);
});

Deno.test("U111 search_thoughts returns core's results text, and core's no-match text for none", async () => {
  const { client, store } = await rig();
  const row = store.seed({
    content: "Milk is in the fridge",
    embedding: axisVector(0),
    metadata: { type: "task", topics: ["home", "food"], people: ["Ada"], action_items: ["buy milk", "clean"] },
  });
  const result = await client.callTool({ name: "search_thoughts", arguments: { query: "milk" } });
  assert(!result.isError);
  assertEquals(
    textOf(result),
    `Found 1 thought(s):\n\n--- Result 1 (100.0% match) ---\nCaptured: ${new Date(row.created_at).toLocaleDateString()}\n` +
      `Type: task\nTopics: home, food\nPeople: Ada\nActions: buy milk; clean\n\nMilk is in the fridge`,
  );
  store.rows.length = 0;
  const none = await client.callTool({ name: "search_thoughts", arguments: { query: "milk" } });
  assert(!none.isError);
  assertEquals(textOf(none), 'No thoughts found matching "milk".');
});

Deno.test("U112 search returns core's results JSON using threshold 0.5 and count 10", async () => {
  const { client, store } = await rig();
  const row = store.seed({ id: "r-1", content: "Milk is in the fridge", embedding: axisVector(0), metadata: {} });
  const result = await client.callTool({ name: "search", arguments: { query: "milk" } });
  assert(!result.isError);
  assertEquals(JSON.parse(textOf(result)), {
    results: [{ id: "r-1", title: title(row.content, row.created_at), url: "https://openbrain.local/thoughts/r-1" }],
  });
  assertEquals(store.calls.find((c) => c.method === "matchThoughts")?.args, [axisVector(0), 0.5, 10]);
});

Deno.test("U113 search with a store error returns core's Search error text", async () => {
  const { client, store } = await rig();
  store.fail.matchThoughts = "rpc exploded";
  const result = await client.callTool({ name: "search", arguments: { query: "milk" } });
  assertEquals(result.isError, true);
  assertEquals(textOf(result), "Search error: rpc exploded");
});

Deno.test("U114 a successful capture replies with core's Captured as confirmation", async () => {
  const { client } = await rig(GOOD_ENV, {
    chat: chatReply('{"topics":["alpha","beta"],"type":"task","people":["Ada"],"action_items":["call","write"]}'),
  });
  const result = await client.callTool({ name: "capture_thought", arguments: { content: "Call Ada about the draft" } });
  assert(!result.isError);
  assertEquals(textOf(result), "Captured as task — alpha, beta | People: Ada | Actions: call; write");
});

Deno.test("U115 a successful capture stores extracted metadata plus source, embedding_model and enrichment_status complete", async () => {
  const { client, store } = await rig(GOOD_ENV, { chat: chatReply('{"topics":["alpha"],"type":"idea","people":["Ada"],"source":"model","embedding_model":"evil"}') });
  await client.callTool({ name: "capture_thought", arguments: { content: "An idea" } });
  const up = store.calls.filter((c) => c.method === "upsertThought");
  assertEquals(up.length, 1);
  assertEquals(up[0].args, [
    "An idea",
    { topics: ["alpha"], type: "idea", people: ["Ada"], source: "mcp", embedding_model: "embed-1", enrichment_status: "complete" },
  ]);
});

Deno.test("U116 a successful capture stores the model's vector as the row's embedding", async () => {
  const { client, store } = await rig(GOOD_ENV, { embedding: embeddingReply(axisVector(7)) });
  await client.callTool({ name: "capture_thought", arguments: { content: "An idea" } });
  assertEquals(store.rows.length, 1);
  assertEquals(store.rows[0].embedding, axisVector(7));
});

Deno.test("U117 both the embedding and chat requests are in flight before either reply is released", async () => {
  const { client, fake } = await rig(GOOD_ENV, {
    embedding: { hold: embeddingReply(axisVector(0)) },
    chat: { hold: chatReply('{"topics":["a"],"type":"idea"}') },
  });
  const pending = client.callTool({ name: "capture_thought", arguments: { content: "An idea" } });
  for (let i = 0; i < 50 && fake.heldCount < 2; i++) await new Promise((r) => setTimeout(r, 10));
  const held = fake.heldCount;
  let settled = false;
  pending.finally(() => (settled = true)).catch(() => {});
  while (!settled) {
    fake.release();
    await new Promise((r) => setTimeout(r, 5));
  }
  const result = await pending;
  assertEquals(held, 2);
  assert(!result.isError);
});

Deno.test("U118 every model request in a capture and a search goes to a configured base", async () => {
  const CHAT_BASE = "http://chat.test:8080/v1";
  const { client, fake } = await rig({ ...GOOD_ENV, CHAT_API_BASE: CHAT_BASE });
  fake.on("POST", `${CHAT_BASE}/chat/completions`, chatReply('{"topics":["a"],"type":"idea"}'));
  await client.callTool({ name: "capture_thought", arguments: { content: "An idea" } });
  await client.callTool({ name: "search_thoughts", arguments: { query: "idea" } });
  await client.callTool({ name: "search", arguments: { query: "idea" } });
  assert(fake.requests.length >= 4);
  assertEquals(fake.unmatched, []);
  for (const r of fake.requests) assert(r.url.startsWith(BASE) || r.url.startsWith(CHAT_BASE), r.url);
  assertEquals(fake.requests.filter((r) => r.url.startsWith(CHAT_BASE)).length, 1);
});

const GATE_TAIL = "Set these as function secrets (see README → Configure).";

Deno.test("U119 config gate: with EMBEDDING_API_BASE unset, capture returns the exact not-configured text", async () => {
  const { EMBEDDING_API_BASE: _drop, ...env } = GOOD_ENV;
  const { client } = await rig(env);
  const result = await client.callTool({ name: "capture_thought", arguments: { content: "An idea" } });
  assertEquals(result.isError, true);
  assertEquals(textOf(result), `Model endpoint not configured: missing EMBEDDING_API_BASE. ${GATE_TAIL}`);
});

const SIX_CALLS: [string, Record<string, unknown>][] = [
  ["search", { query: "q" }],
  ["fetch", { id: "x" }],
  ["search_thoughts", { query: "q" }],
  ["list_thoughts", {}],
  ["thought_stats", {}],
  ["capture_thought", { content: "c" }],
];

Deno.test("U120 config gate: with CHAT_MODEL unset, each of the six tools returns isError naming CHAT_MODEL", async () => {
  const { CHAT_MODEL: _drop, ...env } = GOOD_ENV;
  const { client } = await rig(env);
  for (const [name, args] of SIX_CALLS) {
    const result = await client.callTool({ name, arguments: args });
    assertEquals(result.isError, true, name);
    assertEquals(textOf(result), `Model endpoint not configured: missing CHAT_MODEL. ${GATE_TAIL}`, name);
  }
});

Deno.test("U121 config gate: no model request and no store call happen under a bad configuration", async () => {
  const { client, fake, store } = await rig({});
  for (const [name, args] of SIX_CALLS) {
    const result = await client.callTool({ name, arguments: args });
    assertEquals(result.isError, true, name);
  }
  assertEquals(fake.requests, []);
  assertEquals(store.calls, []);
});

Deno.test("U122 config gate: tools/list still returns the six tools under a bad configuration", async () => {
  const { client } = await rig({});
  const { tools } = await client.listTools();
  assertEquals(
    tools.map((t: { name: string }) => t.name).sort(),
    ["capture_thought", "fetch", "list_thoughts", "search", "search_thoughts", "thought_stats"],
  );
});

Deno.test("U123 config gate: an invalid setting is named with the missing ones", async () => {
  const { CHAT_MODEL: _drop, ...rest } = GOOD_ENV;
  const { client, fake, store } = await rig({ ...rest, EMBEDDING_API_BASE: "model.test/v1", FETCH_TIMEOUT_MS: "soon" });
  for (const [name, args] of SIX_CALLS) {
    const result = await client.callTool({ name, arguments: args });
    assertEquals(result.isError, true, name);
    const t = textOf(result);
    assert(t.startsWith("Model endpoint not configured: missing CHAT_MODEL"), t);
    assertStringIncludes(t, "EMBEDDING_API_BASE (must start with http:// or https://)");
    assertStringIncludes(t, "FETCH_TIMEOUT_MS (must be a positive whole number of milliseconds)");
    assert(t.endsWith(GATE_TAIL), t);
  }
  assertEquals(fake.requests, []);
  assertEquals(store.calls, []);
});

Deno.test("U124 config gate: setting a missing variable between two calls lets the second call run", async () => {
  const { CHAT_MODEL: _drop, ...env } = GOOD_ENV;
  const { client, env: live, fake } = await rig(env);
  const first = await client.callTool({ name: "capture_thought", arguments: { content: "An idea" } });
  assertEquals(first.isError, true);
  assertEquals(fake.requests, []);
  live.CHAT_MODEL = "chat-1";
  const second = await client.callTool({ name: "capture_thought", arguments: { content: "An idea" } });
  assert(!second.isError);
  assertEquals(textOf(second), "Captured as idea — alpha");
});

Deno.test("U125 search_thoughts and search with a failing embedding return isError naming the cause, with no matchThoughts call", async () => {
  const { client, store } = await rig(GOOD_ENV, { embedding: { networkError: "connection refused" } });
  store.seed({ content: "Milk", embedding: axisVector(0), metadata: {} });
  for (const name of ["search_thoughts", "search"]) {
    const result = await client.callTool({ name, arguments: { query: "milk" } });
    assertEquals(result.isError, true, name);
    const t = textOf(result);
    assert(t.startsWith("Error: "), t);
    assertStringIncludes(t, "embedding");
    assertStringIncludes(t, BASE);
    assertStringIncludes(t, "could not be reached");
    assert(!t.includes("Milk"), t);
  }
  assertEquals(store.calls.filter((c) => c.method === "matchThoughts"), []);
});

Deno.test("U126 capture with the embedding unreachable or timing out returns isError naming the cause, with no upsertThought call", async () => {
  const cases: [string, Handler, string[]][] = [
    ["unreachable", { networkError: "connection refused" }, ["embedding", BASE, "could not be reached"]],
    ["timeout", { hang: true }, ["embedding", BASE, "FETCH_TIMEOUT_MS", "30 ms"]],
  ];
  for (const [label, embedding, expected] of cases) {
    const { client, store } = await rig({ ...GOOD_ENV, FETCH_TIMEOUT_MS: "30" }, { embedding });
    const result = await client.callTool({ name: "capture_thought", arguments: { content: "An idea" } });
    assertEquals(result.isError, true, label);
    for (const part of expected) assertStringIncludes(textOf(result), part, label);
    assertEquals(store.calls.filter((c) => c.method === "upsertThought"), [], label);
    assertEquals(store.rows, [], label);
  }
});

Deno.test("U127 capture with an auth_rejected, model_not_found, bad_response or http_error embedding returns isError naming it, with no upsertThought call", async () => {
  const cases: [string, Handler, string][] = [
    ["auth_rejected", { status: 401, body: "nope" }, "access key rejected (HTTP 401)"],
    ["model_not_found", { status: 404, body: "gone" }, 'model "embed-1" was not found'],
    ["bad_response", { status: 200, body: { data: [] } }, "reply lacks"],
    ["http_error", { status: 500, body: "boom" }, "HTTP 500"],
  ];
  for (const [label, embedding, expected] of cases) {
    const { client, store } = await rig(GOOD_ENV, { embedding });
    const result = await client.callTool({ name: "capture_thought", arguments: { content: "An idea" } });
    assertEquals(result.isError, true, label);
    assertStringIncludes(textOf(result), "embedding", label);
    assertStringIncludes(textOf(result), BASE, label);
    assertStringIncludes(textOf(result), expected, label);
    assertEquals(store.calls.filter((c) => c.method === "upsertThought"), [], label);
  }
});

Deno.test("U128 capture with a 768-length embedding returns the exact wrong_dimension text and stores nothing", async () => {
  const { client, store } = await rig(GOOD_ENV, { embedding: embeddingReply(axisVector(0, 768)) });
  const result = await client.callTool({ name: "capture_thought", arguments: { content: "An idea" } });
  assertEquals(result.isError, true);
  assertEquals(
    textOf(result),
    'Error: Embedding model "embed-1" returned 768-dimension vectors; this brain stores 1536. Choose a model that can output 1536 dimensions (see README).',
  );
  assertEquals(store.calls, []);
  assertEquals(store.rows, []);
});

Deno.test("U129 capture whose embedding fails while chat succeeds stores nothing", async () => {
  const { client, fake, store } = await rig(GOOD_ENV, { embedding: { status: 500, body: "boom" } });
  const result = await client.callTool({ name: "capture_thought", arguments: { content: "An idea" } });
  assertEquals(result.isError, true);
  assertEquals(fake.requests.filter((r) => r.url === `${BASE}/chat/completions`).length, 1);
  assertEquals(store.calls, []);
  assertEquals(store.rows, []);
});

const FALLBACK_META = {
  topics: ["uncategorized"],
  type: "observation",
  source: "mcp",
  embedding_model: "embed-1",
  enrichment_status: "fallback",
};

Deno.test("U130 capture with chat unreachable stores the row with its embedding and the fallback metadata", async () => {
  const { client, store } = await rig(GOOD_ENV, { chat: { networkError: "connection refused" } });
  const result = await client.callTool({ name: "capture_thought", arguments: { content: "An idea" } });
  assert(!result.isError);
  assertEquals(store.rows.length, 1);
  assertEquals(store.rows[0].embedding, axisVector(0));
  assertEquals(store.rows[0].metadata, FALLBACK_META);
});

Deno.test("U131 capture with chat timing out stores the fallback row and ends the reply with the skip line naming the timeout", async () => {
  const { client, store } = await rig({ ...GOOD_ENV, FETCH_TIMEOUT_MS: "30" }, { chat: { hang: true } });
  const result = await client.callTool({ name: "capture_thought", arguments: { content: "An idea" } });
  assert(!result.isError);
  assertEquals(store.rows.length, 1);
  assertEquals(store.rows[0].metadata, FALLBACK_META);
  const t = textOf(result);
  const m = t.match(/^Captured as observation — uncategorized\nMetadata extraction skipped: (.+)\. Saved with default metadata\.$/);
  assert(m, t);
  assertStringIncludes(m[1], "FETCH_TIMEOUT_MS");
  assertStringIncludes(m[1], "chat");
  assertStringIncludes(m[1], "30 ms");
});

Deno.test("U132 capture with a chat 5xx or missing choices stores the fallback row with the skip line naming the reason", async () => {
  const cases: [Handler, string][] = [
    [{ status: 503, body: "overloaded" }, "HTTP 503"],
    [{ status: 200, body: { object: "chat.completion" } }, "reply lacks"],
  ];
  for (const [chat, reason] of cases) {
    const { client, store } = await rig(GOOD_ENV, { chat });
    const result = await client.callTool({ name: "capture_thought", arguments: { content: "An idea" } });
    assert(!result.isError, reason);
    assertEquals(store.rows[0].metadata, FALLBACK_META, reason);
    const t = textOf(result);
    assert(t.startsWith("Captured as observation — uncategorized\nMetadata extraction skipped: "), t);
    assertStringIncludes(t, reason);
    assert(t.endsWith(". Saved with default metadata."), t);
  }
});

Deno.test("U133 capture with chat content that is not a JSON object stores the fallback row with the skip line", async () => {
  for (const content of ["Sure! Here is the metadata.", "[1,2]", "42", "null"]) {
    const { client, store } = await rig(GOOD_ENV, { chat: chatReply(content) });
    const result = await client.callTool({ name: "capture_thought", arguments: { content: "An idea" } });
    assert(!result.isError, content);
    assertEquals(store.rows[0].metadata, FALLBACK_META, content);
    const t = textOf(result);
    assert(t.startsWith("Captured as observation — uncategorized\nMetadata extraction skipped: "), t);
    assert(t.endsWith(". Saved with default metadata."), t);
    assertStringIncludes(t, "JSON object");
  }
});

Deno.test("U134 capture with chat content in one fenced JSON block stores enrichment_status complete", async () => {
  const { client, store } = await rig(GOOD_ENV, { chat: chatReply('```json\n{"topics":["fenced"],"type":"reference"}\n```') });
  const result = await client.callTool({ name: "capture_thought", arguments: { content: "An idea" } });
  assert(!result.isError);
  assertEquals(textOf(result), "Captured as reference — fenced");
  assertEquals(store.rows[0].metadata, {
    topics: ["fenced"],
    type: "reference",
    source: "mcp",
    embedding_model: "embed-1",
    enrichment_status: "complete",
  });
});

Deno.test("U135 a fallback reply keeps core's Captured as observation — uncategorized text before the skip line", async () => {
  const { client } = await rig(GOOD_ENV, { chat: { networkError: "down" } });
  const result = await client.callTool({ name: "capture_thought", arguments: { content: "An idea" } });
  const lines = textOf(result).split("\n");
  assertEquals(lines.length, 2);
  assertEquals(lines[0], "Captured as observation — uncategorized");
  assert(lines[1].startsWith("Metadata extraction skipped: "));
});

Deno.test("U136 capturing existing text with chat failing marks the one existing row fallback", async () => {
  const { client, store } = await rig(GOOD_ENV, { chat: { networkError: "down" } });
  store.seed({
    id: "old-1",
    content: "An idea",
    embedding: axisVector(5),
    metadata: { type: "idea", topics: ["good"], enrichment_status: "complete", embedding_model: "embed-1" },
  });
  const result = await client.callTool({ name: "capture_thought", arguments: { content: "An idea" } });
  assert(!result.isError);
  assertEquals(store.rows.length, 1);
  assertEquals(store.rows[0].id, "old-1");
  assertEquals(store.rows[0].metadata.enrichment_status, "fallback");
});

Deno.test("U137 recapturing that text with chat working marks the same row complete", async () => {
  const { client, store } = await rig(GOOD_ENV, {
    chat: [{ networkError: "down" }, chatReply('{"topics":["good"],"type":"idea"}')],
  });
  await client.callTool({ name: "capture_thought", arguments: { content: "An idea" } });
  assertEquals(store.rows.length, 1);
  assertEquals(store.rows[0].metadata.enrichment_status, "fallback");
  const id = store.rows[0].id;
  await client.callTool({ name: "capture_thought", arguments: { content: "An idea" } });
  assertEquals(store.rows.length, 1);
  assertEquals(store.rows[0].id, id);
  assertEquals(store.rows[0].metadata.enrichment_status, "complete");
  assertEquals(store.rows[0].metadata.type, "idea");
});
