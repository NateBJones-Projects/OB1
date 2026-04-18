# Brain Smoke Test

> One-shot harness that probes every live surface of an Open Brain install and reports which ones are healthy, skipped (optional feature not installed), or broken.

## What It Does

Runs ~30 independent checks across seven categories against your deployed Open Brain and prints a pass/skip/fail dashboard. Optional features (REST API, ob-graph, enhanced-thoughts, smart-ingest) are detected automatically and skipped with a clear reason rather than failing the run, so the same script works on stock core installs and fully-loaded instances.

## Why Use This

Open Brain is a lot of moving parts -- a database, an Edge Function, a secret access key, RLS policies, and optionally more tables and endpoints from recipes and integrations. When something is wrong it is usually one specific thing: a missing `GRANT`, a mismatched access key, a forgotten column, a function that failed to deploy. This harness catches those misconfigurations before you waste an hour wondering why Claude Desktop sees no tools or why semantic search returns nothing.

Run it:

- After initial setup to confirm every surface is wired correctly
- After adding an extension or recipe that touches the schema
- Before reporting a bug -- the output tells a maintainer exactly which surface is broken
- In CI to guard a shared instance from regressing

## Categories Checked

1. **MCP Server** -- The `open-brain-mcp` Edge Function responds, exposes the four canonical tools (`search_thoughts`, `list_thoughts`, `thought_stats`, `capture_thought`), and completes a JSON-RPC `initialize` handshake.
2. **REST API** -- If you have installed the optional `rest-api` integration or set `REST_API_BASE`, the gateway answers `/health`, `/thoughts`, `/search`, and `/stats`. The `NEXT_PUBLIC_API_URL` env var (the base URL the dashboard is pointed at) is also probed and only passes on a 2xx response. Skipped otherwise.
3. **DB Schema** -- The canonical `public.thoughts` table exists with `id, content, embedding, metadata, created_at, updated_at`, the dedup fingerprint column is present, and `match_thoughts` + `upsert_thought` RPCs are callable. Optional tables (`graph_nodes`, `graph_edges`, `ingestion_jobs`) and the `search_thoughts_text` RPC are detected and skipped when absent.
4. **Auth** -- `MCP_ACCESS_KEY` is enforced: requests with no key, with a wrong key, with the header (`x-brain-key`), and with the query string (`?key=`) all produce the expected outcome.
5. **Core Features** -- **Destructive, opt-in via `--destructive`.** End-to-end capture + search + cleanup. Inserts a uniquely-tagged row via REST (triggers embedding + LLM metadata generation), fetches it back, calls MCP's `capture_thought` and `search_thoughts`, then deletes by tag. Skipped by default so CI can run this harness against shared/prod instances without mutating data or spending external model credits.
6. **Access Key Enforcement** -- The Supabase PostgREST gateway rejects requests with no `apikey` and with an invalid `apikey`. This runs **before** RLS, so these checks alone do not prove RLS is configured -- see category 7.
7. **Row-Level Security** -- Actually probes whether RLS is on and policies are restrictive. Tries an optional helper RPC (`pg_class_rls`) to read `pg_catalog.pg_class.relrowsecurity`. Also, if `SUPABASE_ANON_KEY` is set, does an anon-key read of `public.thoughts` and **fails loud** if rows come back (means RLS is off or a permissive `ALL USING (true)` policy is leaking data). Without `SUPABASE_ANON_KEY`, the anon probe is skipped with a clear note that RLS is unverified.

## Prerequisites

- Working Open Brain setup ([guide](../../docs/01-getting-started.md))
- Node.js 18 or later (uses the built-in `fetch` and `AbortController`)
- A local `.env.local` file (or exported environment variables) sitting next to `smoke-all.mjs`. The script looks for `.env.local` in its own directory first (so `node recipes/brain-smoke-test/smoke-all.mjs` works from any cwd) and falls back to the current working directory.

## Credential Tracker

Copy this block into a text editor and fill it in.

```text
BRAIN SMOKE TEST -- CREDENTIAL TRACKER
--------------------------------------

FROM YOUR OPEN BRAIN SETUP
  Project URL:                ____________  (e.g. https://abcd1234.supabase.co)
  Service role key:           ____________  (Supabase "Secret key")
  MCP access key:             ____________  (from Step 5 of the getting-started guide)

OPTIONAL (unlocks extra checks, safe to leave blank on stock installs)
  REST API base URL:          ____________  (e.g. https://<ref>.supabase.co/functions/v1/open-brain-rest)
  Dashboard REST base URL:    ____________  (the NEXT_PUBLIC_API_URL the dashboard uses;
                                              same shape as REST API base URL)
  Anon/publishable key:       ____________  (enables a real anon-key RLS probe in the
                                              Row-Level Security category)

--------------------------------------
```

## Installation

No build step. Just drop the file in and run it.

1. Copy `smoke-all.mjs` into a local folder on your machine (any folder is fine -- it does not need to live inside your Supabase project directory).

2. Create `.env.local` next to it:

   ```text
   SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
   SUPABASE_SERVICE_ROLE_KEY=your-service-role-secret-key
   MCP_ACCESS_KEY=your-access-key-from-step-5

   # Optional -- unlocks the REST API category. Leave unset on stock installs.
   # REST_API_BASE=https://YOUR_PROJECT_REF.supabase.co/functions/v1/open-brain-rest

   # Optional -- same base URL the dashboard uses (NEXT_PUBLIC_API_URL).
   # NEXT_PUBLIC_API_URL=https://YOUR_PROJECT_REF.supabase.co/functions/v1/open-brain-rest

   # Optional -- enables a real RLS probe that reads public.thoughts with
   # the anon key and fails if rows come back.
   # SUPABASE_ANON_KEY=your-anon-publishable-key
   ```

3. Run it:

   ```bash
   node smoke-all.mjs
   ```

## Usage

```bash
# Pretty-printed dashboard (default). Read-only: no data is inserted or
# deleted, no LLM calls are made. Core Features is SKIPPED.
node smoke-all.mjs

# Machine-readable JSON -- pipe into jq, a log aggregator, or CI assertions
node smoke-all.mjs --json

# Opt in to the destructive Core Features category. Inserts a uniquely-
# tagged row via the service-role key, triggers embedding + LLM metadata
# generation, then deletes by tag. Cleanup runs on normal exit, on a
# thrown check, and on SIGINT/SIGTERM, so ctrl-c does not leave residue.
# Use this against a dev/scratch project, NOT a shared/prod instance.
node smoke-all.mjs --destructive
node smoke-all.mjs --write         # alias

# Run only one category (names are case-insensitive)
node smoke-all.mjs --category="DB Schema"
node smoke-all.mjs --category=Auth
node smoke-all.mjs --category="Core Features" --destructive
node smoke-all.mjs --category="Row-Level Security"

# Show this usage
node smoke-all.mjs --help
```

The seven category names are `MCP Server`, `REST API`, `DB Schema`, `Auth`, `Core Features`, `Access Key Enforcement`, and `Row-Level Security`.

## Example Output

The harness prints one row per check, grouped by category, then a summary line. Row glyphs:

- `✓` **pass** -- the surface is wired correctly. Detail column shows what the check saw (`HTTP 204`, `rows=1247`, `callable`, etc.).
- `⚠` **skip** -- an optional dependency is not installed, or a prerequisite env var is unset. Detail column explains why (e.g. `REST API not installed`, `SUPABASE_ANON_KEY unset -- RLS not verified end-to-end`). Skipped checks never fail the run.
- `✗` **fail** -- the surface exists but answered wrong. Detail column shows the error (`HTTP 500`, `content mismatch`, `RLS is OFF or a permissive ALL USING (true) policy exists`).

Each row ends with the elapsed milliseconds for that check so a slow endpoint is visible at a glance.

The summary line has the form `Summary: <N> pass, <N> skip, <N> fail (<total> total)` where `<total>` matches the number of rows printed above it, followed by `Result: OK` (exit 0) or `Result: FAIL` (exit 1).

A representative shape on a healthy stock install, run without `--destructive` (no REST API, no ob-graph, no smart-ingest, no enhanced-thoughts, no `SUPABASE_ANON_KEY`):

```text
Open Brain Smoke Test -- 28 checks across 7 categories
Target: https://abcd1234.supabase.co

MCP Server:
  ✓ open-brain-mcp endpoint responds                         124ms -- HTTP 204
  ✓ MCP tools/list returns core tools                        312ms -- tools=4 (search_thoughts, list_thoughts, thought_stats, capture_thought)
  ✓ MCP initialize handshake                                 289ms -- server=open-brain

REST API:
  ⚠ GET /health                                               92ms -- REST API not installed
  ⚠ GET /thoughts?limit=3                                     88ms -- REST API not installed
  ⚠ POST /search (text)                                       91ms -- REST API not installed
  ⚠ GET /stats                                                87ms -- REST API not installed
  ⚠ REST API base URL (NEXT_PUBLIC_API_URL) responds 2xx       1ms -- NEXT_PUBLIC_API_URL unset

DB Schema:
  ✓ thoughts table present                                   178ms -- rows=1247
  ✓ thoughts has canonical columns                           142ms -- id, content, embedding, metadata, created_at, updated_at
  ✓ content_fingerprint column (dedup)                       138ms -- present
  ✓ match_thoughts RPC                                       301ms -- callable
  ✓ upsert_thought RPC                                       198ms -- callable
  ✓ thoughts recently written (last 7d)                      165ms -- rows_7d=84
  ⚠ graph_nodes table (optional recipe: ob-graph)            142ms -- graph_nodes table not installed
  ⚠ graph_edges table (optional recipe: ob-graph)            141ms -- graph_edges table not installed
  ⚠ ingestion_jobs table (optional integration: smart-ingest) 139ms -- ingestion_jobs table (requires schemas/smart-ingest-tables, not yet on main) not installed
  ⚠ search_thoughts_text RPC (optional schema: enhanced-thoughts) 138ms -- enhanced-thoughts not installed

Auth:
  ✓ MCP rejects missing access key                            96ms -- HTTP 401 (rejected)
  ✓ MCP rejects wrong access key                              98ms -- HTTP 401 (rejected)
  ✓ MCP accepts correct access key (header)                  197ms -- HTTP 200
  ✓ MCP accepts correct access key (?key=)                   201ms -- HTTP 200

Core Features:
  ⚠ Core Features (destructive)                                0ms -- pass --destructive to exercise capture + search + cleanup (writes rows, spends LLM credits)

Access Key Enforcement:
  ✓ PostgREST rejects missing apikey                          98ms -- HTTP 401 (rejected before RLS)
  ✓ PostgREST rejects invalid apikey                         102ms -- HTTP 401 (rejected before RLS)
  ✓ Service role can read thoughts                           154ms -- rows=1247

Row-Level Security:
  ⚠ pg_class.relrowsecurity = true for public.thoughts        94ms -- pg_class_rls helper RPC not installed (rely on anon probe)
  ⚠ Anon key cannot read thoughts (real RLS probe)             1ms -- SUPABASE_ANON_KEY unset -- RLS not verified end-to-end

Summary: 16 pass, 12 skip, 0 fail (28 total)
Result: OK
```

Row counts by category on a stock install without `--destructive`: MCP Server=3, REST API=5, DB Schema=10, Auth=4, Core Features=1 (synthetic skip), Access Key Enforcement=3, Row-Level Security=2 -- **28 total**. Pass/skip split depends on which optional recipes are installed; `16 pass + 12 skip + 0 fail` is the stock-install baseline above.

With `--destructive` the Core Features skip row is replaced by 5 real checks (insert, retrieve, MCP capture, MCP search, cleanup), so the total grows to 32. Installing ob-graph, smart-ingest (once its schema lands), enhanced-thoughts, REST API, and setting `SUPABASE_ANON_KEY` converts skips into passes without changing the row count.

## Exit Codes

- `0` -- all checks passed, or passed-or-skipped
- `1` -- at least one check failed
- `2` -- setup error (missing required env var, unknown `--category`)

Skipped checks never fail the run, so you can wire this into CI without it going red every time an optional recipe is absent. **Warning:** a `⚠` on the anon-key RLS probe means RLS was not actually verified -- set `SUPABASE_ANON_KEY` before trusting the run as a safety-rail gate.

## Extending

Each category is a plain array of `{ name, fn }` entries. To add a check:

1. Pick the category array (`mcpChecks`, `restChecks`, `dbChecks`, `authChecks`, `coreChecks`, `accessKeyChecks`, or `rlsChecks`) inside `smoke-all.mjs`.
2. Append an entry:

   ```js
   {
     name: "My new check",
     fn: async (signal) => {
       const res = await fetch(`${REST_BASE}/my_table?select=id&limit=1`, {
         headers: SVC_HEADERS, signal,
       });
       if (!res.ok) throw new Error(`HTTP ${res.status}`);
       return "ok";
     },
   },
   ```

3. For optional features, throw `SkipError` when the dependency is absent rather than letting the check fail:

   ```js
   if (res.status === 404) throw new SkipError("my-feature not installed");
   ```

Each `fn` gets an `AbortSignal` that fires at 10 seconds by default. Return a short string to show in the dashboard, or throw any other error to fail the check.

## Troubleshooting

**Issue: `ERROR: missing required env var(s): SUPABASE_URL, ...`**
Solution: Create `.env.local` in the current directory with `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and `MCP_ACCESS_KEY`, or export them into your shell. The script refuses to start without all three.

**Issue: `Auth: ✗ MCP accepts correct access key` fails with HTTP 401**
Solution: The `MCP_ACCESS_KEY` in `.env.local` does not match what Supabase has stored. Re-run `supabase secrets set MCP_ACCESS_KEY=<your-key>` and confirm the key in your credential tracker is identical.

**Issue: `DB Schema: ✗ thoughts has canonical columns` fails with HTTP 400**
Solution: Your `public.thoughts` table is missing one of the canonical columns (most commonly `embedding`). Re-run the SQL in [Step 2.2 of the getting-started guide](../../docs/01-getting-started.md). Additive migrations are safe -- the script only reads, it does not drop anything.

**Issue: `MCP search_thoughts finds test row` fails even though capture succeeded**
Solution: Embedding generation is asynchronous in some setups and may not land before search runs. The check already retries once with a 1.5 s delay; if it still fails, check the Edge Function logs in the Supabase dashboard for OpenRouter errors (missing or rate-limited key).
