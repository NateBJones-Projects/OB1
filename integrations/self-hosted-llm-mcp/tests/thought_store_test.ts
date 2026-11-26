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

Deno.test("U69 fetchThought returns the row for a 200", async () => {
  const { ff, store } = setup();
  ff.on("GET", `${REST}/thoughts`, { body: ROW });
  assertEquals(await store.fetchThought("t-1"), { data: ROW });
});

Deno.test("U70 fetchThought returns { error } with PostgREST's message for a missing row or a database error", async () => {
  const { ff, store } = setup();
  ff.on(
    "GET",
    `${REST}/thoughts`,
    { status: 406, body: { code: "PGRST116", details: "The result contains 0 rows", hint: null, message: "JSON object requested, multiple (or no) rows returned" } },
    { status: 500, body: { code: "XX000", details: null, hint: null, message: "database exploded" } },
  );
  assertEquals(await store.fetchThought("nope"), { error: "JSON object requested, multiple (or no) rows returned" });
  assertEquals(await store.fetchThought("t-1"), { error: "database exploded" });
});

Deno.test("U71 matchThoughts calls RPC match_thoughts with query_embedding, match_threshold, match_count and filter {}", async () => {
  const { ff, store } = setup();
  ff.on("POST", `${REST}/rpc/match_thoughts`, { body: [] });
  await store.matchThoughts([0.1, 0.2, 0.3], 0.42, 7);
  assertEquals(ff.requests.length, 1);
  assertEquals(ff.requests[0].method, "POST");
  assertEquals(ff.requests[0].body, {
    query_embedding: [0.1, 0.2, 0.3],
    match_threshold: 0.42,
    match_count: 7,
    filter: {},
  });
});

Deno.test("U72 matchThoughts returns the rows, and [] for none", async () => {
  const { ff, store } = setup();
  const rows = [
    { id: "a", content: "one", metadata: { type: "idea" }, similarity: 0.91, created_at: "2026-01-01T00:00:00+00:00" },
    { id: "b", content: "two", metadata: {}, similarity: 0.55, created_at: "2026-01-02T00:00:00+00:00" },
  ];
  ff.on("POST", `${REST}/rpc/match_thoughts`, { body: rows }, { body: [] });
  assertEquals(await store.matchThoughts([1], 0.5, 10), { data: rows });
  assertEquals(await store.matchThoughts([1], 0.5, 10), { data: [] });
});

Deno.test("U73 matchThoughts returns { error } for an RPC error", async () => {
  const { ff, store } = setup();
  ff.on("POST", `${REST}/rpc/match_thoughts`, {
    status: 400,
    body: { code: "22000", details: null, hint: null, message: "expected 1536 dimensions, not 3" },
  });
  assertEquals(await store.matchThoughts([1, 2, 3], 0.5, 10), { error: "expected 1536 dimensions, not 3" });
});

function listParams(req: RecordedRequest): [string, string][] {
  return [...params(req).entries()];
}

Deno.test("U74 listThoughts with no filters requests core's columns ordered created_at.desc with the limit and no other filter", async () => {
  const { ff, store } = setup();
  ff.on("GET", `${REST}/thoughts`, { body: [] });
  await store.listThoughts({ limit: 15 });
  const req = ff.requests[0];
  assertEquals(req.method, "GET");
  assertEquals(new URL(req.url).pathname, "/rest/v1/thoughts");
  assertEquals(listParams(req).sort(), [
    ["limit", "15"],
    ["order", "created_at.desc"],
    ["select", "content,metadata,created_at"],
  ]);
});

Deno.test("U75 listThoughts adds a metadata contains {type} filter only when type is given", async () => {
  const { ff, store } = setup();
  ff.on("GET", `${REST}/thoughts`, { body: [] });
  await store.listThoughts({ limit: 5, type: "idea" });
  await store.listThoughts({ limit: 5 });
  assertEquals(params(ff.requests[0]).getAll("metadata"), ['cs.{"type":"idea"}']);
  assertEquals(params(ff.requests[1]).has("metadata"), false);
});

Deno.test("U76 listThoughts adds a metadata contains {topics: [topic]} filter only when topic is given", async () => {
  const { ff, store } = setup();
  ff.on("GET", `${REST}/thoughts`, { body: [] });
  await store.listThoughts({ limit: 5, topic: "work" });
  await store.listThoughts({ limit: 5 });
  assertEquals(params(ff.requests[0]).getAll("metadata"), ['cs.{"topics":["work"]}']);
  assertEquals(params(ff.requests[1]).has("metadata"), false);
});

Deno.test("U77 listThoughts adds a metadata contains {people: [person]} filter only when person is given", async () => {
  const { ff, store } = setup();
  ff.on("GET", `${REST}/thoughts`, { body: [] });
  await store.listThoughts({ limit: 5, person: "Ada" });
  await store.listThoughts({ limit: 5 });
  assertEquals(params(ff.requests[0]).getAll("metadata"), ['cs.{"people":["Ada"]}']);
  assertEquals(params(ff.requests[1]).has("metadata"), false);
});
