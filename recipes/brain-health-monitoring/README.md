# Brain Health Monitoring

> SQL views and runbook for monitoring source volumes, enrichment gaps, ingestion pipeline health, stalled queues, and knowledge graph coverage.

## What It Does

Adds 8 monitoring views to your Open Brain database that answer the most common operational questions:

| View | What It Shows |
|------|---------------|
| `ops_source_volume_24h` | Thought counts per source in the last 24 hours |
| `ops_recent_thoughts` | Latest thoughts with type, source, enrichment status, and preview |
| `ops_enrichment_gaps` | Thoughts that haven't been enriched yet |
| `ops_type_distribution` | Type breakdown (all-time, 7-day, 24-hour windows) |
| `ops_sensitivity_distribution` | Sensitivity tier breakdown |
| `ops_ingestion_summary` | Ingestion job status and counts (requires `schemas/smart-ingest`) |
| `ops_stalled_entity_queue` | Queue items stuck or permanently failed (requires `schemas/entity-extraction`) |
| `ops_graph_coverage` | Entity extraction progress and coverage percentage (requires `schemas/entity-extraction`) |

Views 1-5 work with the base enhanced thoughts schema. Views 6-8 are wrapped in `to_regclass` guards, so the SQL file runs cleanly on any shape of install — missing optional tables produce a `NOTICE` and the corresponding view is skipped rather than failing.

## Prerequisites

- Working Open Brain setup ([guide](../../docs/01-getting-started.md))
- **Enhanced thoughts schema** applied — install `schemas/enhanced-thoughts` (required for all views)
- Optional: `schemas/smart-ingest` for the ingestion summary view (view 6)
- Optional: `schemas/entity-extraction` for the stalled queue and graph coverage views (views 7-8)

## Steps

1. Review which monitoring views apply to your installed schemas.
2. Run `ops-views.sql` in the Supabase SQL Editor.
3. Verify the `ops_*` views were created successfully.
4. Query the views to establish a baseline health check.

### 1. Review the SQL File

Open `ops-views.sql` and check which views apply to your setup:

- **Views 1-5** (source volume, recent thoughts, enrichment gaps, type/sensitivity distribution): Work with any Open Brain install that has the enhanced thoughts schema.
- **View 6** (ingestion summary): Requires the `ingestion_jobs` table from `schemas/smart-ingest`.
- **Views 7-8** (stalled queue, graph coverage): Require the `entity_extraction_queue` table from `schemas/entity-extraction`.

You do not need to comment anything out. Views 6-8 are wrapped in `to_regclass` guards; if the underlying tables are missing, the DO blocks emit a `NOTICE` and skip the view without aborting the file.

### 2. Run the SQL

In the Supabase SQL Editor, paste the contents of `ops-views.sql` and execute. All statements use `CREATE OR REPLACE VIEW`, so running multiple times is safe.

```bash
# Or via psql:
psql "$DATABASE_URL" -f ops-views.sql
```

### 3. Verify Views Exist

```sql
SELECT table_name
FROM information_schema.views
WHERE table_schema = 'public'
  AND table_name LIKE 'ops_%'
ORDER BY table_name;
```

You should see between 5 and 8 views depending on which schemas are installed.

### 4. Run Your First Health Check

```sql
-- How many thoughts arrived in the last 24 hours, by source?
SELECT * FROM ops_source_volume_24h;

-- How many thoughts are waiting for enrichment?
SELECT count(*) AS unenriched FROM ops_enrichment_gaps;

-- What's the type distribution?
SELECT * FROM ops_type_distribution;
```

## Runbook: What "Healthy" Looks Like

### Fresh Install (< 100 thoughts)

- `ops_source_volume_24h`: 0-10 thoughts, mostly from `mcp` or `rest_api`
- `ops_enrichment_gaps`: May show all thoughts if enrichment hasn't run yet — this is normal
- `ops_type_distribution`: Mostly `idea` (default type before enrichment)
- `ops_sensitivity_distribution`: All `standard` unless you've captured sensitive content

### Established Brain (1000+ thoughts)

- `ops_source_volume_24h`: Regular flow from expected sources. If a source drops to 0, check the capture pipeline.
- `ops_enrichment_gaps`: Should be near 0 if the enrichment pipeline is active. A growing backlog means enrichment is stalled.
- `ops_type_distribution`: Diverse types across `idea`, `decision`, `lesson`, `reference`, `person_note`, etc. If everything is `idea`, the classifier may not be running.
- `ops_sensitivity_distribution`: Mostly `standard` with some `personal`. A spike in `restricted` is worth investigating.
- `ops_ingestion_summary`: Mostly `complete` jobs. `failed` jobs need error investigation.
- `ops_graph_coverage`: `coverage_pct` should climb toward 100% over time. Stalled at a low percentage means the entity worker isn't running.
- `ops_stalled_entity_queue`: Should be empty. Items here need manual intervention (reset `processing` items, investigate `failed` items).

### Common Remediation Actions

| Symptom | Action |
|---------|--------|
| Source volume dropped to 0 | Check the capture integration (MCP server, REST API, webhook) |
| Large enrichment gap | Run the thought enrichment pipeline (`recipes/thought-enrichment`) |
| All types are "idea" | Verify the LLM classifier is configured (`OPENROUTER_API_KEY` set) |
| Stalled queue items | Reset with: `UPDATE entity_extraction_queue SET status = 'pending' WHERE status = 'processing' AND started_at < now() - interval '10 minutes'` |
| Failed queue items | Check `last_error` column. Common: LLM rate limits, empty content |
| Low graph coverage | Run the entity extraction worker (`integrations/entity-extraction-worker`) |

## Expected Outcome

After running the SQL, you should be able to query any `ops_*` view from the Supabase SQL Editor, your dashboard, or the REST API to get a real-time picture of your brain's health. These views are also available through PostgREST if you need to query them programmatically.

## Troubleshooting

**"relation ops_ingestion_summary does not exist"**
The `ingestion_jobs` table isn't installed, so the guarded DO block skipped view 6 and emitted a `NOTICE`. Install `schemas/smart-ingest` and re-run `ops-views.sql` to create the view.

**"relation ops_stalled_entity_queue does not exist" or "relation ops_graph_coverage does not exist"**
The `entity_extraction_queue` table isn't installed, so views 7-8 were skipped. Install `schemas/entity-extraction` and re-run `ops-views.sql`.

**Views return empty results**
This is normal for a fresh install with no thoughts. Capture a few thoughts first, then query the views.

**Permission denied on a view**
Ensure the GRANT statements at the end of the SQL file executed successfully. Re-run them if needed.
