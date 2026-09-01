# Smart Ingest Tables

> Track dry-run import jobs, extracted items, review status, and execution counts.

## What It Does

This schema adds `public.ingestion_jobs` and `public.ingestion_items` for import workflows that need a reviewable dry run before writing new thoughts. It also adds helper RPCs for recounting job results and appending concise evidence to existing thoughts.

It is the database dependency for the [`integrations/smart-ingest`](../../integrations/smart-ingest/README.md) Edge Function. Install this schema before deploying that integration.

The schema stores extracted thought candidates and source metadata, not full raw transcripts. Items default to `review_status = 'unreviewed'` so inferred or generated memory remains evidence-grade until reviewed.

## Prerequisites

- Working Open Brain setup ([guide](../../docs/01-getting-started.md))
- Supabase project with SQL Editor access
- Existing `public.thoughts` table
- Service-role access for backend import workers

## Credential Tracker

```text
SMART INGEST TABLES -- CREDENTIAL TRACKER
-----------------------------------------

FROM YOUR OPEN BRAIN SETUP
  Supabase Project URL:      ____________
  Supabase Service Role Key: ____________

SETUP
  SQL migration applied:     yes / no
  Test job cleaned up:       yes / no

-----------------------------------------
```

## Steps

1. Open your Supabase project.

2. Go to SQL Editor and create a new query.

3. Copy and run [`schema.sql`](./schema.sql).

4. Verify the tables exist:

   ```sql
   select table_name
   from information_schema.tables
   where table_schema = 'public'
     and table_name in ('ingestion_jobs', 'ingestion_items');
   ```

5. Verify the helper functions exist:

   ```sql
   select routine_name
   from information_schema.routines
   where routine_schema = 'public'
     and routine_name in ('recount_ingestion_job', 'append_thought_evidence');
   ```

6. Create a dry-run test job:

   ```sql
   insert into public.ingestion_jobs (
     source_type,
     source_label,
     input_hash,
     input_length,
     dry_run,
     status
   )
   values (
     'manual-test',
     'Manual schema test',
     'sha256:test-ingestion-job',
     42,
     true,
     'pending'
   )
   returning id;
   ```

7. Add one reviewable item using the returned job ID:

   ```sql
   insert into public.ingestion_items (
     job_id,
     sequence,
     extracted_content,
     content_fingerprint,
     action,
     status,
     reason,
     review_status
   )
   values (
     '<job-id>',
     1,
     'Use dry-run import review before writing migrated records.',
     'sha256:test-item',
     'add',
     'ready',
     'manual_schema_test',
     'unreviewed'
   );
   ```

8. Clean up the test job:

   ```sql
   delete from public.ingestion_jobs
   where input_hash = 'sha256:test-ingestion-job';
   ```

## Expected Outcome

After setup, your database has:

- `public.ingestion_jobs`
- `public.ingestion_items`
- `public.recount_ingestion_job(uuid)`
- `public.append_thought_evidence(uuid, jsonb)`
- RLS enabled on both tables
- Service-role grants for backend import workers

The normal lifecycle is:

```text
pending -> converting -> validating -> extracting -> reconciling
        -> dry_run_complete -> approved -> executing -> complete
```

Failed or cancelled jobs use `failed` or `cancelled`.

## Lifecycle Notes

`ingestion_jobs.dry_run` defaults to `true`. A backend can create jobs and items, reconcile each item to an action, then stop at `dry_run_complete` for human review. Execution happens later after approved items are marked ready.

`ingestion_items.action` describes what should happen:

| Action | Meaning |
| ------ | ------- |
| `add` | Create a new thought. |
| `skip` | Do not write because the item is duplicate or low value. |
| `append_evidence` | Add concise evidence to an existing thought. |
| `create_revision` | Create a revised thought derived from an existing one. |

`review_status` is separate from execution status. New items are `unreviewed` by default.

`sequence` is an optional ordinal for manual or advanced import flows. The `smart-ingest` Edge Function does not set it (it orders items by `id`), so it stays nullable; when you do supply a value it must be unique within a job.

## Security Model

Both helper functions are `SECURITY INVOKER` and their `EXECUTE` grant is limited to `service_role`, with `EXECUTE` revoked from `public`. They run with the caller's privileges rather than the definer's, so they carry no privilege-escalation surface. `service_role` already holds the table grants this schema sets plus write access to `public.thoughts`, which is all the functions need. The tables themselves have RLS enabled and revoke all access from `anon` and `authenticated`; only backend workers using the service role touch this data.

## What This Does Not Do

- It does not import records by itself.
- It does not generate embeddings.
- It does not call an LLM.
- It does not include dashboard screens.

Those behaviors belong to the `integrations/smart-ingest` Edge Function and later ingestion work.

## Troubleshooting

**Issue: `relation "public.thoughts" does not exist`**
Solution: Complete the Open Brain setup first. The helper evidence RPC expects the core `thoughts` table.

**Issue: duplicate input hash**
Solution: The same source hash already has a job. Query `public.ingestion_jobs` by `source_type` and `input_hash` to inspect the existing dry run.

**Issue: evidence excerpt is too long**
Solution: Store a concise excerpt. Do not append raw transcripts or large source documents as evidence.

## Related

This schema is the database dependency for the [`integrations/smart-ingest`](../../integrations/smart-ingest/README.md) Edge Function.

## More from Nate

Open Brain is built in the open by Nate B. Jones. For more practical systems like this, see his [Substack](https://substack.com/@natesnewsletter) and [natebjones.com](https://natebjones.com).
