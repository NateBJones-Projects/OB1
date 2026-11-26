import { assert, assertEquals, assertStringIncludes } from "jsr:@std/assert@^1";
import { createApp, productionDeps } from "../lib/app.ts";
import { runSetupCheck } from "../lib/setup_check.ts";
import type { Deps } from "../lib/types.ts";
import { axisVector, chatReply, embeddingReply, FakeFetch, modelsReply } from "./helpers/fake_fetch.ts";
import { FakeStore } from "./helpers/fake_store.ts";
import { FUNCTION_URL, mcpCall, parseMessage } from "./helpers/mcp.ts";

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

function toolsList(url: string, headers: Record<string, string> = {}): Request {
  return new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...headers },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
  });
}

async function isRefused(res: Response): Promise<boolean> {
  const m = await res.json().catch(() => null);
  return res.status === 200 && m?.error?.code === -32001;
}

Deno.test("U187 a non-empty header wins over the query; an empty header falls through to the query", async () => {
  const app = createApp(makeDeps());
  const q = (k: string) => `${FUNCTION_URL}?key=${k}`;
  assert(await isRefused(await app.fetch(toolsList(q(KEY), { "x-brain-key": "wrong" }))), "wrong header + right query");
  assert(!(await isRefused(await app.fetch(toolsList(q("wrong"), { "x-brain-key": KEY })))), "right header + wrong query");
  assert(!(await isRefused(await app.fetch(toolsList(q(KEY), { "x-brain-key": "" })))), "empty header falls through");
});

Deno.test("U188 with MCP_ACCESS_KEY unset or empty, every request is refused whatever key it presents", async () => {
  for (const env of [{} as Record<string, string>, { MCP_ACCESS_KEY: "" }]) {
    const app = createApp(makeDeps(env));
    for (const key of ["", "anything", "undefined"]) {
      assert(await isRefused(await app.fetch(toolsList(`${FUNCTION_URL}?key=${key}`, { "x-brain-key": key }))), `key "${key}"`);
    }
    assert(await isRefused(await app.fetch(toolsList(FUNCTION_URL))), "no key");
  }
});

Deno.test("U189 Supabase Authorization Bearer or apikey headers without the access key are refused", async () => {
  const app = createApp(makeDeps());
  assert(await isRefused(await app.fetch(toolsList(FUNCTION_URL, { authorization: `Bearer ${KEY}` }))));
  assert(await isRefused(await app.fetch(toolsList(FUNCTION_URL, { apikey: KEY }))));
  assert(await isRefused(await app.fetch(toolsList(FUNCTION_URL, { authorization: `Bearer ${KEY}`, apikey: KEY }))));
});

Deno.test("U190 an authorized tools/list succeeds with no Accept header, with application/json only, and with both types", async () => {
  const app = createApp(makeDeps());
  const accepts: (string | null)[] = [null, "application/json", "application/json, text/event-stream"];
  for (const accept of accepts) {
    const req = toolsList(FUNCTION_URL, { "x-brain-key": KEY });
    if (accept === null) req.headers.delete("accept");
    else req.headers.set("accept", accept);
    const res = await app.fetch(req);
    assertEquals(res.status, 200, `accept ${accept}`);
    const message = await parseMessage(res);
    assert(toolNames(message).includes("search_thoughts"), `accept ${accept}`);
  }
});

Deno.test("U191 an authorized response has no mcp-session-id header and carries the CORS headers", async () => {
  const app = createApp(makeDeps());
  const init = await mcpCall(app.fetch, "initialize", {
    protocolVersion: "2025-03-26",
    capabilities: {},
    clientInfo: { name: "t", version: "1" },
  }, { key: KEY });
  const list = await mcpCall(app.fetch, "tools/list", {}, { key: KEY });
  for (const r of [init, list]) {
    assertEquals(r.status, 200);
    assertEquals(r.response.headers.get("mcp-session-id"), null);
    assertCors(r.response);
  }
});

Deno.test("U192 the MCP route serves the tools built from the injected deps", async () => {
  const store = new FakeStore();
  store.seed({ content: "one" });
  store.seed({ content: "two" });
  const env = { MCP_ACCESS_KEY: KEY, EMBEDDING_API_BASE: "http://model.test/v1", EMBEDDING_MODEL: "e", CHAT_MODEL: "c" };
  const app = createApp({ ...makeDeps(env), store });
  const { message } = await mcpCall(app.fetch, "tools/call", { name: "thought_stats", arguments: {} }, { key: KEY });
  const text = (message as { result: { content: { text: string }[] } }).result.content[0].text;
  assertStringIncludes(text, "Total thoughts: 2");
  assertEquals(store.calls.some((c) => c.method === "stats"), true);
});

Deno.test("U193 productionDeps reads Deno.env, uses globalThis.fetch and builds the store from the Supabase settings", async () => {
  const saved = { fetch: globalThis.fetch, url: Deno.env.get("SUPABASE_URL"), key: Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") };
  const seen: Request[] = [];
  const stub: typeof fetch = (input, init) => {
    seen.push(input instanceof Request ? input : new Request(input, init));
    return Promise.resolve(new Response("[]", { status: 200, headers: { "content-type": "application/json", "content-range": "*/7" } }));
  };
  try {
    globalThis.fetch = stub;
    Deno.env.set("SUPABASE_URL", "http://db.test");
    Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "service-role-secret");
    Deno.env.set("SHL_U193_PROBE", "probe-value");
    const deps = productionDeps();
    assertEquals(deps.getEnv("SHL_U193_PROBE"), "probe-value");
    assertEquals(deps.getEnv("SHL_U193_ABSENT"), undefined);
    assert(deps.modelFetch === stub, "modelFetch is globalThis.fetch");
    await deps.store.countAll();
    assert(seen.length > 0, "the store made a request through fetch");
    assert(seen[0].url.startsWith("http://db.test/"), seen[0].url);
    assertEquals(seen[0].headers.get("apikey"), "service-role-secret");
  } finally {
    globalThis.fetch = saved.fetch;
    Deno.env.delete("SHL_U193_PROBE");
    for (const [name, v] of [["SUPABASE_URL", saved.url], ["SUPABASE_SERVICE_ROLE_KEY", saved.key]] as const) {
      if (v === undefined) Deno.env.delete(name);
      else Deno.env.set(name, v);
    }
  }
});

Deno.test("U194 index.ts holds one statement serving createApp(productionDeps()).fetch", async () => {
  const source = await Deno.readTextFile(new URL("../index.ts", import.meta.url));
  const code = source.split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("//"));
  const imports = code.filter((l) => l.startsWith("import "));
  const rest = code.filter((l) => !l.startsWith("import ")).join(" ");
  assertEquals(imports, ['import { createApp, productionDeps } from "./lib/app.ts";']);
  assertEquals(rest, "Deno.serve(createApp(productionDeps()).fetch);");
});

const BASE = "http://model.test/v1";
const MODEL_ENV = { MCP_ACCESS_KEY: KEY, EMBEDDING_API_BASE: BASE, EMBEDDING_MODEL: "embed-1536", CHAT_MODEL: "chat-small" };
const GOOD_META = '{"type":"idea","topics":[],"people":[],"action_items":[],"dates_mentioned":[]}';

function healthyFake(): FakeFetch {
  return new FakeFetch()
    .on("POST", `${BASE}/embeddings`, () => embeddingReply(axisVector(0)))
    .on("POST", `${BASE}/chat/completions`, chatReply(GOOD_META))
    .on("GET", `${BASE}/models`, modelsReply(["embed-1536", "chat-small"]));
}

const checkRequest = (path = "/setup-check", headers: Record<string, string> = { "x-brain-key": KEY }) =>
  new Request(FUNCTION_URL + path, { headers });

Deno.test("U196 GET setup-check with the key answers 200 for an ok report and 503 otherwise, with the same JSON body, content type and CORS", async () => {
  const okDeps = makeDeps(MODEL_ENV, healthyFake());
  const ok = await createApp(okDeps).fetch(checkRequest());
  assertEquals(ok.status, 200);
  assertEquals(ok.headers.get("content-type"), "application/json");
  assertCors(ok);
  const okReport = await runSetupCheck(makeDeps(MODEL_ENV, healthyFake()));
  assertEquals(okReport.ok, true);
  assertEquals(await ok.json(), okReport);

  const bad = await createApp(makeDeps({ MCP_ACCESS_KEY: KEY })).fetch(checkRequest());
  assertEquals(bad.status, 503);
  assertEquals(bad.headers.get("content-type"), "application/json");
  assertCors(bad);
  const badReport = await runSetupCheck(makeDeps({ MCP_ACCESS_KEY: KEY }));
  assertEquals(badReport.ok, false);
  assertEquals(await bad.json(), badReport);
});
