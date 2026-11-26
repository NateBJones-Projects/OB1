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
  opts: { embedding?: Handler; chat?: Handler } = {},
): Promise<Rig> {
  const e = { ...env };
  const fake = new FakeFetch();
  fake.on("POST", `${BASE}/embeddings`, opts.embedding ?? embeddingReply(axisVector(0)));
  fake.on("POST", `${BASE}/chat/completions`, opts.chat ?? chatReply('{"topics":["alpha"],"type":"idea"}'));
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
