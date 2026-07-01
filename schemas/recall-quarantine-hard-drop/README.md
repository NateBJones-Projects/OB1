# Recall quarantine wrapper

## What it does

This schema package adds a read-side quarantine layer for recall. It keeps the base `thoughts` table untouched and adds:

- `recall_quarantine` for entries that should not be returned by recall
- `recall_filter_audit` for query-time exclusion evidence
- `match_thoughts_filtered`, a wrapper around `match_thoughts`

The wrapper asks the existing recall function for a larger candidate set (one underlying call per query), removes quarantined entries, writes an audit row when a query label is supplied, and returns the filtered result set.

Both new tables ship with row level security enabled. On Supabase-style setups (where a `service_role` role exists) a service-role-only policy and grant are added automatically, so a public client key can never add or remove quarantine entries. Quarantine controls what recall returns; treat write access to it like write access to memory itself.

## Prerequisites

- A local OB1-shaped Postgres database
- `pgvector` installed
- Existing `thoughts` table
- Existing `match_thoughts(query_embedding vector(1536), match_threshold float, match_count int, filter jsonb)`

## Steps

1. Apply the schema locally.

   ```bash
   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f recall_quarantine.sql
   ```

2. Add one thought to quarantine.

   ```sql
   insert into public.recall_quarantine (thought_id, reason, created_by)
   values ('00000000-0000-0000-0000-000000000001', 'review_required', 'local-test')
   on conflict (thought_id) do update
   set reason = excluded.reason,
       created_by = excluded.created_by,
       created_at = now();
   ```

3. Query through the wrapper.

   ```sql
   select *
   from public.match_thoughts_filtered(
     '[0.1,0.2,0.3]'::vector,
     0.0,
     10,
     '{}'::jsonb,
     'local-test-query'
   );
   ```

4. Inspect audit evidence.

   ```sql
   select query_label, excluded_count, excluded_thought_ids, created_at
   from public.recall_filter_audit
   order by created_at desc
   limit 5;
   ```

## Expected outcome

Quarantined thoughts are not returned by `match_thoughts_filtered`, even when the underlying `match_thoughts` function would return them. Audit rows record how many candidates were excluded.

## Troubleshooting

- If `vector` is unknown, install and enable `pgvector`.
- If `match_thoughts` is missing, apply the base recall schema first.
- If no audit rows appear, pass a non-empty `audit_query_label` argument.
- If fewer rows than expected return, increase `extra_candidate_count`.
- On plain Postgres (no `service_role` role) the policy/grant block is skipped by design; the table owner bypasses row level security. Add your own policies if other roles need access.
