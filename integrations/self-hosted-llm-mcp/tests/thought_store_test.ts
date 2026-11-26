import { assert, assertEquals, assertMatch } from "jsr:@std/assert@^1";
import { FakeFetch, type RecordedRequest } from "./helpers/fake_fetch.ts";
import { createSupabaseThoughtStore } from "../lib/thought_store.ts";

const BASE = "http://db.test";
const REST = `${BASE}/rest/v1`;

function setup() {
  const ff = new FakeFetch();
  const store = createSupabaseThoughtStore(BASE, "service-key", ff.fetch);
  return { ff, store };
}

function params(req: RecordedRequest): URLSearchParams {
  return new URL(req.url).searchParams;
}

const ROW = {
  id: "t-1",
  content: "hello",
  metadata: { type: "idea" },
  created_at: "2026-01-01T00:00:00.123456+00:00",
  updated_at: "2026-01-02T00:00:00+00:00",
};

Deno.test("U68 fetchThought requests core's columns for id=eq.<id> as a single object", async () => {
  const { ff, store } = setup();
  ff.on("GET", `${REST}/thoughts`, { body: ROW });
  await store.fetchThought("t-1");
  assertEquals(ff.requests.length, 1);
  const req = ff.requests[0];
  assertEquals(req.method, "GET");
  assertEquals(new URL(req.url).pathname, "/rest/v1/thoughts");
  assertEquals(params(req).get("select"), "id,content,metadata,created_at,updated_at");
  assertEquals(params(req).get("id"), "eq.t-1");
  assertMatch(req.headers["accept"], /application\/vnd\.pgrst\.object\+json/);
});
