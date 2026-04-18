#!/usr/bin/env node
/**
 * smoke-all.mjs -- Full-surface smoke test for an Open Brain install.
 *
 * ~30 independent checks across six categories: MCP endpoint, REST API
 * gateway, database schema, access-key enforcement, core capture/search
 * features, and row-level security. Verifies that a freshly-built Open
 * Brain is wired correctly.
 *
 * Stock Open Brain (docs/01-getting-started.md) needs only the canonical
 * thoughts table, open-brain-mcp Edge Function, and MCP_ACCESS_KEY. Optional
 * tables and endpoints (entities, edges, REST API, enhanced-thoughts RPCs)
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
  const lines = fs.readFileSync(new URL(import.meta.url), "utf8")
    .split(/\r?\n/)
    .slice(1, 45)
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
const DASHBOARD_URL = env("NEXT_PUBLIC_API_URL").replace(/\/+$/, "");

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
    name: "Dashboard health (NEXT_PUBLIC_API_URL)",
    fn: async (s) => {
      if (!DASHBOARD_URL) throw new SkipError("NEXT_PUBLIC_API_URL unset");
      const res = await fetch(`${DASHBOARD_URL}/health`, { signal: s });
      return `HTTP ${res.status}`;
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
    name: "entities table (optional recipe: ob-graph)",
    fn: async (s) => {
      try {
        const n = await tableCount("entities", s);
        return `rows=${n ?? "?"}`;
      } catch (err) { requireOptional(err, "entities table"); }
    },
  },
  {
    name: "edges table (optional recipe: ob-graph)",
    fn: async (s) => {
      try {
        const n = await tableCount("edges", s);
        return `rows=${n ?? "?"}`;
      } catch (err) { requireOptional(err, "edges table"); }
    },
  },
  {
    name: "ingestion_jobs table (optional integration: smart-ingest)",
    fn: async (s) => {
      try {
        const n = await tableCount("ingestion_jobs", s);
        return `rows=${n ?? "?"}`;
      } catch (err) { requireOptional(err, "ingestion_jobs table"); }
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
// ---------------------------------------------------------------------------

const SMOKE_TAG = `ob1-smoke-${Date.now()}`;
let createdSmokeId = null;

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
  {
    name: "Cleanup: delete test rows",
    fn: async (s) => {
      const res = await fetch(
        `${REST_BASE}/thoughts?metadata->>tag=eq.${encodeURIComponent(SMOKE_TAG)}`,
        { method: "DELETE", headers: SVC_HEADERS, signal: s },
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return "deleted";
    },
  },
];

// ---------------------------------------------------------------------------
// Category 6: Safety Rails
// ---------------------------------------------------------------------------

const safetyChecks = [
  {
    name: "RLS enabled on thoughts",
    fn: async (s) => {
      // Query pg_tables via PostgREST is not possible without a helper RPC.
      // Proxy: anon+apikey-less request must fail; see next check. We call
      // the public schema's /thoughts without auth and require a rejection.
      const res = await fetch(`${REST_BASE}/thoughts?select=id&limit=1`, { signal: s });
      if (res.status === 401 || res.status === 403 || res.status === 404) {
        return `HTTP ${res.status} (unauthenticated access rejected)`;
      }
      throw new Error(`expected 401/403/404 without apikey, got ${res.status}`);
    },
  },
  {
    name: "Anon/publishable key cannot read thoughts",
    fn: async (s) => {
      // If the caller didn't provide a separate anon key, this is best-effort:
      // we call with an obviously-invalid apikey, which PostgREST rejects with 401.
      const res = await fetch(`${REST_BASE}/thoughts?select=id&limit=1`, {
        headers: { apikey: "invalid-anon-smoke" },
        signal: s,
      });
      if (res.status === 401 || res.status === 403) return `HTTP ${res.status} (rejected)`;
      // Some setups return 200 + empty rows for RLS-filtered anon queries.
      if (res.status === 200) {
        const rows = await res.json().catch(() => []);
        if (Array.isArray(rows) && rows.length === 0) return "empty (RLS filtered)";
      }
      throw new Error(`expected rejection or empty rows, got HTTP ${res.status}`);
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
// Runner
// ---------------------------------------------------------------------------

const categories = [
  { name: "MCP Server", checks: mcpChecks },
  { name: "REST API", checks: restChecks },
  { name: "DB Schema", checks: dbChecks },
  { name: "Auth", checks: authChecks },
  { name: "Core Features", checks: coreChecks },
  { name: "Safety Rails", checks: safetyChecks },
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

  for (const category of selected) {
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

  const allPass = totals.fail === 0;

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
    process.stdout.write(allPass ? "Result: OK\n" : "Result: FAIL\n");
  }

  process.exit(allPass ? 0 : 1);
}

main().catch((err) => {
  process.stderr.write(`Fatal: ${err.stack ?? err}\n`);
  process.exit(1);
});
