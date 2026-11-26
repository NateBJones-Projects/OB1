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
