#!/usr/bin/env node
// Smoke test for the ob-graph traversal RPCs.
//
// Run this against a Supabase project that has the ob-graph schema installed
// to confirm both RPCs (traverse_graph + find_shortest_path) return sensible
// shapes and complete inside normal statement_timeout bounds.
//
// Usage:
//   1. Copy .env.example to .env.local (same file, same variables — this
//      script just reads .env.local so your real secrets stay gitignored):
//        SUPABASE_URL               — https://YOUR_PROJECT_REF.supabase.co
//        SUPABASE_SERVICE_ROLE_KEY  — service role key (used server-side only)
//        DEFAULT_USER_ID            — the UUID the graph belongs to
//   2. Seed the graph with at least one edge (create_node + create_edge via the
//      MCP server, or insert directly in the Supabase table editor).
//   3. node recipes/ob-graph/smoke-graph-rpcs.mjs
//
// The script picks one arbitrary edge, then calls traverse_graph at depth 1/2
// and find_shortest_path between the edge endpoints, printing timings and row
// counts. The service_role key never leaves your machine.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function loadEnv() {
  const envPath = path.join(__dirname, ".env.local");
  if (!fs.existsSync(envPath)) {
    console.error(`missing ${envPath} — copy .env.example to .env.local and fill in SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, DEFAULT_USER_ID`);
    process.exit(1);
  }
  const env = {};
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  const required = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "DEFAULT_USER_ID"];
  for (const k of required) {
    if (!env[k]) {
      console.error(`missing ${k} in .env.local`);
      process.exit(1);
    }
  }
  return env;
}

const env = loadEnv();
const base = `${env.SUPABASE_URL.replace(/\/+$/, "")}/rest/v1`;
const userId = env.DEFAULT_USER_ID;
const headers = {
  "apikey": env.SUPABASE_SERVICE_ROLE_KEY,
  "Authorization": `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
  "Content-Type": "application/json",
};

async function timed(label, fn) {
  const t0 = Date.now();
  try {
    const result = await fn();
    console.log(`  ${label}: ${Date.now() - t0}ms — ${result}`);
  } catch (e) {
    console.log(`  ${label}: ${Date.now() - t0}ms — ERROR ${e.message}`);
    process.exitCode = 1;
  }
}

async function rpc(name, body) {
  const res = await fetch(`${base}/rpc/${name}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${res.status} ${text.slice(0, 200)}`);
  return JSON.parse(text);
}

// Pick an arbitrary edge to use as the probe pair.
const edgeRes = await fetch(
  `${base}/graph_edges?select=source_node_id,target_node_id&user_id=eq.${userId}&limit=1`,
  { headers },
);
const edges = await edgeRes.json();
if (!Array.isArray(edges) || edges.length === 0) {
  console.error("no edges found for this user — seed the graph (create_node + create_edge) before running the smoke test");
  process.exit(1);
}
const startId = edges[0].source_node_id;
const endId = edges[0].target_node_id;
console.log(`smoke: user=${userId} start=${startId} end=${endId}`);

console.log("traverse_graph:");
await timed("depth=1", async () => {
  const rows = await rpc("traverse_graph", {
    p_user_id: userId,
    p_start_node_id: startId,
    p_max_depth: 1,
    p_relationship_type: null,
  });
  return `rows=${rows.length}`;
});
await timed("depth=2", async () => {
  const rows = await rpc("traverse_graph", {
    p_user_id: userId,
    p_start_node_id: startId,
    p_max_depth: 2,
    p_relationship_type: null,
  });
  return `rows=${rows.length}`;
});

console.log("find_shortest_path:");
await timed("direct neighbor", async () => {
  const rows = await rpc("find_shortest_path", {
    p_user_id: userId,
    p_start_node_id: startId,
    p_end_node_id: endId,
    p_max_depth: 6,
  });
  return `hops=${rows.length ? rows.length - 1 : "no_path"}`;
});

// Random distant pair: use the newest node as an "unlikely to be directly
// connected" endpoint. With the seen-set fix this should still complete fast
// even if the two nodes are actually unreachable within max_depth.
const farRes = await fetch(
  `${base}/graph_nodes?select=id&user_id=eq.${userId}&order=created_at.desc&limit=1`,
  { headers },
);
const farBody = await farRes.json();
const farId = farBody[0]?.id;
if (farId && farId !== startId) {
  await timed(`random pair (${startId}→${farId})`, async () => {
    const rows = await rpc("find_shortest_path", {
      p_user_id: userId,
      p_start_node_id: startId,
      p_end_node_id: farId,
      p_max_depth: 6,
    });
    return `hops=${rows.length ? rows.length - 1 : "no_path"}`;
  });
}

// ---------------------------------------------------------------------------
// Scenario tests — seed + assert + clean up. These catch regressions in
// traverse_graph semantics (multi-path enumeration, parallel relationship
// types) and in BFS cycle-safety. Each scenario namespaces its nodes by
// label prefix so reruns are idempotent and a failed run is easy to clean up
// manually from the Supabase Table Editor (filter by label LIKE 'smoke:%').
// ---------------------------------------------------------------------------

async function tableInsert(table, rows) {
  const res = await fetch(`${base}/${table}`, {
    method: "POST",
    headers: { ...headers, "Prefer": "return=representation" },
    body: JSON.stringify(rows),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${res.status} ${text.slice(0, 200)}`);
  return JSON.parse(text);
}

async function tableDelete(table, filter) {
  const res = await fetch(`${base}/${table}?${filter}`, {
    method: "DELETE",
    headers,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${res.status} ${text.slice(0, 200)}`);
  }
}

async function cleanupScenario(tag) {
  // graph_edges has ON DELETE CASCADE from graph_nodes, so deleting the
  // tagged nodes is enough to also drop their edges.
  await tableDelete(
    "graph_nodes",
    `user_id=eq.${userId}&label=like.smoke:${tag}:%`,
  );
}

function assert(cond, msg) {
  if (!cond) {
    console.log(`    FAIL: ${msg}`);
    process.exitCode = 1;
  } else {
    console.log(`    ok: ${msg}`);
  }
}

// Scenario 1 — multi-path DAG. A → B → D and A → C → D. traverse_graph
// should return D twice (once via B, once via C). Also A→B has two parallel
// edges with different relationship_types, so B should appear twice at depth 1.
async function scenarioMultiPath() {
  const tag = "multipath";
  await cleanupScenario(tag);
  console.log(`scenario: multi-path DAG (tag=smoke:${tag}:*)`);
  try {
    const [a, b, c, d] = await tableInsert("graph_nodes", [
      { user_id: userId, label: `smoke:${tag}:A`, node_type: "concept" },
      { user_id: userId, label: `smoke:${tag}:B`, node_type: "concept" },
      { user_id: userId, label: `smoke:${tag}:C`, node_type: "concept" },
      { user_id: userId, label: `smoke:${tag}:D`, node_type: "concept" },
    ]);
    await tableInsert("graph_edges", [
      { user_id: userId, source_node_id: a.id, target_node_id: b.id, relationship_type: "knows" },
      { user_id: userId, source_node_id: a.id, target_node_id: b.id, relationship_type: "likes" },
      { user_id: userId, source_node_id: a.id, target_node_id: c.id, relationship_type: "knows" },
      { user_id: userId, source_node_id: b.id, target_node_id: d.id, relationship_type: "knows" },
      { user_id: userId, source_node_id: c.id, target_node_id: d.id, relationship_type: "knows" },
    ]);

    const rows = await rpc("traverse_graph", {
      p_user_id: userId,
      p_start_node_id: a.id,
      p_max_depth: 2,
      p_relationship_type: null,
    });

    const bRows = rows.filter((r) => r.node_id === b.id);
    const dRows = rows.filter((r) => r.node_id === d.id);
    // A→B via knows and A→B via likes should both appear at depth 1.
    assert(bRows.length === 2, `B reached twice at depth 1 via parallel edges (got ${bRows.length})`);
    // Each of the 2 B-rows joins the single B→D edge (2 D-rows via B), plus 1 D-row via C.
    assert(dRows.length === 3,
      `D reached 3 times (2 via B parallel edges → D, 1 via C → D) — got ${dRows.length}`);
    assert(dRows.every((r) => r.depth === 2), `both D rows at depth 2 (got depths ${dRows.map((r) => r.depth).join(",")})`);
  } finally {
    await cleanupScenario(tag);
  }
}

// Scenario 2 — cycle. A → B → C → A. find_shortest_path must terminate and
// not loop; traverse_graph must also terminate (per-path cycle check).
async function scenarioCycle() {
  const tag = "cycle";
  await cleanupScenario(tag);
  console.log(`scenario: cycle A→B→C→A (tag=smoke:${tag}:*)`);
  try {
    const [a, b, c] = await tableInsert("graph_nodes", [
      { user_id: userId, label: `smoke:${tag}:A`, node_type: "concept" },
      { user_id: userId, label: `smoke:${tag}:B`, node_type: "concept" },
      { user_id: userId, label: `smoke:${tag}:C`, node_type: "concept" },
    ]);
    await tableInsert("graph_edges", [
      { user_id: userId, source_node_id: a.id, target_node_id: b.id, relationship_type: "knows" },
      { user_id: userId, source_node_id: b.id, target_node_id: c.id, relationship_type: "knows" },
      { user_id: userId, source_node_id: c.id, target_node_id: a.id, relationship_type: "knows" },
    ]);

    const t0 = Date.now();
    const traverseRows = await rpc("traverse_graph", {
      p_user_id: userId,
      p_start_node_id: a.id,
      p_max_depth: 5,
      p_relationship_type: null,
    });
    const traverseMs = Date.now() - t0;
    assert(traverseMs < 2000, `traverse_graph on cycle terminated quickly (${traverseMs}ms)`);
    assert(traverseRows.length > 0, `traverse_graph on cycle returned rows (${traverseRows.length})`);

    const t1 = Date.now();
    const pathRows = await rpc("find_shortest_path", {
      p_user_id: userId,
      p_start_node_id: a.id,
      p_end_node_id: c.id,
      p_max_depth: 6,
    });
    const pathMs = Date.now() - t1;
    assert(pathMs < 2000, `find_shortest_path on cycle terminated quickly (${pathMs}ms)`);
    // find_shortest_path is bidirectional (traverses edges regardless of
    // direction). With the reverse edge C→A present, A reaches C in 1 hop, so
    // the correct result is exactly 2 rows (start + target). Assert the exact
    // length — a regression back to the 3-row A→B→C path would pass `>= 2`
    // and silently erode the bidirectional-shortest-path guarantee.
    assert(
      Array.isArray(pathRows) && pathRows.length === 2,
      `bidirectional shortest path returns exactly 2 rows (A,C via C→A reverse) — got ${pathRows?.length}`,
    );
    const firstId = pathRows[0]?.node_id ?? pathRows[0]?.id;
    const lastId = pathRows[pathRows.length - 1]?.node_id ?? pathRows[pathRows.length - 1]?.id;
    assert(firstId === a.id, `path starts at A (${a.id}) — got ${firstId}`);
    assert(lastId === c.id, `path ends at C (${c.id}) — got ${lastId}`);
  } finally {
    await cleanupScenario(tag);
  }
}

console.log("");
await scenarioMultiPath();
console.log("");
await scenarioCycle();
