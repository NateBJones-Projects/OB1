/**
 * auth_test.ts — regression tests for MCP auth failures in index.ts.
 *
 * Auth failures must return HTTP 401 + WWW-Authenticate (MCP spec 2025-11-25,
 * basic/authorization "Error Handling"). An HTTP 200 auth failure makes MCP
 * clients reconnect indefinitely. Do not change these to expect 200.
 *
 * Run (from server/): deno test --allow-env --allow-net --allow-read auth_test.ts
 * No infra required: tools/list and initialize never touch the database.
 */

const KEY = "a".repeat(64);
Deno.env.set("MCP_ACCESS_KEY", KEY);
Deno.env.set("SUPABASE_URL", "https://example.supabase.co");
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "test-service-role");
Deno.env.set("OPENROUTER_API_KEY", "test-openrouter");

const { app } = await import("./index.ts");

const BASE = "http://localhost/open-brain-mcp";
const TOOLS_LIST = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} });

function assertEquals(actual: unknown, expected: unknown, label: string): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${label}: expected ${e}, got ${a}`);
}

function post(url: string, headers: Record<string, string> = {}): Request {
  return new Request(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      ...headers,
    },
    body: TOOLS_LIST,
  });
}

async function readMcpBody(r: Response): Promise<any> {
  const text = await r.text();
  if (text.startsWith("{")) return JSON.parse(text);
  const line = text.split("\n").find((l) => l.startsWith("data: "));
  return line ? JSON.parse(line.slice(6)) : null;
}

async function assertUnauthorized(r: Response, label: string): Promise<void> {
  assertEquals(r.status, 401, `${label} status`);
  const challenge = r.headers.get("www-authenticate") ?? "";
  if (!challenge.startsWith("Bearer ")) throw new Error(`${label}: WWW-Authenticate missing (${challenge})`);
  assertEquals(r.headers.get("access-control-allow-origin"), "*", `${label} CORS`);
  assertEquals(
    await r.json(),
    { error: "unauthorized", message: "Invalid or missing x-brain-key" },
    `${label} body`,
  );
}

Deno.test("valid x-brain-key header → 200 with tools list", async () => {
  const r = await app.fetch(post(BASE, { "x-brain-key": KEY }));
  assertEquals(r.status, 200, "status");
  const body = await readMcpBody(r);
  if (!Array.isArray(body?.result?.tools) || body.result.tools.length === 0) {
    throw new Error(`expected a non-empty tools list, got ${JSON.stringify(body)}`);
  }
});

Deno.test("valid ?key= query param → 200", async () => {
  const r = await app.fetch(post(`${BASE}?key=${KEY}`));
  assertEquals(r.status, 200, "status");
  await r.body?.cancel();
});

Deno.test("wrong, wrong-length, and missing keys → 401 + WWW-Authenticate", async () => {
  await assertUnauthorized(await app.fetch(post(BASE, { "x-brain-key": "b".repeat(64) })), "wrong key");
  await assertUnauthorized(await app.fetch(post(BASE, { "x-brain-key": "short" })), "wrong-length key");
  await assertUnauthorized(await app.fetch(post(`${BASE}?key=${"c".repeat(64)}`)), "wrong query key");
  await assertUnauthorized(await app.fetch(post(BASE)), "missing key");
  await assertUnauthorized(await app.fetch(new Request(BASE, { method: "GET" })), "GET without key");
});

Deno.test("CORS preflight needs no key", async () => {
  const r = await app.fetch(new Request(BASE, { method: "OPTIONS" }));
  assertEquals(r.status, 200, "status");
  await r.body?.cancel();
});
