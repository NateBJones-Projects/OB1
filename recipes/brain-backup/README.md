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

After running the script you will have a `backup/` directory containing dated JSON exports of every Open Brain table (thoughts, entities, edges, thought_entities, reflections, ingestion_jobs, ingestion_items). The console output shows row counts and file sizes for each table, making it easy to verify the backup is complete.

## Tips

- Schedule the script with cron or Task Scheduler for automatic daily backups.
- Commit the `backup/` directory to a private repo for versioned history.
- The script streams rows to disk, so it handles large tables without running out of memory.
