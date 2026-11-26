/**
 * Proves the test harness itself works under fork-ci's flags
 * (--node-modules-dir=none --no-prompt --allow-env --allow-read, no network)
 * before any stream builds on it. Test names start with H<n> so
 * `--filter "/^H<n> /"` selects exactly one.
 */
import { assert, assertEquals, assertRejects } from "jsr:@std/assert@^1";
import { McpServer } from "npm:@modelcontextprotocol/sdk@1.24.3/server/mcp.js";
import { StreamableHTTPTransport } from "npm:@hono/mcp@0.1.1";
import { Hono } from "npm:hono@4.9.2";
import { z } from "npm:zod@4.1.13";
import { createClient } from "npm:@supabase/supabase-js@2.47.10";
import { FakeFetch, type RecordedRequest } from "./fake_fetch.ts";
import { FakeStore } from "./fake_store.ts";
import { inMemoryClient, mcpCall } from "./mcp.ts";
import { todo } from "./todo.ts";

function echoServer(): McpServer {
  const server = new McpServer({ name: "harness", version: "0.0.0" });
  server.registerTool(
    "echo",
    { title: "Echo", description: "Echo the input", inputSchema: { text: z.string() } },
    ({ text }) => ({ content: [{ type: "text" as const, text: `echo: ${text}` }] }),
  );
  return server;
}

function echoApp() {
  const app = new Hono();
  app.all("*", async (c) => {
    const server = echoServer();
    const transport = new StreamableHTTPTransport();
    await server.connect(transport);
    return (await transport.handleRequest(c)) ?? c.text("no response", 500);
  });
  return app;
}

Deno.test("H1 a stateless Hono + StreamableHTTPTransport app answers initialize through app.fetch", async () => {
  const r = await mcpCall(echoApp().fetch, "initialize", {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "t", version: "1" },
  });
  assertEquals(r.status, 200);
  assertEquals((r.message?.result as { serverInfo: { name: string } }).serverInfo.name, "harness");
});

Deno.test("H2 the same app answers tools/list and tools/call", async () => {
  const list = await mcpCall(echoApp().fetch, "tools/list");
  assertEquals((list.message?.result as { tools: { name: string }[] }).tools.map((t) => t.name), ["echo"]);
  const call = await mcpCall(echoApp().fetch, "tools/call", { name: "echo", arguments: { text: "hi" } });
  assertEquals((call.message?.result as { content: { text: string }[] }).content[0].text, "echo: hi");
});

Deno.test("H3 inMemoryClient lists and calls a tool", async () => {
  const client = await inMemoryClient(echoServer());
  assertEquals((await client.listTools()).tools.map((t) => t.name), ["echo"]);
  const res = await client.callTool({ name: "echo", arguments: { text: "x" } });
  assertEquals((res.content as { text: string }[])[0].text, "echo: x");
  await client.close();
});

Deno.test("H4 supabase-js with an injected fetch sends its request to the fake", async () => {
  const fake = new FakeFetch().on("GET", "http://supabase.test/rest/v1/thoughts", { status: 200, body: [] });
  const sb = createClient("http://supabase.test", "service-key", {
    global: { fetch: fake.fetch },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const { data, error } = await sb.from("thoughts").select("id").eq("id", "abc");
  assertEquals(error, null);
  assertEquals(data, []);
  assertEquals(fake.requests.length, 1);
  assert(fake.requests[0].url.includes("id=eq.abc"));
});

Deno.test("H5 fake fetch hang mode rejects with AbortError when the signal fires", async () => {
  const fake = new FakeFetch().on("POST", "http://model.test/v1/embeddings", { hang: true });
  const err = await assertRejects(() =>
    fake.fetch("http://model.test/v1/embeddings", { method: "POST", body: "{}", signal: AbortSignal.timeout(5) })
  );
  assertEquals((err as DOMException).name, "AbortError");
});

Deno.test("H6 fake fetch hold mode keeps requests in flight until release()", async () => {
  const fake = new FakeFetch().on("GET", "http://model.test/v1/models", { hold: { status: 200, body: { data: [] } } });
  const a = fake.fetch("http://model.test/v1/models");
  const b = fake.fetch("http://model.test/v1/models");
  await new Promise((r) => setTimeout(r, 0));
  assertEquals(fake.heldCount, 2);
  fake.release();
  assertEquals((await a).status, 200);
  assertEquals((await b).status, 200);
});

Deno.test("H7 fake store merges metadata into the existing row on a duplicate fingerprint", async () => {
  const store = new FakeStore();
  const first = await store.upsertThought("Hello  World", { type: "idea", topics: ["a"] });
  const second = await store.upsertThought("hello world", { topics: ["b"], source: "mcp" });
  assertEquals(store.rows.length, 1);
  assertEquals("data" in first && first.data.id, "data" in second && second.data.id);
  assertEquals(store.rows[0].metadata, { type: "idea", topics: ["b"], source: "mcp" });
});

Deno.test("H8 fake store gives created_at = updated_at only on insert", async () => {
  const store = new FakeStore();
  const ins = await store.upsertThought("one", {});
  const id = "data" in ins ? ins.data.id : "";
  const afterInsert = await store.readBack(id);
  assert("data" in afterInsert && afterInsert.data.createdAt === afterInsert.data.updatedAt);
  await store.upsertThought("one", { x: 1 });
  const afterMerge = await store.readBack(id);
  assert("data" in afterMerge && afterMerge.data.createdAt < afterMerge.data.updatedAt);
});

Deno.test("H9 fake store deleteIfInsertedByCall deletes only an unembedded row with matching timestamps", async () => {
  const store = new FakeStore();
  const ins = await store.upsertThought("two", {});
  const id = "data" in ins ? ins.data.id : "";
  const rb = await store.readBack(id);
  const t = "data" in rb ? rb.data.createdAt : "";
  assertEquals(await store.deleteIfInsertedByCall(id, "2000-01-01T00:00:00.000Z"), { data: { deleted: false } });
  assertEquals(await store.deleteIfInsertedByCall(id, t), { data: { deleted: true } });
  assertEquals(store.rows.length, 0);
});

Deno.test("H10 fake fetch networkError rejects with a TypeError carrying the message and records the request", async () => {
  const fake = new FakeFetch().on("GET", "http://model.test/v1/models", { networkError: "connection refused" });
  const err = await assertRejects(() => fake.fetch("http://model.test/v1/models"));
  assert(err instanceof TypeError);
  assertEquals((err as TypeError).message, "connection refused");
  assertEquals(fake.requests.length, 1);
  assertEquals(fake.unmatched.length, 0);
});

Deno.test("H11 fake fetch function handlers receive the recorded request and reply", async () => {
  const seen: RecordedRequest[] = [];
  const fake = new FakeFetch().on("POST", "http://model.test/v1/chat", (req) => {
    seen.push(req);
    return { status: 201, body: { echoed: req.body }, headers: { "x-test": "yes" } };
  });
  const res = await fake.fetch("http://model.test/v1/chat?x=1", {
    method: "POST",
    headers: { "content-type": "application/json", "x-in": "abc" },
    body: JSON.stringify({ hello: "world" }),
  });
  assertEquals(res.status, 201);
  assertEquals(res.headers.get("x-test"), "yes");
  assertEquals(res.headers.get("content-type"), "application/json");
  assertEquals(await res.json(), { echoed: { hello: "world" } });
  assertEquals(seen.length, 1);
  assertEquals(seen[0].method, "POST");
  assertEquals(seen[0].url, "http://model.test/v1/chat?x=1");
  assertEquals(seen[0].headers["x-in"], "abc");
  assertEquals(seen[0].body, { hello: "world" });
});

Deno.test("H12 fake fetch per-call handlers: call N uses handler N and the last one repeats", async () => {
  const fake = new FakeFetch().on("GET", "http://model.test/v1/models", { status: 500 }, { status: 404 }, { status: 200 });
  const statuses: number[] = [];
  for (let i = 0; i < 5; i++) statuses.push((await fake.fetch("http://model.test/v1/models")).status);
  assertEquals(statuses, [500, 404, 200, 200, 200]);
});

Deno.test("H13 fake fetch records an unrouted request as unmatched and rejects", async () => {
  const fake = new FakeFetch().on("GET", "http://model.test/v1/models", { status: 200 });
  const err = await assertRejects(() => fake.fetch("http://model.test/v1/other", { method: "POST", body: "raw text" }));
  assert(err instanceof TypeError);
  assertEquals((err as TypeError).message, "FakeFetch: no route for POST http://model.test/v1/other");
  assertEquals(fake.unmatched.length, 1);
  assertEquals(fake.unmatched[0].method, "POST");
  assertEquals(fake.unmatched[0].url, "http://model.test/v1/other");
  assertEquals(fake.unmatched[0].body, "raw text");
  assertEquals(fake.requests.length, 1);
  assertEquals(fake.inFlight, 0);
});

Deno.test("H14 fake store seed adds a row visible to reads, with no embedding_model unless given", async () => {
  const store = new FakeStore();
  const row = store.seed({ content: "Seeded  Thought", metadata: { type: "idea" } });
  assertEquals(row.id, "seed-1");
  assertEquals(row.fingerprint, "seeded thought");
  assertEquals(row.embedding, null);
  assertEquals("embedding_model" in row.metadata, false);
  const fetched = await store.fetchThought("seed-1");
  assert("data" in fetched);
  assertEquals(fetched.data.content, "Seeded  Thought");
  assertEquals(fetched.data.metadata, { type: "idea" });
  const listed = await store.listThoughts({ limit: 10 });
  assert("data" in listed);
  assertEquals(listed.data.map((r) => r.content), ["Seeded  Thought"]);
  const withModel = store.seed({ content: "other", metadata: { embedding_model: "m" } });
  assertEquals(withModel.metadata.embedding_model, "m");
});

Deno.test("H15 fake store fail makes the named method return { error } and leaves others working", async () => {
  const store = new FakeStore();
  store.fail.countAll = "boom";
  assertEquals(await store.countAll(), { error: "boom" });
  assertEquals(await store.countWithModel("m"), { data: 0 });
  assertEquals(store.calls.map((c) => c.method), ["countAll", "countWithModel"]);
});

Deno.test("H16 fake store calls records each method and its arguments in order", async () => {
  const store = new FakeStore();
  await store.upsertThought("abc", { a: 1 });
  await store.countWithModel("m1");
  await store.fetchThought("nope");
  assertEquals(store.calls, [
    { method: "upsertThought", args: ["abc", { a: 1 }] },
    { method: "countWithModel", args: ["m1"] },
    { method: "fetchThought", args: ["nope"] },
  ]);
});

Deno.test("H17 fake store countAll counts every row and countWithModel filters on metadata.embedding_model", async () => {
  const store = new FakeStore();
  assertEquals(await store.countAll(), { data: 0 });
  store.seed({ content: "a", metadata: { embedding_model: "m1" } });
  store.seed({ content: "b", metadata: { embedding_model: "m1" } });
  store.seed({ content: "c", metadata: { embedding_model: "m2" } });
  store.seed({ content: "d" });
  assertEquals(await store.countAll(), { data: 4 });
  assertEquals(await store.countWithModel("m1"), { data: 2 });
  assertEquals(await store.countWithModel("m2"), { data: 1 });
  assertEquals(await store.countWithModel("absent"), { data: 0 });
});

Deno.test("H18 fake store override replaces a method's behavior, is still recorded, and wins over fail", async () => {
  const store = new FakeStore();
  store.seed({ content: "x" });
  store.fail.countAll = "ignored";
  store.override.countAll = () => Promise.resolve({ data: 99 });
  assertEquals(await store.countAll(), { data: 99 });
  assertEquals(store.calls.map((c) => c.method), ["countAll"]);
  assertEquals(await store.countWithModel("m"), { data: 0 });
});

Deno.test("H19 todo registers a test ignored unless RUN_TODO is 1", async () => {
  const registered: Deno.TestDefinition[] = [];
  const realTest = Deno.test;
  const saved = Deno.env.get("RUN_TODO");
  try {
    // deno-lint-ignore no-explicit-any
    (Deno as any).test = (def: Deno.TestDefinition) => registered.push(def);
    Deno.env.delete("RUN_TODO");
    todo("T-off", () => {});
    Deno.env.set("RUN_TODO", "1");
    todo("T-on", () => {});
    Deno.env.set("RUN_TODO", "0");
    todo("T-zero", () => {});
  } finally {
    // deno-lint-ignore no-explicit-any
    (Deno as any).test = realTest;
    if (saved === undefined) Deno.env.delete("RUN_TODO");
    else Deno.env.set("RUN_TODO", saved);
  }
  assertEquals(registered.map((d) => [d.name, d.ignore]), [["T-off", true], ["T-on", false], ["T-zero", true]]);
});
