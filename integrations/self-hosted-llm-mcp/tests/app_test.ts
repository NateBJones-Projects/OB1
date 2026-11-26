import { assert, assertEquals, assertStringIncludes } from "jsr:@std/assert@^1";
import { createApp } from "../lib/app.ts";
import type { Deps } from "../lib/types.ts";
import { FakeFetch } from "./helpers/fake_fetch.ts";
import { FakeStore } from "./helpers/fake_store.ts";
import { FUNCTION_URL, mcpCall } from "./helpers/mcp.ts";

const KEY = "test-key";

/** Core's CORS headers (server/index.ts). */
const CORE_CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-brain-key, accept, mcp-session-id, mcp-protocol-version, last-event-id",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS, DELETE",
};

function makeDeps(env: Record<string, string> = { MCP_ACCESS_KEY: KEY }, fake = new FakeFetch()): Deps {
  return { getEnv: (n) => env[n], modelFetch: fake.fetch, store: new FakeStore() };
}

function assertCors(res: Response) {
  for (const [k, v] of Object.entries(CORE_CORS)) assertEquals(res.headers.get(k), v, k);
}

Deno.test("U180 OPTIONS on any path, with no key, answers 200 ok with core's CORS headers", async () => {
  const app = createApp(makeDeps());
  for (const path of ["", "/setup-check", "/anything/else"]) {
    const res = await app.fetch(new Request(FUNCTION_URL + path, { method: "OPTIONS" }));
    assertEquals(res.status, 200);
    assertEquals(await res.text(), "ok");
    assertCors(res);
  }
});

const UNAUTHORIZED = "Unauthorized: missing or invalid authentication.";

Deno.test("U181 a POST with no key answers HTTP 200 with the JSON-RPC -32001 unauthorized envelope", async () => {
  const app = createApp(makeDeps());
  const { status, message } = await mcpCall(app.fetch, "tools/list");
  assertEquals(status, 200);
  const m = message as { jsonrpc: string; error: { code: number; message: string } };
  assertEquals(m.jsonrpc, "2.0");
  assertEquals(m.error, { code: -32001, message: UNAUTHORIZED });
});

function post(body: string | null): Request {
  return new Request(FUNCTION_URL, { method: "POST", headers: { "content-type": "application/json" }, body });
}

Deno.test("U182 the envelope echoes a string or number id, and gives null for a null, missing, non-scalar or unparseable id", async () => {
  const app = createApp(makeDeps());
  const idOf = async (body: string | null) => (await (await app.fetch(post(body))).json()).id;
  assertEquals(await idOf('{"jsonrpc":"2.0","id":"abc","method":"x"}'), "abc");
  assertEquals(await idOf('{"jsonrpc":"2.0","id":42,"method":"x"}'), 42);
  assertEquals(await idOf('{"jsonrpc":"2.0","id":null,"method":"x"}'), null);
  assertEquals(await idOf('{"jsonrpc":"2.0","method":"x"}'), null);
  assertEquals(await idOf('{"jsonrpc":"2.0","id":{"a":1},"method":"x"}'), null);
  assertEquals(await idOf('{"jsonrpc":"2.0","id":[1],"method":"x"}'), null);
  assertEquals(await idOf("not json"), null);
  assertEquals(await idOf(null), null);
});

Deno.test("U183 a GET with a wrong key gets the envelope with id null", async () => {
  const app = createApp(makeDeps());
  const res = await app.fetch(new Request(FUNCTION_URL, { headers: { "x-brain-key": "wrong" } }));
  assertEquals(res.status, 200);
  assertEquals(await res.json(), { jsonrpc: "2.0", error: { code: -32001, message: UNAUTHORIZED }, id: null });
});

/** Core's golden unauthorized response at 238df6c (server/index.ts unauthorizedResponse), with request id 7. */
const GOLDEN_BODY = '{"jsonrpc":"2.0","error":{"code":-32001,"message":"Unauthorized: missing or invalid authentication."},"id":7}';

Deno.test("U184 the unauthorized response's status, body, Content-Type and CORS headers equal core's golden response", async () => {
  const app = createApp(makeDeps());
  const res = await app.fetch(post('{"jsonrpc":"2.0","id":7,"method":"tools/list"}'));
  assertEquals(res.status, 200);
  assertEquals(await res.text(), GOLDEN_BODY);
  assertEquals(res.headers.get("content-type"), "application/json");
  assertCors(res);
});

Deno.test("U185 a wrong x-brain-key and a wrong ?key= are each refused", async () => {
  const app = createApp(makeDeps());
  const viaHeader = await mcpCall(app.fetch, "tools/list", {}, { key: "wrong" });
  const viaQuery = await mcpCall(app.fetch, "tools/list", {}, { key: "wrong", via: "query" });
  for (const r of [viaHeader, viaQuery]) {
    assertEquals(r.status, 200);
    assertEquals((r.message as { error: { code: number } }).error.code, -32001);
  }
});

function toolNames(message: Record<string, unknown> | null): string[] {
  return ((message as { result: { tools: { name: string }[] } }).result.tools).map((t) => t.name);
}

Deno.test("U186 a correct x-brain-key, and a correct ?key= alone, each reach the MCP route", async () => {
  const app = createApp(makeDeps());
  const viaHeader = await mcpCall(app.fetch, "tools/list", {}, { key: KEY });
  const viaQuery = await mcpCall(app.fetch, "tools/list", {}, { key: KEY, via: "query" });
  for (const r of [viaHeader, viaQuery]) {
    assertEquals(r.status, 200);
    assert(toolNames(r.message).includes("capture_thought"));
  }
});
