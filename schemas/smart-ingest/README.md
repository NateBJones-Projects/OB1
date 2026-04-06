# Smart Ingest Pipeline Tables

> Adds pipeline tables for tracking bulk text ingestion through the extract, deduplicate, and execute lifecycle.

## What It Does

This schema adds two tables and one RPC function that together support a structured ingestion pipeline for Open Brain:

- **`ingestion_jobs`** -- Tracks each ingest invocation from submission through extraction, deduplication, and execution. Stores input hash for idempotency, status lifecycle, and per-action counters (added, skipped, appended, revised).
- **`ingestion_items`** -- Stores individual extracted thoughts within a job. Each item records the reconciliation action chosen during dedup (add, skip, append_evidence, create_revision), the reason for that choice, any matched existing thought, and the execution result.
- **`append_thought_evidence`** -- An RPC function that appends evidence entries to a thought's `metadata.evidence[]` array. Uses SHA256 identity hashing to prevent duplicate evidence, making it safe to call repeatedly.

## Prerequisites

- Working Open Brain setup (see the getting-started guide in `docs/01-getting-started.md`)
- Supabase project with the `thoughts` table, `match_thoughts` function, and `upsert_thought` function already created
- Enhanced thoughts schema applied (see `schemas/enhanced-thoughts/`)

## Credential Tracker

Copy this block into a text editor and fill it in as you go.

```text
SMART INGEST -- CREDENTIAL TRACKER
-----------------------------------

SUPABASE (from your Open Brain setup)
  Project URL:           ____________
  Secret key:            ____________

-----------------------------------
```

## Steps

1. Open your Supabase dashboard and navigate to the **SQL Editor**
2. Create a new query and paste the full contents of `schema.sql`
3. Click **Run** to execute the migration
4. Open **Table Editor** and confirm two new tables appear: `ingestion_jobs` and `ingestion_items`
5. Navigate to **Database > Functions** and verify the `append_thought_evidence` function exists
6. Test the function by running a quick validation query in the SQL Editor:

   ```sql
   SELECT count(*) FROM ingestion_jobs;
   -- Should return 0 for a fresh install
   ```

## Expected Outcome

After running the migration:

- Two new tables: `ingestion_jobs` (tracks job lifecycle with status, counters, and metadata) and `ingestion_items` (stores extracted thoughts with action codes, dedup reasons, and execution results).
- One index on `ingestion_items(job_id)` for fast job-to-item lookups.
- One RPC function `append_thought_evidence(bigint, jsonb)` that idempotently appends evidence entries to a thought's metadata.
- Service role has full access to both tables and their sequences. The RPC function is callable by authenticated, anonymous, and service role clients.

## Troubleshooting

**Issue: "relation already exists" warnings**
Solution: These are safe to ignore. The `CREATE TABLE IF NOT EXISTS` syntax prevents errors but may log informational notices. The migration is fully idempotent.

**Issue: append_thought_evidence raises "thought not found"**
Solution: The function requires a valid thought ID. Confirm the thought exists in the `thoughts` table before calling the function. This error means the referenced thought was deleted or the ID is incorrect.

**Issue: ingestion_items not linked to a job**
Solution: Items require a valid `job_id` foreign key referencing `ingestion_jobs`. Create the job first, then insert items with the returned job ID. The foreign key uses `ON DELETE CASCADE`, so deleting a job automatically removes its items.

**Issue: duplicate input_hash error on ingestion_jobs insert**
Solution: The `input_hash` column has a `UNIQUE` constraint to prevent processing the same text twice. If you need to reprocess the same input, delete the existing job first or use a different hash (e.g., by appending a timestamp to the input before hashing).
