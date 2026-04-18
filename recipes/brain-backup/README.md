# Brain Backup and Export

Export all Open Brain Supabase tables to local JSON files. The script paginates through PostgREST (1 000 rows per request), writes each table to a dated JSON file, and prints a summary.

## Prerequisites

- An Open Brain setup with a running Supabase project
- Node.js 18 or later
- A `.env.local` file in the recipe directory (or exported environment variables) containing:
  - `SUPABASE_URL` -- your Supabase project URL
  - `SUPABASE_SERVICE_ROLE_KEY` -- a service-role key for the project

## Steps

1. Copy or create a `.env.local` file in this directory with your credentials:

   ```
   SUPABASE_URL=https://your-project.supabase.co
   SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
   ```

2. Run the backup script:

   ```bash
   node backup-brain.mjs
   ```

3. The script creates a `backup/` folder and writes one JSON file per table, named `<table>-YYYY-MM-DD.json`.

4. Review the printed summary to confirm all tables exported successfully.

## Expected Result

After running the script you will have a `backup/` directory containing dated JSON exports of every Open Brain table present in your project.

- `thoughts` is always backed up (required).
- Optional companion tables — `entities`, `edges`, `thought_entities`, `ingestion_jobs`, `ingestion_items` — are backed up only if they exist. They ship with companion contributions (e.g. the entity-extraction and smart-ingest schemas). Stock Open Brain installs will see `skipped (table not present)` for those, which is expected.

The console output shows row counts and file sizes for each table, making it easy to verify the backup is complete.

## Tips

- Schedule the script with cron or Task Scheduler for automatic daily backups.
- Commit the `backup/` directory to a private repo for versioned history.
- The script streams rows to disk, so it handles large tables without running out of memory.

## Troubleshooting

- **`PostgREST error 404 on thoughts`** -- the script could reach the server but the `thoughts` table isn't visible to it. Only a PostgREST "schema cache" 404 (`code: "PGRST205"`) is treated as "table not present"; everything else is surfaced so you can diagnose it. Common causes:
  - Typo in `SUPABASE_URL` (for example pointing at `/v1` instead of the project root -- the script appends `/rest/v1` itself).
  - Supabase project is paused or deleted.
  - The `thoughts` table lives in a non-`public` schema that PostgREST isn't exposing.
  - You're using the `anon` key instead of the `service_role` key. The anon key can be restricted by RLS and return empty or 404 responses; service-role keys bypass RLS.
- **`skipped (table not present)` for optional tables** -- expected on stock Open Brain installs. The optional tables ship with companion contributions (entity extraction, smart ingest).
- **`PostgREST error 401`** -- `SUPABASE_SERVICE_ROLE_KEY` is wrong, revoked, or truncated.
- **`PostgREST error 403`** -- unusual for service-role keys, which should bypass RLS. Double-check you're not using a custom-minted JWT with narrower claims.
- **Script hangs or aborts after ~60s** -- set `FETCH_TIMEOUT_MS` to a larger value (milliseconds) if your project is on a slow tier or has very large tables.
