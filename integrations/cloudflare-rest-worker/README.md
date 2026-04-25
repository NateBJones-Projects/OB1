# Open Brain REST Gateway (Cloudflare Worker)

A small Cloudflare Worker that implements the REST API the [Next.js
dashboard](../../dashboards/open-brain-dashboard-next/) expects — `open-brain-rest`. The
dashboard's README references this service but no implementation ships in
the repo; this Worker fills that gap so the four core dashboard pages
(Dashboard, Browse, Detail, Search) work end-to-end.

## What It Does

Exposes a REST-shaped surface over your existing Open Brain Supabase project:

| Method | Path | Backed by |
|---|---|---|
| `GET` | `/health` | unauthenticated; used by the dashboard's login page to validate the API URL |
| `GET` | `/thoughts` | paginated `SELECT` with whitelisted `sort` + filters (type, source_type, importance_min, quality_score_max, status, exclude_restricted) |
| `GET` | `/thought/:id` | single-row read |
| `PUT` | `/thought/:id` | partial update of `{ content, type, importance, status }` (last one bumps `status_updated_at`) |
| `DELETE` | `/thought/:id` | hard delete |
| `POST` | `/search` | semantic (embedding → `match_thoughts` RPC → re-fetch full rows) or text mode (`search_thoughts_text` RPC) |
| `GET` | `/stats` | reshapes the existing `brain_stats_aggregate` RPC into the dashboard's StatsResponse shape |
| `POST` | `/capture` | extracts metadata + embeds in parallel, calls `upsert_thought`, returns `{thought_id, action, type, sensitivity_tier, content_fingerprint, message}` |
| `GET` | `/ingestion-jobs` | empty stub (smart-ingest is out of scope for v1) |
| `POST` | `/ingest`, `POST` `/ingestion-jobs/:id/execute` | 501 Not Implemented |

Auth: same `MCP_ACCESS_KEY` your `open-brain-mcp` already uses, sent as the
`x-brain-key` header (or `Authorization: Bearer …` / `?key=…`).

## Architecture

```
Browser
   │
   │ HTTPS (iron-session cookie set on dashboard /login)
   ▼
Cloudflare Pages: open-brain-dashboard-next
   │
   │ HTTPS, server-side, x-brain-key from session cookie
   ▼
Cloudflare Worker: open-brain-rest          ← THIS WORKER
   │
   │ HTTPS, service-role JWT
   ▼
Supabase (thoughts table + RPCs)
```

## Prerequisites

- Working Open Brain setup ([guide](../../docs/01-getting-started.md)) — gives
  you `thoughts`, `match_thoughts`, `upsert_thought`
- [`schemas/enhanced-thoughts/`](../../schemas/enhanced-thoughts/) applied —
  required for `/stats`, `/search?mode=text`, and the
  `type / sensitivity_tier / importance / quality_score / source_type` columns
- A Cloudflare account (free tier works) — sign up at
  [dash.cloudflare.com](https://dash.cloudflare.com)
- `wrangler` CLI installed (`npm install -g wrangler`) and authenticated
  (`wrangler login`)
- Node.js 20+

## Credential Tracker

```text
OPEN BRAIN REST -- CREDENTIAL TRACKER
--------------------------------------

SUPABASE (from your Open Brain setup)
  Project URL:               ____________
  Service role key:          ____________
  MCP access key (reused):   ____________
  OpenRouter API key:        ____________

WORKER (filled in after deploy)
  Worker URL:                ____________

--------------------------------------
```

## Setup

### Step 1 — Configure

```bash
cd integrations/cloudflare-rest-worker
cp wrangler.toml.example wrangler.toml
```

The default `wrangler.toml` deploys as `ob-rest`. Rename via `[name]` if you
want a different subdomain.

### Step 2 — Install

```bash
npm install
```

### Step 3 — Set secrets

`wrangler secret put` is interactive — it prompts for the value, no shell
history. Set all four:

```bash
wrangler secret put SUPABASE_URL
wrangler secret put SUPABASE_SERVICE_ROLE_KEY
wrangler secret put MCP_ACCESS_KEY
wrangler secret put OPENROUTER_API_KEY
```

`MCP_ACCESS_KEY` is the same value already set on your `open-brain-mcp`
function — the dashboard reuses it. `OPENROUTER_API_KEY` powers the
`/search?mode=semantic` and `/capture` endpoints; same key as core.

### Step 4 — Deploy

```bash
wrangler deploy
```

Wrangler prints the published URL: `https://ob-rest.<your-cf-subdomain>.workers.dev`.
Save it as `WORKER_URL` in the credential tracker.

### Step 5 — Verify

```bash
# Unauthenticated health check
curl -sS "${WORKER_URL}/health"
# → {"status":"ok","service":"open-brain-rest","version":"0.1.0"}

# Auth enforcement
curl -sS -X GET "${WORKER_URL}/thoughts"
# → {"error":"Unauthorized"} 401

# Authenticated list
curl -sS "${WORKER_URL}/thoughts?per_page=3" \
  -H "x-brain-key: ${MCP_ACCESS_KEY}"
# → {"data":[…],"total":N,"page":1,"per_page":3}

# Stats
curl -sS "${WORKER_URL}/stats?days=7" \
  -H "x-brain-key: ${MCP_ACCESS_KEY}"

# Semantic search
curl -sS -X POST "${WORKER_URL}/search" \
  -H "x-brain-key: ${MCP_ACCESS_KEY}" \
  -H "content-type: application/json" \
  -d '{"query":"my thoughts on X","mode":"semantic","limit":5,"page":1,"exclude_restricted":true}'

# Capture
curl -sS -X POST "${WORKER_URL}/capture" \
  -H "x-brain-key: ${MCP_ACCESS_KEY}" \
  -H "content-type: application/json" \
  -d '{"content":"Test thought from REST gateway"}'
```

## Wiring the Dashboard

In the dashboard's `.env` (or Cloudflare Pages env vars):

```
NEXT_PUBLIC_API_URL=https://ob-rest.<your-cf-subdomain>.workers.dev
SESSION_SECRET=<openssl rand -hex 32>
```

Then run the dashboard locally (`npm run dev` from
`dashboards/open-brain-dashboard-next/`) or deploy it (next section). At the
login page, paste your `MCP_ACCESS_KEY` — the dashboard validates it against
this Worker's `/health`, then encrypts it into an HTTP-only session cookie
for the rest of the session.

## Deploying the Dashboard to Cloudflare Pages

The dashboard is a Next.js app and runs on Cloudflare Pages with the
`@cloudflare/next-on-pages` adapter:

```bash
cd dashboards/open-brain-dashboard-next
npm install
npm install -D @cloudflare/next-on-pages
npx @cloudflare/next-on-pages

# First-time deploy:
wrangler pages deploy .vercel/output/static --project-name=ob-dashboard
```

Or wire the GitHub repo to a Pages project via the Cloudflare dashboard for
push-based auto-deploys. Set `NEXT_PUBLIC_API_URL` and `SESSION_SECRET` in
the Pages project's environment variables.

The dashboard ends up at
`https://ob-dashboard.<your-cf-subdomain>.pages.dev`. Custom domain optional.

## Known Limitations (v1)

These are real impedance mismatches between the dashboard's expectations and
the upstream schema. The Worker is correct; resolving these requires upstream
changes that are out of scope for this PR:

1. **`Thought.id` type mismatch.** The dashboard's TypeScript types declare
   `id: number` and call `parseInt(id, 10)` on URL params
   (`app/thoughts/[id]/page.tsx:29`). The actual `thoughts.id` column is
   `UUID`. The Worker returns UUIDs as strings. Until the dashboard's `id`
   type is widened to `string | number`, the Detail page won't navigate to
   individual rows. **A separate small follow-up PR can fix the dashboard
   types.**

2. **`importance` scale mismatch.** The dashboard's `PRIORITY_LEVELS`
   expects 0–100 (Critical = 80+). The `enhanced-thoughts` schema defaults
   `importance` to 3 with no documented upper bound; the entity-extraction
   worker emits 0–6. Existing data will render as "Low" priority in the
   dashboard. Not a Worker bug.

3. **No `reflections` table.** The dashboard's Detail page calls
   `/thought/:id/reflection`. No schema in the repo creates a `reflections`
   table. The Worker doesn't implement this endpoint; the page will surface
   an error, the rest of the dashboard works.

4. **No smart-ingest integration.** `/ingest`, `/ingestion-jobs/:id`, and
   `/ingestion-jobs/:id/execute` return 501. The dashboard's Add to Brain
   "extract" mode and the Ingestion Jobs detail view will surface errors;
   single-thought capture via `/capture` works.

## Troubleshooting

**`wrangler deploy` errors with "not authenticated"**
Run `wrangler login`. The CLI opens a browser window for OAuth.

**Health check returns 200 but `/thoughts` returns 401**
You sent a key that doesn't match the Worker's `MCP_ACCESS_KEY` secret.
Verify with `wrangler secret list` (it shows names + when each was set, not
values). If you rotated the key on Supabase, also run
`wrangler secret put MCP_ACCESS_KEY` to keep them in sync.

**`/search?mode=semantic` returns 500 with "OpenRouter embedding failed"**
The `OPENROUTER_API_KEY` secret is missing, expired, or out of credits.
`wrangler secret put OPENROUTER_API_KEY` to refresh.

**`/search?mode=text` returns 500 with "function search_thoughts_text does not exist"**
The `enhanced-thoughts` schema isn't applied. Run
`schemas/enhanced-thoughts/schema.sql` in your Supabase SQL Editor.

**`/stats` returns 500 with "function brain_stats_aggregate does not exist"**
Same fix as above — apply `schemas/enhanced-thoughts/schema.sql`.

**Dashboard logs in successfully but Browse shows zero rows**
Check that `NEXT_PUBLIC_API_URL` is the Worker URL, not the Supabase MCP
function URL. The MCP function speaks JSON-RPC, not REST, and won't return
`{ data: [...] }`.

**Capture returns 200 but `embedding` column stays null**
The Worker calls `upsert_thought` (which writes the row) and then a
follow-up `UPDATE` (which writes the embedding). If your `service_role` is
missing `UPDATE` grants on `thoughts`, that follow-up fails silently into
500 — check Worker Logs in the Cloudflare dashboard for the Postgres error.

## What This Worker Doesn't Do

- **Workflow kanban endpoints** (P1) — needs `workflow-status` schema +
  status-flow status transitions; can be a follow-up.
- **Audit bulk delete, Duplicates** (P2) — `quality_score`-based bulk
  operations.
- **Reflections** (P2) — needs a `reflections` table that no schema
  currently creates.
- **Smart ingest extract / execute** (P2) — large feature; needs its own
  integration.

Future PRs can add these incrementally.
