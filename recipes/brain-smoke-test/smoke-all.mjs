#!/usr/bin/env node
/**
 * smoke-all.mjs -- Full-surface smoke test for an Open Brain install.
 *
 * ~30 independent checks across seven categories: MCP endpoint, REST API
 * gateway, database schema, access-key (MCP), core capture/search features,
 * PostgREST access-key enforcement, and row-level security. Verifies that
 * a freshly-built Open Brain is wired correctly.
 *
 * Stock Open Brain (docs/01-getting-started.md) needs only the canonical
 * thoughts table, open-brain-mcp Edge Function, and MCP_ACCESS_KEY. Optional
 * tables and endpoints (graph_nodes/graph_edges from ob-graph, REST API,
 * enhanced-thoughts search_thoughts_text RPC, smart-ingest ingestion_jobs)
 * are detected and reported as SKIP when not present -- they do not fail
 * the run.
 *
 * Usage:
 *   node smoke-all.mjs                       # pretty-print dashboard (read-only)
 *   node smoke-all.mjs --json                # machine-readable JSON
 *   node smoke-all.mjs --destructive         # also run Core Features (writes + LLM calls)
 *   node smoke-all.mjs --category=DB\ Schema # run only one category
 *   node smoke-all.mjs --help                # show this usage
 *
 * By default, Core Features is SKIPPED because it inserts rows via the
 * service-role key and triggers embedding/LLM metadata generation. Pass
 * --destructive (alias: --write) when you want to exercise those paths.
 *
 * Required env (in .env.local next to the script, or exported):
 *   SUPABASE_URL               https://<ref>.supabase.co
 *   SUPABASE_SERVICE_ROLE_KEY  service-role secret key
 *   MCP_ACCESS_KEY             the key you set via `supabase secrets set`
 *
 * Optional env (unlock extra checks):
 *   REST_API_BASE              e.g. https://<ref>.supabase.co/functions/v1/open-brain-rest
 *   NEXT_PUBLIC_API_URL        open-brain-rest base URL used by the dashboard
 *   SUPABASE_ANON_KEY          anon/publishable key; enables a real RLS probe
 *
 * Exit codes:
 *   0  all pass, or all pass-or-skip
 *   1  at least one check failed
 *   2  setup error (missing required env var, unknown --category, etc.)
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ---------------------------------------------------------------------------
// CLI parsing
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);
const FLAG_JSON = args.includes("--json");
const FLAG_HELP = args.includes("--help") || args.includes("-h");
const FLAG_DESTRUCTIVE = args.includes("--destructive") || args.includes("--write");
const categoryArg = args.find((a) => a.startsWith("--category="));
const CATEGORY_FILTER = categoryArg ? categoryArg.slice("--category=".length) : null;

if (FLAG_HELP) {
  // Extract the docblock that starts at line 2 (`/**`) and ends at the first
  // line containing `*/`. We intentionally don't use a hardcoded slice bound
  // so adding or removing lines inside the docblock won't leak `import` lines
  // into --help output.
  const source = fs.readFileSync(new URL(import.meta.url), "utf8").split(/\r?\n/);
  const docLines = [];
  for (let i = 1; i < source.length; i++) {
    const line = source[i];
    if (/\*\//.test(line)) break;
    docLines.push(line);
  }
  const lines = docLines
    .map((l) => l.replace(/^ ?\*\/?/, "").replace(/^ \* ?/, ""))
    .filter((l) => !l.startsWith("/**"))
    .join("\n");
  process.stdout.write(lines + "\n");
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Env loading
// ---------------------------------------------------------------------------

function parseEnvFile(envPath) {
  const vars = {};
  if (!fs.existsSync(envPath)) return vars;
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq > 0) {
      vars[trimmed.slice(0, eq)] = trimmed.slice(eq + 1).replace(/^["']|["']$/g, "");
    }
  }
  return vars;
}

function loadEnvFile() {
  // Primary: .env.local next to the script (survives `node path/to/smoke-all.mjs`
  // from any cwd). Fallback: .env.local in cwd if the script-dir copy is absent.
  const scriptDirEnv = path.join(__dirname, ".env.local");
  const cwdEnv = path.join(process.cwd(), ".env.local");
  const primary = parseEnvFile(scriptDirEnv);
  if (Object.keys(primary).length > 0) return primary;
  if (scriptDirEnv !== cwdEnv) return parseEnvFile(cwdEnv);
  return primary;
}

const envFile = loadEnvFile();
const env = (key) => process.env[key] || envFile[key] || "";

const SUPABASE_URL = env("SUPABASE_URL").replace(/\/+$/, "");
const SERVICE_KEY = env("SUPABASE_SERVICE_ROLE_KEY");
const MCP_KEY = env("MCP_ACCESS_KEY");
const REST_API_BASE = env("REST_API_BASE").replace(/\/+$/, "");
// NEXT_PUBLIC_API_URL is the open-brain-rest base URL (see
// dashboards/open-brain-dashboard-next/README.md:41), not a dashboard /api.
// Keep the legacy name for env parity with the dashboard, but treat it as a
// REST base-URL probe, not a dashboard health probe.
const REST_API_PUBLIC_URL = env("NEXT_PUBLIC_API_URL").replace(/\/+$/, "");
const ANON_KEY = env("SUPABASE_ANON_KEY");

if (!SUPABASE_URL || !SERVICE_KEY || !MCP_KEY) {
  const missing = [];
  if (!SUPABASE_URL) missing.push("SUPABASE_URL");
  if (!SERVICE_KEY) missing.push("SUPABASE_SERVICE_ROLE_KEY");
  if (!MCP_KEY) missing.push("MCP_ACCESS_KEY");
  process.stderr.write(
    `ERROR: missing required env var(s): ${missing.join(", ")}\n` +
    `Set them in .env.local in the current directory or export them.\n` +
    `See the README for details.\n`
  );
  process.exit(2);
}

const REST_BASE = `${SUPABASE_URL}/rest/v1`;
const FN_BASE = `${SUPABASE_URL}/functions/v1`;
const MCP_URL = `${FN_BASE}/open-brain-mcp`;

const SVC_HEADERS = {
  apikey: SERVICE_KEY,
  Authorization: `Bearer ${SERVICE_KEY}`,
  "Content-Type": "application/json",
};
const MCP_HEADERS = { "x-brain-key": MCP_KEY, "Content-Type": "application/json" };

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

/**
 * Run a single check with a timeout. Returns a uniform shape
 *   { status: "pass" | "skip" | "fail", message, details, ms }
 * Any thrown Error becomes a fail. Throw a SkipError to mark a check as
 * "skipped, not installed" without failing the run.
 */
class SkipError extends Error {
  constructor(msg) { super(msg); this.name = "SkipError"; }
}

async function runCheck(fn, { timeout = 10_000 } = {}) {
  const t0 = Date.now();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  try {
    const out = await fn(ctrl.signal);
    const ms = Date.now() - t0;
    if (out && typeof out === "object" && out.status) {
      return { ...out, ms };
    }
    return { status: "pass", message: String(out ?? "ok"), details: null, ms };
  } catch (err) {
    const ms = Date.now() - t0;
    if (err instanceof SkipError) {
      return { status: "skip", message: err.message, details: null, ms };
    }
    const raw = err.name === "AbortError" ? `timeout after ${timeout}ms` : String(err.message || err);
    return { status: "fail", message: raw.slice(0, 240), details: null, ms };
  } finally {
    clearTimeout(timer);
  }
}

async function fetchJson(url, init, signal) {
  const res = await fetch(url, { ...init, signal });
  const text = await res.text();
  if (!res.ok) {
    const body = text.slice(0, 200);
    const e = new Error(`HTTP ${res.status}${body ? `: ${body}` : ""}`);
    e.status = res.status;
    throw e;
  }
  return text ? JSON.parse(text) : null;
}

async function tableCount(table, signal, extraQuery = "") {
  const q = extraQuery ? `&${extraQuery}` : "";
  const res = await fetch(`${REST_BASE}/${table}?select=id&limit=1${q}`, {
    headers: { ...SVC_HEADERS, Prefer: "count=exact" },
    signal,
  });
  if (res.status === 404) {
    const e = new Error("table not found");
    e.status = 404;
    throw e;
  }
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const cr = res.headers.get("content-range") ?? "";
  const n = cr.split("/")[1];
  return n === undefined ? null : (n === "*" ? null : parseInt(n, 10));
}

function requireOptional(err, what) {
  if (err.status === 404 || /table not found|does not exist|schema cache/i.test(String(err.message))) {
    throw new SkipError(`${what} not installed`);
  }
  throw err;
}

// ---------------------------------------------------------------------------
// Category 1: MCP Server (canonical core)
// ---------------------------------------------------------------------------

const mcpChecks = [
  {
    name: "open-brain-mcp endpoint responds",
    fn: async (s) => {
      const res = await fetch(MCP_URL, { method: "OPTIONS", signal: s });
      if (res.status >= 500) throw new Error(`HTTP ${res.status}`);
      return `HTTP ${res.status}`;
    },
  },
  {
    name: "MCP tools/list returns core tools",
    fn: async (s) => {
      const body = await fetchJson(MCP_URL, {
        method: "POST",
        headers: MCP_HEADERS,
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
      }, s);
      const tools = body?.result?.tools ?? [];
      const names = tools.map((t) => t.name);
      const required = ["search_thoughts", "list_thoughts", "thought_stats", "capture_thought"];
      const missing = required.filter((n) => !names.includes(n));
      if (missing.length) throw new Error(`missing core tools: ${missing.join(", ")}`);
      return `tools=${names.length} (${required.join(", ")})`;
    },
  },
  {
    name: "MCP initialize handshake",
    fn: async (s) => {
      const body = await fetchJson(MCP_URL, {
        method: "POST",
        headers: MCP_HEADERS,
        body: JSON.stringify({
          jsonrpc: "2.0", id: 1, method: "initialize",
          params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "smoke-test", version: "1.0" } },
        }),
      }, s);
      if (!body?.result?.serverInfo) throw new Error("no serverInfo in response");
      return `server=${body.result.serverInfo.name ?? "unknown"}`;
    },
  },
];

// ---------------------------------------------------------------------------
// Category 2: REST API (optional -- integrations/rest-api)
// ---------------------------------------------------------------------------

const restBase = REST_API_BASE || (FN_BASE + "/open-brain-rest");

const restChecks = [
  {
    name: "GET /health",
    fn: async (s) => {
      try {
        const body = await fetchJson(`${restBase}/health`, { headers: MCP_HEADERS }, s);
        return body?.status ?? "ok";
      } catch (err) {
        if (err.status === 404) throw new SkipError("REST API not installed");
        throw err;
      }
    },
  },
  {
    // /thoughts is the documented data-path endpoint on open-brain-rest --
    // see dashboards/open-brain-dashboard-next/README.md under
    // "REST API Endpoints Required" for the full canonical list.
    name: "GET /thoughts?limit=3",
    fn: async (s) => {
      try {
        const body = await fetchJson(`${restBase}/thoughts?limit=3`, { headers: MCP_HEADERS }, s);
        const rows = body?.data ?? body?.results ?? (Array.isArray(body) ? body : []);
        return `rows=${rows.length}`;
      } catch (err) {
        if (err.status === 404) throw new SkipError("REST API not installed");
        throw err;
      }
    },
  },
  {
    name: "POST /search (text)",
    fn: async (s) => {
      try {
        const body = await fetchJson(`${restBase}/search`, {
          method: "POST",
          headers: MCP_HEADERS,
          body: JSON.stringify({ query: "smoke", mode: "text", limit: 3 }),
        }, s);
        const hits = body?.results ?? body?.data ?? [];
        return `hits=${hits.length}`;
      } catch (err) {
        if (err.status === 404) throw new SkipError("REST API not installed");
        throw err;
      }
    },
  },
  {
    name: "GET /stats",
    fn: async (s) => {
      try {
        const body = await fetchJson(`${restBase}/stats?days=7`, { headers: MCP_HEADERS }, s);
        return `total=${body?.total ?? body?.totals?.all ?? "?"}`;
      } catch (err) {
        if (err.status === 404) throw new SkipError("REST API not installed");
        throw err;
      }
    },
  },
  {
    // NEXT_PUBLIC_API_URL is the open-brain-rest base URL that the dashboard
    // is pointed at. Hitting /health on it proves the public env var the
    // dashboard uses actually resolves to a healthy REST gateway. Anything
    // outside 2xx is a fail so 401/500 can't masquerade as pass.
    name: "REST API base URL (NEXT_PUBLIC_API_URL) responds 2xx",
    fn: async (s) => {
      if (!REST_API_PUBLIC_URL) throw new SkipError("NEXT_PUBLIC_API_URL unset");
      const res = await fetch(`${REST_API_PUBLIC_URL}/health`, {
        headers: MCP_HEADERS,
        signal: s,
      });
      if (res.status >= 200 && res.status < 300) return `HTTP ${res.status}`;
      // 401 here means "URL resolves and the gateway is up, but our key was
      // not accepted". Surface it explicitly rather than silently passing.
      if (res.status === 401) {
        throw new Error(`HTTP 401 (base URL reachable, MCP_ACCESS_KEY rejected)`);
      }
      throw new Error(`HTTP ${res.status}`);
    },
  },
];

// ---------------------------------------------------------------------------
// Category 3: DB Schema
// ---------------------------------------------------------------------------

const dbChecks = [
  {
    name: "thoughts table present",
    fn: async (s) => {
      const n = await tableCount("thoughts", s);
      return `rows=${n ?? "?"}`;
    },
  },
  {
    name: "thoughts has canonical columns",
    fn: async (s) => {
      const res = await fetch(
        `${REST_BASE}/thoughts?select=id,content,embedding,metadata,created_at,updated_at&limit=1`,
        { headers: SVC_HEADERS, signal: s },
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 120)}`);
      return "id, content, embedding, metadata, created_at, updated_at";
    },
  },
  {
    name: "content_fingerprint column (dedup)",
    fn: async (s) => {
      const res = await fetch(`${REST_BASE}/thoughts?select=content_fingerprint&limit=1`, {
        headers: SVC_HEADERS, signal: s,
      });
      if (res.status === 400) throw new SkipError("content_fingerprint not added (see Step 2.6)");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return "present";
    },
  },
  {
    name: "match_thoughts RPC",
    fn: async (s) => {
      const res = await fetch(`${REST_BASE}/rpc/match_thoughts`, {
        method: "POST",
        headers: SVC_HEADERS,
        body: JSON.stringify({
          query_embedding: new Array(1536).fill(0),
          match_threshold: 0.0,
          match_count: 1,
        }),
        signal: s,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 120)}`);
      return "callable";
    },
  },
  {
    name: "upsert_thought RPC",
    fn: async (s) => {
      const res = await fetch(`${REST_BASE}/rpc/upsert_thought`, {
        method: "POST",
        headers: SVC_HEADERS,
        body: JSON.stringify({ p_content: "", p_payload: {} }),
        signal: s,
      });
      if (res.status === 404) throw new SkipError("upsert_thought RPC not installed (see Step 2.6)");
      // 400 with empty content is acceptable proof the function exists
      if (res.status === 400 || res.ok) return "callable";
      throw new Error(`HTTP ${res.status}`);
    },
  },
  {
    name: "thoughts recently written (last 7d)",
    fn: async (s) => {
      const since = new Date(Date.now() - 7 * 86_400_000).toISOString();
      const n = await tableCount("thoughts", s, `created_at=gte.${encodeURIComponent(since)}`);
      return `rows_7d=${n ?? "?"}`;
    },
  },
  {
    // Canonical tables created by recipes/ob-graph/schema.sql:12,28 are
    // `graph_nodes` and `graph_edges` -- NOT `entities`/`edges`. A harness
    // that probed `entities`/`edges` would report SKIP on every real OB1
    // install (stock or fully-loaded), misleading users who have ob-graph.
    name: "graph_nodes table (optional recipe: ob-graph)",
    fn: async (s) => {
      try {
        const n = await tableCount("graph_nodes", s);
        return `rows=${n ?? "?"}`;
      } catch (err) { requireOptional(err, "graph_nodes table"); }
    },
  },
  {
    name: "graph_edges table (optional recipe: ob-graph)",
    fn: async (s) => {
      try {
        const n = await tableCount("graph_edges", s);
        return `rows=${n ?? "?"}`;
      } catch (err) { requireOptional(err, "graph_edges table"); }
    },
  },
  {
    // The smart-ingest integration (integrations/smart-ingest) references
    // `ingestion_jobs` and its sibling `schemas/smart-ingest-tables` schema.
    // The schema is not yet on main at the time of writing; this probe will
    // resolve to PASS once that schema lands and is applied. Keep the probe
    // so the harness lights up automatically post-merge, rather than going
    // stale. If the integration is installed without the schema, this will
    // (correctly) show SKIP with a clear reason.
    name: "ingestion_jobs table (optional integration: smart-ingest)",
    fn: async (s) => {
      try {
        const n = await tableCount("ingestion_jobs", s);
        return `rows=${n ?? "?"}`;
      } catch (err) { requireOptional(err, "ingestion_jobs table (requires schemas/smart-ingest-tables, not yet on main)"); }
    },
  },
  {
    name: "search_thoughts_text RPC (optional schema: enhanced-thoughts)",
    fn: async (s) => {
      const res = await fetch(`${REST_BASE}/rpc/search_thoughts_text`, {
        method: "POST",
        headers: SVC_HEADERS,
        body: JSON.stringify({ p_query: "smoke", p_limit: 1 }),
        signal: s,
      });
      if (res.status === 404) throw new SkipError("enhanced-thoughts not installed");
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 120)}`);
      return "callable";
    },
  },
];

// ---------------------------------------------------------------------------
// Category 4: Auth
// ---------------------------------------------------------------------------

const authChecks = [
  {
    name: "MCP rejects missing access key",
    fn: async (s) => {
      const res = await fetch(MCP_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
        signal: s,
      });
      if (res.status === 401 || res.status === 403) return `HTTP ${res.status} (rejected)`;
      throw new Error(`expected 401/403, got ${res.status}`);
    },
  },
  {
    name: "MCP rejects wrong access key",
    fn: async (s) => {
      const res = await fetch(MCP_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-brain-key": "wrong-key-for-smoke-test" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
        signal: s,
      });
      if (res.status === 401 || res.status === 403) return `HTTP ${res.status} (rejected)`;
      throw new Error(`expected 401/403, got ${res.status}`);
    },
  },
  {
    name: "MCP accepts correct access key (header)",
    fn: async (s) => {
      const res = await fetch(MCP_URL, {
        method: "POST",
        headers: MCP_HEADERS,
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
        signal: s,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return `HTTP ${res.status}`;
    },
  },
  {
    name: "MCP accepts correct access key (?key=)",
    fn: async (s) => {
      const res = await fetch(`${MCP_URL}?key=${encodeURIComponent(MCP_KEY)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
        signal: s,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return `HTTP ${res.status}`;
    },
  },
];

// ---------------------------------------------------------------------------
// Category 5: Core Feature Smoke (capture + search + cleanup)
//
// Destructive -- gated behind --destructive (alias --write). When the flag
// is off this entire category is skipped without touching the database.
// When the flag is on, an UUID-based tag plus a SIGINT/SIGTERM cleanup
// hook guarantee that even a killed process does not leave rows behind.
// ---------------------------------------------------------------------------

const SMOKE_TAG = `ob1-smoke-${randomUUID()}`;
let createdSmokeId = null;
let cleanupInstalled = false;
// Three-state cleanup machine:
//   cleanupRan      -- DELETE confirmed 2xx from PostgREST. Safe.
//   cleanupFailed   -- DELETE was attempted but errored (non-2xx, network
//                      error, or thrown exception). Residue may exist.
//   neither         -- Cleanup never attempted (e.g., SIGINT mid-test before
//                      the category-level finally ran).
// The finally handler at category exit and the SIGINT/SIGTERM hooks consult
// these flags to decide whether to run, retry, or skip cleanup.
let cleanupRan = false;
let cleanupFailed = false;
let cleanupInFlight = null; // Promise if a DELETE is currently pending.

async function deleteSmokeRows(reason = "cleanup") {
  if (cleanupRan) return { ok: true, reason: "already-clean" };
  // Dedupe concurrent callers (signal handler + finally fired together).
  // Wait for the in-flight attempt and return its state so the caller sees
  // the real outcome rather than a stale "already-clean".
  if (cleanupInFlight) return cleanupInFlight;

  cleanupInFlight = (async () => {
    try {
      const res = await fetch(
        `${REST_BASE}/thoughts?metadata->>tag=eq.${encodeURIComponent(SMOKE_TAG)}`,
        { method: "DELETE", headers: SVC_HEADERS },
      );
      if (!res.ok) {
        cleanupFailed = true;
        const bodySnippet = (await res.text().catch(() => "")).slice(0, 160);
        process.stderr.write(
          `WARN: ${reason} failed to delete smoke rows (HTTP ${res.status})${
            bodySnippet ? `: ${bodySnippet}` : ""
          }. Tag: ${SMOKE_TAG}\n`,
        );
        return { ok: false, status: res.status, reason };
      }
      cleanupRan = true;
      cleanupFailed = false;
      return { ok: true, status: res.status, reason };
    } catch (err) {
      cleanupFailed = true;
      process.stderr.write(
        `WARN: ${reason} threw while deleting smoke rows: ${String(err.message || err)}. ` +
        `Tag: ${SMOKE_TAG}\n`,
      );
      return { ok: false, error: err, reason };
    } finally {
      cleanupInFlight = null;
    }
  })();

  return cleanupInFlight;
}

function installDestructiveCleanupHooks() {
  if (cleanupInstalled) return;
  cleanupInstalled = true;
  const handler = (sig) => {
    // Fire cleanup, then exit. Don't await -- we're in a signal handler and
    // Node will keep the event loop alive while the fetch is pending.
    deleteSmokeRows(`${sig} handler`).finally(() => process.exit(130));
  };
  process.once("SIGINT", () => handler("SIGINT"));
  process.once("SIGTERM", () => handler("SIGTERM"));
}

const coreChecks = [
  {
    name: "Insert test thought via direct REST",
    fn: async (s) => {
      const body = [{
        content: `Smoke test row ${SMOKE_TAG}`,
        metadata: { smoke_test: true, tag: SMOKE_TAG },
      }];
      const res = await fetch(`${REST_BASE}/thoughts?select=id`, {
        method: "POST",
        headers: { ...SVC_HEADERS, Prefer: "return=representation" },
        body: JSON.stringify(body),
        signal: s,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 120)}`);
      const rows = await res.json();
      createdSmokeId = rows?.[0]?.id ?? null;
      if (!createdSmokeId) throw new Error("no id returned");
      return `id=${createdSmokeId.slice(0, 8)}...`;
    },
  },
  {
    name: "Retrieve test thought by id",
    fn: async (s) => {
      if (!createdSmokeId) throw new SkipError("no id from insert step");
      const rows = await fetchJson(
        `${REST_BASE}/thoughts?select=id,content&id=eq.${createdSmokeId}`,
        { headers: SVC_HEADERS }, s,
      );
      if (!rows?.length) throw new Error("not found");
      if (!rows[0].content.includes(SMOKE_TAG)) throw new Error("content mismatch");
      return "content matches";
    },
  },
  {
    name: "MCP capture_thought tool call",
    fn: async (s) => {
      const body = await fetchJson(MCP_URL, {
        method: "POST",
        headers: MCP_HEADERS,
        body: JSON.stringify({
          jsonrpc: "2.0", id: 2, method: "tools/call",
          params: {
            name: "capture_thought",
            arguments: { content: `MCP smoke probe ${SMOKE_TAG}`, metadata: { smoke_test: true, tag: SMOKE_TAG } },
          },
        }),
      }, s);
      if (body?.error) throw new Error(`MCP error: ${body.error.message ?? JSON.stringify(body.error)}`);
      if (!body?.result) throw new Error("no result in MCP response");
      return "captured";
    },
  },
  {
    name: "MCP search_thoughts finds test row",
    fn: async (s) => {
      // Best-effort: some clients debounce embedding; retry once.
      for (const attempt of [1, 2]) {
        const body = await fetchJson(MCP_URL, {
          method: "POST",
          headers: MCP_HEADERS,
          body: JSON.stringify({
            jsonrpc: "2.0", id: 3, method: "tools/call",
            params: { name: "search_thoughts", arguments: { query: SMOKE_TAG, limit: 5 } },
          }),
        }, s);
        if (body?.error) throw new Error(`MCP error: ${body.error.message ?? JSON.stringify(body.error)}`);
        const textBlob = JSON.stringify(body?.result ?? {});
        if (textBlob.includes(SMOKE_TAG)) return `found on attempt ${attempt}`;
        if (attempt === 1) await new Promise((r) => setTimeout(r, 1500));
      }
      throw new Error("smoke tag not in search results");
    },
  },
  // NOTE: the Cleanup check used to live here as a regular runCheck entry,
  // but that made the dashboard lie: a failed DELETE would push a stale
  // "fail" entry into results, and even if the finally-block retry later
  // succeeded, the original failed entry still counted in totals.fail. The
  // Cleanup check is now synthesised in main() AFTER the finally retry has
  // run, so the reported status reflects the true final state.
];

// ---------------------------------------------------------------------------
// Category 6: Access Key Enforcement
//
// Proves that the Supabase PostgREST gateway itself rejects requests that
// are missing or carry an invalid apikey header. This runs BEFORE table
// policies are evaluated, so it does NOT prove RLS is configured -- see
// the Row-Level Security category below for that.
// ---------------------------------------------------------------------------

const accessKeyChecks = [
  {
    name: "PostgREST rejects missing apikey",
    fn: async (s) => {
      const res = await fetch(`${REST_BASE}/thoughts?select=id&limit=1`, { signal: s });
      if (res.status === 401 || res.status === 403 || res.status === 404) {
        return `HTTP ${res.status} (rejected before RLS)`;
      }
      throw new Error(`expected 401/403/404 without apikey, got ${res.status}`);
    },
  },
  {
    name: "PostgREST rejects invalid apikey",
    fn: async (s) => {
      const res = await fetch(`${REST_BASE}/thoughts?select=id&limit=1`, {
        headers: { apikey: "invalid-anon-smoke" },
        signal: s,
      });
      if (res.status === 401 || res.status === 403) return `HTTP ${res.status} (rejected before RLS)`;
      throw new Error(`expected 401/403, got HTTP ${res.status}`);
    },
  },
  {
    name: "Service role can read thoughts",
    fn: async (s) => {
      const n = await tableCount("thoughts", s);
      return `rows=${n ?? "?"}`;
    },
  },
];

// ---------------------------------------------------------------------------
// Category 7: Row-Level Security
//
// Actually probes whether RLS is enabled on public.thoughts and whether
// policies are restrictive. Two independent probes:
//
//   1) pg_class.relrowsecurity lookup. Requires either a helper RPC named
//      pg_class_rls (not part of stock OB1) OR access via the supabase_admin
//      endpoint. If neither is reachable we skip this probe and rely on #2.
//
//   2) Anon-key read of public.thoughts. If RLS is off or a permissive
//      ALL USING (true) policy exists, anon gets rows back -- fail. If RLS
//      is on with no anon-select policy, anon gets HTTP 200 with an empty
//      array (PostgREST filter behaviour). Requires SUPABASE_ANON_KEY; if
//      unset, skip with a clear note that RLS could not be verified.
// ---------------------------------------------------------------------------

const rlsChecks = [
  {
    name: "pg_class.relrowsecurity = true for public.thoughts",
    fn: async (s) => {
      // Try a named helper RPC first (opt-in, not part of stock OB1).
      const rpcRes = await fetch(`${REST_BASE}/rpc/pg_class_rls`, {
        method: "POST",
        headers: SVC_HEADERS,
        body: JSON.stringify({ p_schema: "public", p_table: "thoughts" }),
        signal: s,
      });
      if (rpcRes.status === 404) {
        throw new SkipError("pg_class_rls helper RPC not installed (rely on anon probe)");
      }
      if (!rpcRes.ok) throw new Error(`HTTP ${rpcRes.status}`);
      const body = await rpcRes.json().catch(() => null);
      const flag = Array.isArray(body) ? body[0]?.relrowsecurity : body?.relrowsecurity;
      if (flag === true) return "relrowsecurity=true";
      throw new Error(`relrowsecurity=${flag} -- RLS is OFF on public.thoughts`);
    },
  },
  {
    name: "Anon key cannot read thoughts (real RLS probe)",
    fn: async (s) => {
      if (!ANON_KEY) {
        throw new SkipError("SUPABASE_ANON_KEY unset -- RLS not verified end-to-end");
      }
      const res = await fetch(`${REST_BASE}/thoughts?select=id&limit=1`, {
        headers: { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}` },
        signal: s,
      });
      if (res.status === 401 || res.status === 403) return `HTTP ${res.status} (rejected)`;
      if (res.status === 200) {
        const rows = await res.json().catch(() => null);
        if (Array.isArray(rows) && rows.length === 0) {
          return "HTTP 200 with 0 rows (RLS filtering works)";
        }
        // Non-empty rows under anon = RLS is off or a permissive policy leaks data.
        throw new Error(
          `HTTP 200 with ${Array.isArray(rows) ? rows.length : "?"} rows -- ` +
          `anon can read public.thoughts. RLS is OFF or a permissive ` +
          `ALL USING (true) policy exists. FIX IMMEDIATELY.`,
        );
      }
      throw new Error(`unexpected HTTP ${res.status} under anon key`);
    },
  },
];

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

const categories = [
  { name: "MCP Server", checks: mcpChecks },
  { name: "REST API", checks: restChecks },
  { name: "DB Schema", checks: dbChecks },
  { name: "Auth", checks: authChecks },
  { name: "Core Features", checks: coreChecks },
  { name: "Access Key Enforcement", checks: accessKeyChecks },
  { name: "Row-Level Security", checks: rlsChecks },
];

function categoryFilter(name) {
  if (!CATEGORY_FILTER) return true;
  return name.toLowerCase() === CATEGORY_FILTER.toLowerCase();
}

async function main() {
  const selected = categories.filter((c) => categoryFilter(c.name));
  if (selected.length === 0) {
    process.stderr.write(`ERROR: no category matches --category=${CATEGORY_FILTER}\n`);
    process.stderr.write(`Available: ${categories.map((c) => c.name).join(", ")}\n`);
    process.exit(2);
  }

  const results = [];
  let coreFeaturesRan = false;

  for (const category of selected) {
    // Core Features is gated behind --destructive because it INSERTs rows via
    // the service-role key, which triggers the upsert_thought trigger chain
    // (embedding + LLM metadata generation) and charges external model calls.
    // Skip the whole category cleanly when the flag is off so CI can run this
    // harness against shared/prod instances without mutating data or spending.
    if (category.name === "Core Features" && !FLAG_DESTRUCTIVE) {
      results.push({
        category: category.name,
        name: "Core Features (destructive)",
        status: "skip",
        message: "pass --destructive to exercise capture + search + cleanup (writes rows, spends LLM credits)",
        details: null,
        ms: 0,
      });
      continue;
    }

    if (category.name === "Core Features") {
      // Wrap the whole category in try/finally so cleanup runs even if a check
      // mid-way throws. The SIGINT/SIGTERM handlers cover ctrl-c / kill.
      coreFeaturesRan = true;
      installDestructiveCleanupHooks();
      // Cleanup state tracker -- populated during the first attempt inside
      // the category run and the retry inside the finally. We DO NOT push
      // to results until both have settled so the dashboard reports the
      // true final outcome of cleanup (not a stale mid-flight "fail").
      let cleanupAttempts = 0;
      let cleanupLastError = null;
      let cleanupT0 = 0;
      let cleanupMs = 0;
      try {
        for (const check of category.checks) {
          const outcome = await runCheck(check.fn);
          results.push({ category: category.name, name: check.name, ...outcome });
        }
        // First cleanup attempt (inside the try so a thrown DELETE does not
        // hide the rest of the run's results, but before finally so the
        // retry path only runs when this attempt genuinely failed).
        cleanupT0 = Date.now();
        cleanupAttempts = 1;
        const first = await deleteSmokeRows("normal cleanup");
        cleanupMs = Date.now() - cleanupT0;
        if (!first?.ok) {
          cleanupLastError = first?.status ? `HTTP ${first.status}` : "threw";
        }
      } finally {
        // Three-state retry policy:
        //   1. If cleanup never attempted (SIGINT mid-test, early throw before
        //      the normal cleanup attempt above), run it now and count it as
        //      attempt 1.
        //   2. If cleanup was attempted and failed, retry exactly once before
        //      giving up -- transient 5xx is common and the UUID tag keeps
        //      the retry scoped to this run.
        //   3. If cleanup already succeeded (cleanupRan), deleteSmokeRows
        //      short-circuits and returns immediately.
        if (!cleanupRan && !cleanupFailed && cleanupAttempts === 0) {
          cleanupT0 = Date.now();
          cleanupAttempts = 1;
          const out = await deleteSmokeRows("finally cleanup");
          cleanupMs = Date.now() - cleanupT0;
          if (!out?.ok) {
            cleanupLastError = out?.status ? `HTTP ${out.status}` : "threw";
          }
        } else if (cleanupFailed) {
          process.stderr.write(
            `WARN: previous cleanup attempt failed; retrying once. Tag: ${SMOKE_TAG}\n`,
          );
          // Reset the failed flag so deleteSmokeRows runs again rather than
          // short-circuiting on the in-flight/failed state.
          cleanupFailed = false;
          const retryT0 = Date.now();
          cleanupAttempts = 2;
          const retry = await deleteSmokeRows("finally retry");
          cleanupMs += Date.now() - retryT0;
          if (retry?.ok) {
            cleanupLastError = null;
          } else {
            cleanupLastError = retry?.status ? `HTTP ${retry.status}` : "threw";
            process.stderr.write(
              `ERROR: cleanup still failed after retry. Manually delete rows ` +
              `where metadata->>tag = '${SMOKE_TAG}'\n`,
            );
          }
        }
        // Synthesize the single authoritative Cleanup entry now that all
        // attempts have settled. This replaces the stale-on-retry check
        // that used to live inside coreChecks.
        if (cleanupAttempts > 0) {
          const attemptNote =
            cleanupAttempts === 1 ? "deleted on first attempt" : "deleted on retry (attempt 2)";
          if (cleanupRan && !cleanupFailed) {
            results.push({
              category: category.name,
              name: "Cleanup: delete test rows",
              status: "pass",
              message: attemptNote,
              details: null,
              ms: cleanupMs,
            });
          } else {
            results.push({
              category: category.name,
              name: "Cleanup: delete test rows",
              status: "fail",
              message:
                `cleanup-failed after ${cleanupAttempts} attempt${cleanupAttempts === 1 ? "" : "s"}` +
                `${cleanupLastError ? ` (${cleanupLastError})` : ""}; ` +
                `manual delete: tag=${SMOKE_TAG}`,
              details: null,
              ms: cleanupMs,
            });
          }
        }
      }
      continue;
    }

    // Run checks within a category sequentially so shared state
    // (createdSmokeId) stays consistent.
    for (const check of category.checks) {
      const outcome = await runCheck(check.fn);
      results.push({ category: category.name, name: check.name, ...outcome });
    }
  }

  const totals = results.reduce((acc, r) => {
    acc[r.status] = (acc[r.status] ?? 0) + 1;
    return acc;
  }, { pass: 0, skip: 0, fail: 0 });

  // Cleanup residue is a FAIL condition even if every check otherwise passed.
  // If Core Features ran AND the cleanup state machine ended in cleanupFailed
  // (retry also failed), exit non-zero so CI catches rows that need manual
  // deletion. Without this, a false-green run could leak smoke rows into a
  // shared database forever.
  const cleanupResidue = coreFeaturesRan && cleanupFailed;
  const allPass = totals.fail === 0 && !cleanupResidue;

  if (FLAG_JSON) {
    process.stdout.write(JSON.stringify({
      ok: allPass,
      totals,
      total: results.length,
      results,
    }, null, 2) + "\n");
  } else {
    process.stdout.write(
      `Open Brain Smoke Test -- ${results.length} checks across ${selected.length} categories\n` +
      `Target: ${SUPABASE_URL}\n\n`
    );
    for (const category of selected) {
      const rows = results.filter((r) => r.category === category.name);
      if (rows.length === 0) continue;
      process.stdout.write(`${category.name}:\n`);
      for (const r of rows) {
        const icon = r.status === "pass" ? "\u2713" : r.status === "skip" ? "\u26A0" : "\u2717";
        const name = r.name.padEnd(55);
        const ms = `${r.ms}ms`.padStart(7);
        const detail = r.message ? ` -- ${r.message}` : "";
        process.stdout.write(`  ${icon} ${name} ${ms}${detail}\n`);
      }
      process.stdout.write("\n");
    }
    process.stdout.write(
      `Summary: ${totals.pass} pass, ${totals.skip} skip, ${totals.fail} fail ` +
      `(${results.length} total)\n`
    );
    if (cleanupResidue) {
      process.stdout.write(
        `Cleanup: FAILED -- smoke rows may remain. ` +
        `Manual delete: metadata->>tag = '${SMOKE_TAG}'\n`,
      );
    }
    process.stdout.write(allPass ? "Result: OK\n" : "Result: FAIL\n");
  }

  process.exit(allPass ? 0 : 1);
}

main().catch((err) => {
  process.stderr.write(`Fatal: ${err.stack ?? err}\n`);
  process.exit(1);
});
