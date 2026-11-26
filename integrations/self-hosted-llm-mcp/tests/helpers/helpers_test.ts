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
import { FakeFetch } from "./fake_fetch.ts";
import { FakeStore } from "./fake_store.ts";
import { inMemoryClient, mcpCall } from "./mcp.ts";

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
