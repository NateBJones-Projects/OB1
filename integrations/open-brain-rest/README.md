# Open Brain REST API

> REST API gateway for the Open Brain thoughts database — required backend for the [Next.js Dashboard](../../dashboards/open-brain-dashboard-next/).

## What It Does

Deploys a Supabase Edge Function that provides 12 REST endpoints for searching, browsing, capturing, editing, and analyzing your thoughts. Non-MCP clients (web dashboards, webhooks, external tools) use this API to interact with your Open Brain.

## Prerequisites

- Working Open Brain setup ([guide](../../docs/01-getting-started.md))
- An embedding API key: **OpenAI API key** (handles both embeddings and classification) **or** OpenRouter API key (embeddings only — capture works but metadata will be coarser)
- Optionally, an **Anthropic API key** for richer metadata classification (type, topics, people extraction)
- [Supabase CLI](https://supabase.com/docs/guides/cli) installed

## Credential Tracker

Copy this block into a text editor and fill it in as you go.

```text
OPEN BRAIN REST API -- CREDENTIAL TRACKER
------------------------------------------

FROM YOUR OPEN BRAIN SETUP
  Project URL:            ____________
  Project ref:            ____________
  Function URL:           ____________  (filled after deploy)

SECRETS TO SET
  MCP_ACCESS_KEY:         ____________  (your Open Brain access key)
  OPENAI_API_KEY:         ____________  (embeddings + classification)
    -- OR --
  OPENROUTER_API_KEY:     ____________  (embeddings only)

OPTIONAL
  ANTHROPIC_API_KEY:      ____________  (preferred classifier, richer metadata)

------------------------------------------
```

## Steps

![Step 1](https://img.shields.io/badge/Step_1-Apply_SQL_Migrations-1E88E5?style=for-the-badge)

Run these SQL files **in order** in your Supabase project's SQL Editor. Each file is in the `sql/` folder of this integration.

<details>
<summary>📋 <strong>SQL: 01-schema-extensions.sql</strong> (click to expand)</summary>

Adds a `serial_id` numeric surrogate key (for API compatibility with both UUID and BIGSERIAL base schemas), plus enrichment columns: `type`, `importance`, `quality_score`, `sensitivity_tier`, `source_type`, `content_fingerprint`.

> [!IMPORTANT]
> This migration auto-detects whether your `thoughts.id` column is UUID or integer and backfills `serial_id` accordingly. Run it before the other migrations.

Copy and run the contents of [`sql/01-schema-extensions.sql`](sql/01-schema-extensions.sql).

</details>

<details>
<summary>📋 <strong>SQL: 02-reflections-table.sql</strong> (click to expand)</summary>

Creates the `reflections` table for decision traces and lesson records linked to thoughts.

Copy and run the contents of [`sql/02-reflections-table.sql`](sql/02-reflections-table.sql).

</details>

<details>
<summary>📋 <strong>SQL: 03-ingestion-tables.sql</strong> (click to expand)</summary>

Creates `ingestion_jobs` and `ingestion_items` tables for the smart ingest pipeline.

> [!NOTE]
> The ingest endpoints (`/ingest`, `/ingestion-jobs`) require a separate `smart-ingest` Edge Function to be deployed. These tables are required for the dashboard's ingest page but the ingest flow is optional.

Copy and run the contents of [`sql/03-ingestion-tables.sql`](sql/03-ingestion-tables.sql).

</details>

<details>
<summary>📋 <strong>SQL: 04-rpcs.sql</strong> (click to expand)</summary>

Creates all 8 RPC functions used by the REST API: `upsert_thought`, `match_thoughts`, `search_thoughts_text`, `brain_stats_aggregate`, `get_thought_connections`, `find_near_duplicates`, `upsert_reflection`, `match_reflections`.

Copy and run the contents of [`sql/04-rpcs.sql`](sql/04-rpcs.sql).

</details>

<details>
<summary>📋 <strong>SQL: 05-text-search-index.sql</strong> (click to expand)</summary>

Adds full-text search support: a `tsv` tsvector column, GIN index, and auto-update trigger.

> [!WARNING]
> If you have a large number of existing thoughts, the initial backfill (`UPDATE thoughts SET tsv = ...`) may take a few seconds. This is normal.

Copy and run the contents of [`sql/05-text-search-index.sql`](sql/05-text-search-index.sql).

</details>

✅ **Done when:** All 5 SQL files have run without errors.

---

![Step 2](https://img.shields.io/badge/Step_2-Deploy_the_Edge_Function-1E88E5?style=for-the-badge)

**1. Create the function directory in your Supabase project:**

```bash
mkdir -p function/utils
```

**2. Copy the function files from this integration into your project:**

Copy the contents of `function/` from this integration folder into your project's `function/` directory. You need:
- `index.ts`
- `utils/open-brain-utils.ts`
- `utils/ingest-config.ts`
- `utils/sensitivity-patterns.ts`
- `utils/sensitivity-patterns.json`

**3. Set your secrets:**

```bash
supabase secrets set MCP_ACCESS_KEY=your-access-key
supabase secrets set OPENAI_API_KEY=your-openai-key
```

Or if using OpenRouter instead of OpenAI:

```bash
supabase secrets set OPENROUTER_API_KEY=your-openrouter-key
```

Optionally, for richer metadata classification:

```bash
supabase secrets set ANTHROPIC_API_KEY=your-anthropic-key
```

> [!IMPORTANT]
> Do **not** set `SUPABASE_URL` or `SUPABASE_SERVICE_ROLE_KEY` — Supabase injects these automatically into Edge Functions.

**4. Deploy:**

```bash
supabase functions deploy open-brain-rest --no-verify-jwt
```

✅ **Done when:** The deploy command completes without errors.

---

![Step 3](https://img.shields.io/badge/Step_3-Test_the_API-1E88E5?style=for-the-badge)

```bash
curl -s \
  -H "x-brain-key: YOUR_ACCESS_KEY" \
  "https://YOUR-PROJECT-REF.supabase.co/functions/v1/open-brain-rest/health"
```

Expected response:

```json
{"ok": true, "service": "open-brain-rest", "timestamp": "..."}
```

✅ **Done when:** You see `"ok": true` in the response.

## Expected Outcome

After deployment, the following endpoints are available:

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/health` | GET | Health check |
| `/thoughts` | GET | Paginated browse with filters |
| `/thought/:id` | GET | Fetch single thought |
| `/thought/:id` | PUT | Update thought |
| `/thought/:id` | DELETE | Delete thought |
| `/thought/:id/connections` | GET | Related thoughts (hybrid scoring) |
| `/thought/:id/reflection` | GET | Fetch reflections |
| `/thought/:id/reflection` | POST | Create reflection |
| `/search` | POST | Semantic + full-text search |
| `/stats` | GET | Aggregate statistics |
| `/capture` | POST | Create new thought |
| `/duplicates` | GET | Near-duplicate detection |

**Optional ingest endpoints** (require separate `smart-ingest` Edge Function):

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/ingest` | POST | Smart extraction |
| `/ingestion-jobs` | GET | List extraction jobs |
| `/ingestion-jobs/:id` | GET | Job detail |
| `/ingestion-jobs/:id/execute` | POST | Execute extraction |

The [Next.js Dashboard](../../dashboards/open-brain-dashboard-next/) can now connect to this API by setting `NEXT_PUBLIC_API_URL` in its `.env` file.

## Troubleshooting

**Issue: `401 Unauthorized` on every request**
Solution: Ensure your `x-brain-key` header value matches the `MCP_ACCESS_KEY` secret you set. Check with `supabase secrets list`.

**Issue: Capture works but metadata is sparse (no topics, type defaults to "idea")**
Solution: You're likely using only `OPENROUTER_API_KEY`, which handles embeddings but not classification. Set `OPENAI_API_KEY` (handles both) or add `ANTHROPIC_API_KEY` for the richest metadata extraction.

**Issue: Text search returns no results but semantic search works**
Solution: You may have skipped migration `05-text-search-index.sql`. Run it to create the tsvector column, GIN index, and auto-update trigger.

**Issue: `permission denied for table thoughts` or similar**
Solution: Run the GRANT statements from migration `01-schema-extensions.sql`. Supabase no longer auto-grants CRUD permissions to `service_role` on some projects.

**Issue: `/ingest` returns an error about `smart-ingest` function**
Solution: The ingest endpoint proxies to a separate `smart-ingest` Edge Function that is not included in this integration. The ingest flow is optional — all other endpoints work without it.

## Tool Surface Area

> This integration provides REST endpoints, not MCP tools — it does not add to your AI's context weight. However, if you're building on Open Brain with multiple integrations, see the [MCP Tool Audit & Optimization Guide](../../docs/05-tool-audit.md) for strategies on managing your tool count as your Open Brain grows.
