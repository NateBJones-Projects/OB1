import { test } from "node:test";
import assert from "node:assert/strict";
import {
  fetchClassifiedPairKeys,
  pairKey,
  sampleCandidatePairs,
  selectUnclassifiedPairs,
} from "../classify-edges.mjs";

const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

// A stub PostgREST: thought_entities rows and thought_edges rows, every GET recorded.
function stubSb({ entities = [], edges = [], fail = null } = {}) {
  const calls = [];
  return {
    calls,
    async get(path) {
      calls.push(path);
      if (fail) throw new Error(fail);
      if (path.startsWith("thought_entities?")) return entities;
      if (path.startsWith("thought_edges?")) {
        assert.match(path, /relation=neq\.related_to/, "the query must exclude related_to server-side");
        const m = path.match(/from_thought_id\.in\.\(([^)]*)\)/);
        const ids = new Set(m[1].split(","));
        return edges
          .filter((e) => e.relation !== "related_to")
          .filter((e) => ids.has(e.from_thought_id) || ids.has(e.to_thought_id))
          .map(({ from_thought_id, to_thought_id }) => ({ from_thought_id, to_thought_id }));
      }
      throw new Error(`unexpected GET ${path}`);
    },
  };
}

function withLog(fn) {
  const lines = [];
  const orig = console.log;
  console.log = (...a) => lines.push(a.join(" "));
  return fn().finally(() => { console.log = orig; }).then((v) => ({ v, lines }));
}

// T1={a,b,c} T2={a,b,c} T3={a,b} T4={d,e} T5={d,e}
// pairs with support >= 2, ranked: (T1,T2)=3, then (T1,T3)=2, (T2,T3)=2, (T4,T5)=2
const T = [1, 2, 3, 4, 5].map(id);
const entities = [
  ...["a", "b", "c"].map((e) => ({ thought_id: T[0], entity_id: e })),
  ...["a", "b", "c"].map((e) => ({ thought_id: T[1], entity_id: e })),
  ...["a", "b"].map((e) => ({ thought_id: T[2], entity_id: e })),
  ...["d", "e"].map((e) => ({ thought_id: T[3], entity_id: e })),
  ...["d", "e"].map((e) => ({ thought_id: T[4], entity_id: e })),
];
const key = (i, j) => pairKey(T[i], T[j]);

test("pairKey is symmetric", () => {
  assert.equal(pairKey("b", "a"), pairKey("a", "b"));
});

test("no edges: the top `limit` pairs by support, each marked alreadyChecked", async () => {
  const sb = stubSb({ entities });
  const { v } = await withLog(() => sampleCandidatePairs(sb, 2, 2));
  assert.deepEqual(v.map((p) => pairKey(p.from_thought_id, p.to_thought_id)), [key(0, 1), key(0, 2)]);
  assert.ok(v.every((p) => p.alreadyChecked === true));
});

test("classified pairs are excluded BEFORE the limit applies, in either direction", async () => {
  const edges = [
    { from_thought_id: T[0], to_thought_id: T[1], relation: "supersedes" },
    { from_thought_id: T[2], to_thought_id: T[0], relation: "supports" }, // reverse of (T1,T3)
  ];
  const sb = stubSb({ entities, edges });
  const { v, lines } = await withLog(() => sampleCandidatePairs(sb, 2, 2));
  assert.deepEqual(v.map((p) => pairKey(p.from_thought_id, p.to_thought_id)), [key(1, 2), key(3, 4)]);
  assert.match(lines.at(-1), /4 candidate pairs ranked, 4 checked, 2 already classified, 2 selected \(limit 2\)/);
});

test("a related_to edge does not exclude a pair", async () => {
  const edges = [{ from_thought_id: T[0], to_thought_id: T[1], relation: "related_to" }];
  const sb = stubSb({ entities, edges });
  const { v } = await withLog(() => sampleCandidatePairs(sb, 2, 1));
  assert.equal(pairKey(v[0].from_thought_id, v[0].to_thought_id), key(0, 1));
});

test("everything classified: nothing selected, the log says so", async () => {
  const edges = [
    { from_thought_id: T[0], to_thought_id: T[1], relation: "supersedes" },
    { from_thought_id: T[0], to_thought_id: T[2], relation: "supports" },
    { from_thought_id: T[1], to_thought_id: T[2], relation: "contradicts" },
    { from_thought_id: T[3], to_thought_id: T[4], relation: "evolved_into" },
  ];
  const sb = stubSb({ entities, edges });
  const { v, lines } = await withLog(() => sampleCandidatePairs(sb, 2, 50));
  assert.deepEqual(v, []);
  assert.match(lines.at(-1), /4 already classified, 0 selected/);
});

test("selection stops checking once the limit is filled", async () => {
  const ranked = Array.from({ length: 250 }, (_, i) => ({
    from_thought_id: id(1000 + 2 * i), to_thought_id: id(1001 + 2 * i), support: 2,
  }));
  const sb = stubSb();
  const { v } = await withLog(() => selectUnclassifiedPairs(sb, ranked, 3, 100));
  assert.equal(v.length, 3);
  // one batch of 100 pairs = 200 ids = 4 chunks of 60; the second batch is never queried
  assert.equal(sb.calls.filter((c) => c.startsWith("thought_edges?")).length, 4);
});

test("fetchClassifiedPairKeys chunks thought ids and covers both sides", async () => {
  const pairs = Array.from({ length: 65 }, (_, i) => ({ from_thought_id: id(2000 + 2 * i), to_thought_id: id(2001 + 2 * i) }));
  const edges = [{ from_thought_id: id(2129), to_thought_id: id(2128), relation: "supports" }]; // last pair, reversed
  const sb = stubSb({ edges });
  const keys = await fetchClassifiedPairKeys(sb, pairs);
  assert.equal(sb.calls.length, 3); // 130 ids / 60 per chunk
  assert.ok(keys.has(pairKey(id(2128), id(2129))));
});

test("a missing thought_edges table is a clear error", async () => {
  const sb = stubSb({ fail: "GET thought_edges?...: 404 relation does not exist" });
  await assert.rejects(
    () => fetchClassifiedPairKeys(sb, [{ from_thought_id: id(1), to_thought_id: id(2) }]),
    /requires thought_edges/,
  );
});
