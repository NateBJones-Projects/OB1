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
