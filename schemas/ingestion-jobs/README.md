# Ingestion Jobs

> Track document ingestion through extract, deduplicate, reconcile, and execute lifecycle stages.

## What It Does

Adds two tables — `ingestion_jobs` and `ingestion_items` — plus an `append_thought_evidence` RPC that together track the full lifecycle of ingesting raw documents into the `thoughts` table. Each job represents a single ingest invocation. Each item represents an individual thought extracted from that document, along with the dedup decision and execution status.

Jobs support a **dry-run workflow**: extract and reconcile without writing to `thoughts`, review the plan, then execute the approved items in a second pass.

## Prerequisites

- Working Open Brain setup ([guide](../../docs/01-getting-started.md))
- The `thoughts` table must already exist

## Credential Tracker

Copy this block into a text editor and fill it in as you go.

```text
INGESTION JOBS -- CREDENTIAL TRACKER
--------------------------------------

SUPABASE (from your Open Brain setup)
  Project URL:           ____________
  Service role key:      ____________

--------------------------------------
```

## Schema Overview

### `ingestion_jobs` table

| Column | Type | Description |
|--------|------|-------------|
| `id` | `uuid` (PK) | Auto-generated via `gen_random_uuid()` |
| `source_label` | `text` | Human-readable label for the input source (e.g. filename, URL) |
| `input_hash` | `text` (unique) | SHA-256 hash of the input text for idempotency |
| `input_length` | `int` | Character count of the raw input |
| `status` | `text` | Lifecycle state: `pending` → `extracting` → `dry_run_complete` → `executing` → `complete` (or `failed`) |
| `extracted_count` | `int` | Total thoughts extracted by the LLM |
| `added_count` | `int` | Thoughts written as new rows |
| `skipped_count` | `int` | Thoughts skipped (duplicate or near-duplicate) |
| `appended_count` | `int` | Thoughts merged as evidence on existing rows |
| `revised_count` | `int` | Thoughts written as revisions of existing rows |
| `error_message` | `text` | Error detail when `status = 'failed'` |
| `metadata` | `jsonb` | Arbitrary structured metadata (source_type, dry_run flag, etc.) |
| `created_at` | `timestamptz` | Row creation timestamp |
| `completed_at` | `timestamptz` | Timestamp when job reached terminal state |

### `ingestion_items` table

| Column | Type | Description |
|--------|------|-------------|
| `id` | `uuid` (PK) | Auto-generated via `gen_random_uuid()` |
| `job_id` | `uuid` (FK) | References `ingestion_jobs(id)`, cascading delete |
| `extracted_content` | `text` | The atomic thought content extracted by the LLM |
| `action` | `text` | Reconciliation decision: `add`, `skip`, `append_evidence`, `create_revision` |
| `status` | `text` | Execution state: `pending`, `ready`, `executed`, `failed` |
| `reason` | `text` | Why this action was chosen (e.g. `fingerprint_match`, `no_semantic_match`) |
| `matched_thought_id` | `uuid` | ID of the existing thought this item matched against, if any |
| `similarity_score` | `numeric(5,4)` | Cosine similarity to the matched thought (NULL if no match) |
| `result_thought_id` | `uuid` | ID of the thought created or updated by execution |
| `error_message` | `text` | Error detail when `status = 'failed'` |
| `metadata` | `jsonb` | Arbitrary structured metadata (type classification, etc.) |
| `created_at` | `timestamptz` | Row creation timestamp |

### `append_thought_evidence` RPC

Appends a corroborating evidence entry to `metadata.evidence[]` on an existing thought. Idempotent via SHA-256 identity of the source label, excerpt, and thought ID combined. Safe to call multiple times with the same input.

## Steps

**1. Open the Supabase SQL Editor**

Go to your Supabase Dashboard → SQL Editor → New query.

**2. Run the migration**

Copy the contents of [`migration.sql`](./migration.sql) and execute it in the SQL Editor.

**3. Verify the tables exist**

Run this query to confirm:

```sql
select table_name from information_schema.tables
where table_schema = 'public'
  and table_name in ('ingestion_jobs', 'ingestion_items');
```

You should see both tables listed.

**4. Verify the RPC exists**

```sql
select routine_name from information_schema.routines
where routine_schema = 'public'
  and routine_name = 'append_thought_evidence';
```

**5. Test with a sample job**

```sql
-- Create a test job
insert into public.ingestion_jobs (input_hash, source_label, status)
values ('test-hash-123', 'test document', 'pending')
returning id;

-- Create a test item (use the job id from above)
insert into public.ingestion_items (job_id, extracted_content, action, status, reason)
values ('<job-id>', 'Test thought content', 'add', 'ready', 'no_semantic_match');

-- Clean up
delete from public.ingestion_jobs where input_hash = 'test-hash-123';
```

## Expected Outcome

After running the migration:

- Two new tables: `ingestion_jobs` and `ingestion_items`
- One new RPC: `append_thought_evidence`
- One index: `ingestion_items_job_id_idx`
- Row-level security enabled on both tables (service-role access only)
- The `input_hash` unique constraint prevents duplicate job creation for the same input document

## Design Notes

- All IDs are `uuid` to match Open Brain's standard ID types.
- `input_hash` has a unique constraint for idempotency — submitting the same document twice returns the existing job instead of creating a duplicate.
- The `action` field on items captures the reconciliation decision *before* execution, making dry-run previews possible. The `status` field tracks whether that decision has been carried out.
- `matched_thought_id` and `result_thought_id` are nullable `uuid` references rather than formal foreign keys, allowing the schema to work even if referenced thoughts are deleted.

## Troubleshooting

**Issue: `relation "public.thoughts" does not exist`**
Solution: You need to complete your Open Brain setup first. The `thoughts` table must exist before applying this migration. Follow the [Getting Started guide](../../docs/01-getting-started.md).

**Issue: `duplicate key value violates unique constraint "ingestion_jobs_input_hash_key"`**
Solution: This means you've already ingested this exact document. Query the existing job: `select * from ingestion_jobs where input_hash = '<hash>';`. If you want to reprocess, use a versioned hash (e.g. append `-v2`).

**Issue: `append_thought_evidence` returns `thought not found`**
Solution: The thought ID you passed doesn't exist in the `thoughts` table. Verify the ID is correct: `select id from thoughts where id = '<uuid>';`.
