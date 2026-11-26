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

/** The filter parameters of a request, leaving out `select` (how supabase-js spells "all columns" on a count). */
function filterParams(req: RecordedRequest): [string, string][] {
  return listParams(req).filter(([k]) => k !== "select");
}

/** The JSON object a "metadata contains" filter carries, without the operator syntax in front of it. */
function containsPayload(value: string): unknown {
  return JSON.parse(value.slice(value.indexOf("{")));
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
  assertEquals(params(ff.requests[0]).getAll("metadata").map(containsPayload), [{ type: "idea" }]);
  assertEquals(params(ff.requests[1]).has("metadata"), false);
});

Deno.test("U76 listThoughts adds a metadata contains {topics: [topic]} filter only when topic is given", async () => {
  const { ff, store } = setup();
  ff.on("GET", `${REST}/thoughts`, { body: [] });
  await store.listThoughts({ limit: 5, topic: "work" });
  await store.listThoughts({ limit: 5 });
  assertEquals(params(ff.requests[0]).getAll("metadata").map(containsPayload), [{ topics: ["work"] }]);
  assertEquals(params(ff.requests[1]).has("metadata"), false);
});

Deno.test("U77 listThoughts adds a metadata contains {people: [person]} filter only when person is given", async () => {
  const { ff, store } = setup();
  ff.on("GET", `${REST}/thoughts`, { body: [] });
  await store.listThoughts({ limit: 5, person: "Ada" });
  await store.listThoughts({ limit: 5 });
  assertEquals(params(ff.requests[0]).getAll("metadata").map(containsPayload), [{ people: ["Ada"] }]);
  assertEquals(params(ff.requests[1]).has("metadata"), false);
});

Deno.test("U78 listThoughts adds created_at=gte.<now - days> (to within the call's own duration) only when days is given", async () => {
  const DAY = 24 * 3600 * 1000;
  const { ff, store } = setup();
  ff.on("GET", `${REST}/thoughts`, { body: [] });
  const windows: { days: number; before: number; after: number }[] = [];
  for (const days of [1, 7, 90]) {
    const before = Date.now();
    await store.listThoughts({ limit: 5, days });
    windows.push({ days, before, after: Date.now() });
  }
  await store.listThoughts({ limit: 5 });
  windows.forEach(({ days, before, after }, i) => {
    const gte = params(ff.requests[i]).getAll("created_at");
    assertEquals(gte.length, 1, `days ${days}`);
    assertMatch(gte[0], /^gte\./);
    const since = new Date(gte[0].slice(4)).getTime();
    // The core subtracts calendar days in local time, so the cutoff moves by the local UTC-offset change
    // (an hour across a DST change) and by nothing else.
    const dst = (new Date(before - days * DAY).getTimezoneOffset() - new Date(before).getTimezoneOffset()) * 60000;
    assert(
      since >= before - days * DAY + dst && since <= after - days * DAY + dst,
      `days ${days}: cutoff ${gte[0]} is outside [${before - days * DAY + dst}, ${after - days * DAY + dst}]`,
    );
  });
  assertEquals(params(ff.requests[3]).has("created_at"), false);
});

Deno.test("U79 listThoughts returns the rows, or { error } for a database error", async () => {
  const { ff, store } = setup();
  const rows = [{ content: "hello", metadata: { type: "idea" }, created_at: "2026-01-01T00:00:00+00:00" }];
  ff.on(
    "GET",
    `${REST}/thoughts`,
    { body: rows },
    { status: 500, body: { code: "XX000", details: null, hint: null, message: "list failed" } },
  );
  assertEquals(await store.listThoughts({ limit: 5 }), { data: rows });
  assertEquals(await store.listThoughts({ limit: 5 }), { error: "list failed" });
});

Deno.test("U80 stats sends core's two thought_stats queries (exact count head; metadata and created_at rows)", async () => {
  const { ff, store } = setup();
  ff.on("HEAD", `${REST}/thoughts`, { headers: { "content-range": "*/3" } });
  ff.on("GET", `${REST}/thoughts`, { body: [] });
  await store.stats();
  assertEquals(ff.requests.length, 2);
  const head = ff.requests.find((r) => r.method === "HEAD")!;
  const rows = ff.requests.find((r) => r.method === "GET")!;
  assertEquals(new URL(head.url).pathname, "/rest/v1/thoughts");
  assertEquals(filterParams(head), []);
  assertEquals(new URL(rows.url).pathname, "/rest/v1/thoughts");
  assertEquals(listParams(rows).sort(), [
    ["order", "created_at.desc"],
    ["select", "metadata,created_at"],
  ]);
});

Deno.test("U81 stats returns the count and the rows", async () => {
  const { ff, store } = setup();
  const rows = [
    { metadata: { type: "idea" }, created_at: "2026-01-02T00:00:00+00:00" },
    { metadata: {}, created_at: "2026-01-01T00:00:00+00:00" },
  ];
  ff.on("HEAD", `${REST}/thoughts`, { headers: { "content-range": "*/2" } });
  ff.on("GET", `${REST}/thoughts`, { body: rows });
  assertEquals(await store.stats(), { data: { count: 2, rows } });
});

Deno.test("U82 stats returns { error } when either query fails", async () => {
  const err = (message: string) => ({ status: 500, body: { code: "XX000", details: null, hint: null, message } });
  {
    const { ff, store } = setup();
    ff.on("HEAD", `${REST}/thoughts`, { status: 500 });
    ff.on("GET", `${REST}/thoughts`, { body: [] });
    const r = await store.stats();
    // Deliberate pin: a body-less HEAD 500 gives supabase-js an empty message, observed once.
    assertEquals(r, { error: "" });
    assert(!("data" in r), "a count failure carries no data");
  }
  {
    const { ff, store } = setup();
    ff.on("HEAD", `${REST}/thoughts`, { headers: { "content-range": "*/2" } });
    ff.on("GET", `${REST}/thoughts`, err("rows failed"));
    assertEquals(await store.stats(), { error: "rows failed" });
  }
});

Deno.test("U83 upsertThought calls RPC upsert_thought with p_content and p_payload: { metadata }", async () => {
  const { ff, store } = setup();
  ff.on("POST", `${REST}/rpc/upsert_thought`, { body: { id: "t-9", fingerprint: "f" } });
  await store.upsertThought("some content", { type: "idea", source: "mcp" });
  assertEquals(ff.requests.length, 1);
  assertEquals(ff.requests[0].method, "POST");
  assertEquals(ff.requests[0].body, {
    p_content: "some content",
    p_payload: { metadata: { type: "idea", source: "mcp" } },
  });
});

Deno.test("U84 upsertThought returns { id } from the reply, or { error } for an RPC error", async () => {
  const { ff, store } = setup();
  ff.on(
    "POST",
    `${REST}/rpc/upsert_thought`,
    { body: { id: "t-9", fingerprint: "f" } },
    { status: 400, body: { code: "P0001", details: null, hint: null, message: "upsert refused" } },
  );
  assertEquals(await store.upsertThought("c", {}), { data: { id: "t-9" } });
  assertEquals(await store.upsertThought("c", {}), { error: "upsert refused" });
});

Deno.test("U85 setEmbedding updates embedding on id=eq.<id>", async () => {
  const { ff, store } = setup();
  ff.on("PATCH", `${REST}/thoughts`, { status: 204 });
  await store.setEmbedding("t-9", [0.5, 0.25]);
  assertEquals(ff.requests.length, 1);
  const req = ff.requests[0];
  assertEquals(req.method, "PATCH");
  assertEquals(new URL(req.url).pathname, "/rest/v1/thoughts");
  assertEquals(listParams(req), [["id", "eq.t-9"]]);
  assertEquals(req.body, { embedding: [0.5, 0.25] });
});

Deno.test("U86 setEmbedding returns { error } for a database error", async () => {
  const { ff, store } = setup();
  ff.on("PATCH", `${REST}/thoughts`, {
    status: 500,
    body: { code: "XX000", details: null, hint: null, message: "update failed" },
  });
  assertEquals(await store.setEmbedding("t-9", [1]), { error: "update failed" });
});

Deno.test("U87 readBack requests created_at, updated_at and whether embedding is null for one id", async () => {
  const { ff, store } = setup();
  ff.on("GET", `${REST}/thoughts`, { body: { created_at: "T", updated_at: "T", embedding: null } });
  await store.readBack("t-9");
  assertEquals(ff.requests.length, 1);
  const req = ff.requests[0];
  assertEquals(req.method, "GET");
  assertEquals(new URL(req.url).pathname, "/rest/v1/thoughts");
  assertEquals(params(req).get("id"), "eq.t-9");
  assertEquals(params(req).get("select")?.split(",").sort(), ["created_at", "embedding", "updated_at"]);
});

Deno.test("U88 readBack reports embeddingIsNull true for a null embedding and false for a set one", async () => {
  const { ff, store } = setup();
  ff.on(
    "GET",
    `${REST}/thoughts`,
    { body: { created_at: "T", updated_at: "T", embedding: null } },
    { body: { created_at: "T", updated_at: "T", embedding: "[0.1,0.2,0.3]" } },
  );
  const nullCase = await store.readBack("t-9");
  assert("data" in nullCase && nullCase.data.embeddingIsNull === true);
  const setCase = await store.readBack("t-9");
  assert("data" in setCase && setCase.data.embeddingIsNull === false);
});

Deno.test("U89 readBack returns both timestamps as the exact strings received, equal or differing", async () => {
  const { ff, store } = setup();
  const t1 = "2026-03-04T05:06:07.123456+00:00";
  const t2 = "2026-03-04T05:06:07.1234+00:00";
  const t3 = "2026-03-04T05:06:09.987654+00:00";
  ff.on(
    "GET",
    `${REST}/thoughts`,
    { body: { created_at: t1, updated_at: t1, embedding: null } },
    { body: { created_at: t2, updated_at: t3, embedding: null } },
  );
  const equal = await store.readBack("t-9");
  assert("data" in equal);
  assertEquals([equal.data.createdAt, equal.data.updatedAt], [t1, t1]);
  const differing = await store.readBack("t-9");
  assert("data" in differing);
  assertEquals([differing.data.createdAt, differing.data.updatedAt], [t2, t3]);
});

Deno.test("U90 readBack returns { error } for a missing row or a database error", async () => {
  const { ff, store } = setup();
  ff.on(
    "GET",
    `${REST}/thoughts`,
    { status: 406, body: { code: "PGRST116", details: "The result contains 0 rows", hint: null, message: "JSON object requested, multiple (or no) rows returned" } },
    { status: 500, body: { code: "XX000", details: null, hint: null, message: "read failed" } },
  );
  assertEquals(await store.readBack("gone"), { error: "JSON object requested, multiple (or no) rows returned" });
  assertEquals(await store.readBack("t-9"), { error: "read failed" });
});

const T = "2026-03-04T05:06:07.123456+00:00";

Deno.test("U91 deleteIfInsertedByCall(id, T) deletes filtered by id, embedding is null, created_at=eq.T and updated_at=eq.T, with T verbatim", async () => {
  const { ff, store } = setup();
  ff.on("DELETE", `${REST}/thoughts`, { body: [{ id: "t-9" }] });
  await store.deleteIfInsertedByCall("t-9", T);
  assertEquals(ff.requests.length, 1);
  const req = ff.requests[0];
  assertEquals(req.method, "DELETE");
  assertEquals(new URL(req.url).pathname, "/rest/v1/thoughts");
  assertEquals(params(req).get("id"), "eq.t-9");
  assertEquals(params(req).get("embedding"), "is.null");
  assertEquals(params(req).getAll("created_at"), [`eq.${T}`]);
  assertEquals(params(req).getAll("updated_at"), [`eq.${T}`]);
});

Deno.test("U92 deleteIfInsertedByCall reports deleted: true when a row was deleted", async () => {
  const { ff, store } = setup();
  ff.on("DELETE", `${REST}/thoughts`, { body: [{ id: "t-9" }] });
  assertEquals(await store.deleteIfInsertedByCall("t-9", T), { data: { deleted: true } });
});

Deno.test("U93 deleteIfInsertedByCall reports deleted: false with no error when no row matched", async () => {
  const { ff, store } = setup();
  ff.on("DELETE", `${REST}/thoughts`, { body: [] });
  assertEquals(await store.deleteIfInsertedByCall("t-9", T), { data: { deleted: false } });
});

Deno.test("U94 deleteIfInsertedByCall returns { error } for a database error", async () => {
  const { ff, store } = setup();
  ff.on("DELETE", `${REST}/thoughts`, {
    status: 500,
    body: { code: "XX000", details: null, hint: null, message: "delete failed" },
  });
  assertEquals(await store.deleteIfInsertedByCall("t-9", T), { error: "delete failed" });
});

Deno.test("U95 countAll requests an exact head count of thoughts and returns the total", async () => {
  const { ff, store } = setup();
  ff.on("HEAD", `${REST}/thoughts`, { headers: { "content-range": "*/42" } });
  assertEquals(await store.countAll(), { data: 42 });
  assertEquals(ff.requests.length, 1);
  const req = ff.requests[0];
  assertEquals(req.method, "HEAD");
  assertEquals(new URL(req.url).pathname, "/rest/v1/thoughts");
  assertEquals(filterParams(req), []);
});

Deno.test("U96 countWithModel(m) adds metadata->>embedding_model=eq.m to the same count", async () => {
  const { ff, store } = setup();
  ff.on("HEAD", `${REST}/thoughts`, { headers: { "content-range": "*/5" } });
  assertEquals(await store.countWithModel("nomic"), { data: 5 });
  assertEquals(ff.requests.length, 1);
  const req = ff.requests[0];
  assertEquals(req.method, "HEAD");
  assertEquals(new URL(req.url).pathname, "/rest/v1/thoughts");
  assertEquals(filterParams(req), [["metadata->>embedding_model", "eq.nomic"]]);
});

Deno.test("U97 model names reach the request intact (qwen3-embedding:4b, openai/text-embedding-3-small, v1.5, a,b)", async () => {
  const { ff, store } = setup();
  ff.on("HEAD", `${REST}/thoughts`, { headers: { "content-range": "*/1" } });
  const names = ["qwen3-embedding:4b", "openai/text-embedding-3-small", "v1.5", "a,b"];
  for (const name of names) await store.countWithModel(name);
  assertEquals(ff.requests.length, names.length);
  names.forEach((name, i) => {
    assertEquals(params(ff.requests[i]).getAll("metadata->>embedding_model"), [`eq.${name}`]);
  });
});

Deno.test("U98 both counts return { error } for a database error", async () => {
  const { ff, store } = setup();
  ff.on("HEAD", `${REST}/thoughts`, { status: 500 });
  // Deliberate pin: a body-less HEAD 500 gives supabase-js an empty message, observed once.
  const all = await store.countAll();
  assertEquals(all, { error: "" });
  assert(!("data" in all), "countAll must not carry data on failure");
  const withModel = await store.countWithModel("m");
  assertEquals(withModel, { error: "" });
  assert(!("data" in withModel), "countWithModel must not carry data on failure");
});

Deno.test("U99 both counts return 0 for an empty table", async () => {
  const { ff, store } = setup();
  ff.on("HEAD", `${REST}/thoughts`, { headers: { "content-range": "*/0" } });
  assertEquals(await store.countAll(), { data: 0 });
  assertEquals(await store.countWithModel("m"), { data: 0 });
});
