# Mass-Delete Guard + Delete Audit

> A database-layer safety net for `public.thoughts`: block any single `DELETE` that removes more than 50 rows, require an explicit privileged opt-in for legitimate bulk deletes, and audit every override.

## What It Does

Open Brain's contribution guard rails forbid an unqualified `DELETE FROM` in any SQL file. That rule protects the repo, but it does nothing once your install is live — a stray script, a bad `WHERE` clause, or a runaway agent can still wipe your memory in one statement. This schema moves that protection into the database itself, so it applies to every delete from every client.

It installs:

- A statement-level `AFTER DELETE` trigger on `public.thoughts` that reads the server-computed count of rows the current `DELETE` statement removed and **blocks any single statement that deletes more than 50 rows**. Single-row deletes and small batches keep working untouched.
- An explicit **per-transaction override** so an admin can still run a legitimate large delete on purpose: set `app.allow_mass_delete = 'on'` for that transaction *and* call from a privileged role, and the guard stands down for that statement. The override is scoped to the transaction (via `SET LOCAL`) and cannot leak to other sessions.
- A `thoughts_delete_audit` table that records every override event with the caller's identity (role, session user, client address, JWT claims, transaction id) for forensics. The sampled deleted thought id is stored as **UUID**, matching `public.thoughts.id`.

The threshold of 50 is a constant in the guard function; change the `v_limit` literal in [`schema.sql`](./schema.sql) to tune it.

### Why statement-level (not per-transaction)

The guard counts rows **per `DELETE` statement**, using PostgreSQL's server-computed transition table — a count the caller cannot tamper with. A per-transaction counter would have to live in a temp table or a custom setting, both of which a SQL-capable role can pre-seed to bypass the guard. The real danger this protects against — an unqualified `DELETE FROM public.thoughts`, a too-broad `WHERE`, or a runaway script issuing one large delete — is a single statement, which is exactly what gets blocked. A caller who deliberately loops many ≤50-row statements is past the accident this guards against; the override path exists for legitimate bulk work.

### What gets audited, and what doesn't

- **Override events commit and are row-audited.** When an admin opts in and the bulk delete succeeds, the transaction commits, so its audit row in `thoughts_delete_audit` is durable and queryable. The guard writes exactly **one** override row per transaction (on the first row past the limit), not one per deleted row.
- **Blocked attempts are not row-audited.** A blocked delete raises an exception, which aborts the whole transaction — any audit row written inside it would roll back too (PostgreSQL has no built-in autonomous transactions). Instead the block surfaces in the **Postgres server log** as the `RAISE EXCEPTION` text, with the deleting role attached to the log line. On Supabase that appears under **Logs → Postgres**. This is intentional: the durable, queryable record is the set of overrides; blocked attempts are failures that left no data change, and the server log is the right place for them.

### Reading the audit table

`current_role` and `current_user` inside the guard return the function's **definer** (the table owner), because the guard runs `SECURITY DEFINER` so its audit insert always succeeds. To see **who actually ran the delete**, read the `session_user_name` column — it captures the real calling role.

## Prerequisites

- A working Open Brain setup with the canonical `public.thoughts` table ([getting-started guide](../../docs/01-getting-started.md)).
- `public.thoughts.id` is `UUID` (the canonical Open Brain type). If you run a non-canonical `BIGINT` id, see [ID Type Note](#id-type-note).
- Access to the Supabase SQL Editor (or the Supabase CLI) with the service role.
- A `service_role` role (Supabase provides this by default).

## Steps

1. Open your **Supabase SQL Editor** (Dashboard → SQL Editor).
2. Paste the full contents of [`schema.sql`](./schema.sql) and run it. The script is idempotent — it uses `CREATE TABLE IF NOT EXISTS`, `CREATE OR REPLACE FUNCTION`, and `DROP TRIGGER IF EXISTS … ; CREATE TRIGGER`, so re-running it is safe.
3. Confirm the trigger is attached:

   ```sql
   SELECT tgname, tgenabled
   FROM pg_trigger
   WHERE tgname = 'trg_thoughts_delete_guard';
   ```

4. (Optional) Confirm the audit table exists and is service-role only:

   ```sql
   SELECT grantee, privilege_type
   FROM information_schema.role_table_grants
   WHERE table_name = 'thoughts_delete_audit';
   ```

Or, if you keep migrations in `supabase/migrations/`, apply via the CLI:

```bash
supabase db push
```

## How to Use It

### Normal deletes (no change)

Deleting one thought, or any batch of 50 or fewer in a single statement, works exactly as before:

```sql
-- Fine: single row
DELETE FROM public.thoughts WHERE id = '00000000-0000-0000-0000-000000000000';

-- Fine: small batch (<= 50 rows)
DELETE FROM public.thoughts WHERE metadata->>'source' = 'scratch' LIMIT 50;
```

### A delete that trips the guard

If a single statement tries to delete more than 50 rows without the override, it is rejected and nothing is deleted:

```sql
DELETE FROM public.thoughts WHERE created_at < now() - interval '1 year';
-- ERROR: Mass delete blocked: a single statement cannot delete more than 50
--        thoughts (attempted 5123). Delete in smaller batches, or a privileged
--        admin can opt in for this transaction with:
--        SET LOCAL app.allow_mass_delete = 'on';
```

### Overriding the guard for a legitimate bulk delete

When you genuinely need to delete more than 50 rows, opt in for that transaction. The override requires **both** the opt-in flag **and** a genuinely trusted *effective* request role — either a request running as `service_role` (the role PostgREST switches into from a `service_role` JWT), or a direct connection as a superuser or `service_role` (superuser `psql`, the Supabase SQL editor, or a dedicated `service_role` login). See [`thoughts_delete_override_allowed()`](./schema.sql). Setting the flag from a plain `anon`/`authenticated` PostgREST request does **not** lift the guard — and crucially, it stays blocked even when Supabase's shared `authenticator` login inherits `service_role`, because the check reads the role the request is actually *running as* (the `SET ROLE` target, which a caller can only reach for a role it truly belongs to), not the login that *could* switch into `service_role`. When both conditions hold, the delete proceeds and a single override row is written to `thoughts_delete_audit`:

```sql
BEGIN;
SET LOCAL app.allow_mass_delete = 'on';   -- scoped to THIS transaction only
DELETE FROM public.thoughts WHERE created_at < now() - interval '1 year';
COMMIT;
```

Because the flag is set with `SET LOCAL`, it is automatically forgotten at the end of the transaction — you cannot accidentally leave the guard disabled. To widen or narrow who may override, edit `thoughts_delete_override_allowed()` in [`schema.sql`](./schema.sql).

### Reviewing overrides

```sql
SELECT attempted_at, session_user_name, actor_role, client_addr, row_data
FROM public.thoughts_delete_audit
WHERE operation = 'MASS_DELETE_OVERRIDE'
ORDER BY attempted_at DESC;
```

To review **blocked** attempts, check the Postgres server log (Supabase: **Logs → Postgres**) and search for `Mass delete blocked`.

## Expected Outcome

After running the migration:

- A trigger `trg_thoughts_delete_guard` exists on `public.thoughts` (`AFTER DELETE`, `FOR EACH STATEMENT`, with an `OLD` transition table).
- A function `public.thoughts_delete_guard()` exists (`SECURITY DEFINER`, `search_path = public`), plus a helper `public.thoughts_delete_override_allowed()`.
- A table `public.thoughts_delete_audit` exists with `thought_id UUID` and the forensic columns, granted `SELECT, INSERT` to `service_role` and locked down for everyone else: privileges are revoked from `PUBLIC` *and* explicitly from `anon`/`authenticated` (so a blanket `ALTER DEFAULT PRIVILEGES … GRANT ALL … TO anon, authenticated` cannot expose it), with row-level security enabled and no permissive policy as a default-deny backstop.
- Deleting 1–50 thoughts in a single statement behaves exactly as before.
- A single statement deleting more than 50 thoughts is blocked and rolled back, with the block logged to the Postgres server log.
- Setting `app.allow_mass_delete = 'on'` from a privileged role allows the bulk delete and records one `MASS_DELETE_OVERRIDE` row in `thoughts_delete_audit`.
- No column on `public.thoughts` is altered or dropped — the change is purely additive.
- PostgREST's schema cache is reloaded (`NOTIFY pgrst, 'reload schema'`).

## ID Type Note

This schema assumes `public.thoughts.id` is `UUID`, the canonical Open Brain type. The audit table stores the deleted thought id as `thought_id uuid`. If you run a non-canonical install where `thoughts.id` is `BIGINT`, change `thought_id uuid` to `thought_id bigint` in the audit table definition in [`schema.sql`](./schema.sql) before running it. No other change is required — the guard logic does not depend on the id type.

## Rollback

To remove the guard and its audit table:

```sql
DROP TRIGGER IF EXISTS trg_thoughts_delete_guard ON public.thoughts;
DROP FUNCTION IF EXISTS public.thoughts_delete_guard();

-- The line below drops the audit history. Omit it if you want to keep the
-- override records after removing the guard.
DROP TABLE IF EXISTS public.thoughts_delete_audit;

NOTIFY pgrst, 'reload schema';
```

> [!CAUTION]
> Dropping the trigger removes the mass-delete protection. After rollback, an unqualified `DELETE FROM public.thoughts` will succeed and delete everything. Keep the guard installed on production memory.

## Troubleshooting

**Issue: a legitimate bulk delete is blocked.**
Wrap it in a transaction and set `app.allow_mass_delete = 'on'` with `SET LOCAL` (see [Overriding the guard](#overriding-the-guard-for-a-legitimate-bulk-delete)). The override is audited.

**Issue: the audit table is empty after a blocked delete.**
Expected. Blocked attempts roll back, so they are not row-audited; look in the Postgres server log instead. Only successful overrides are recorded in `thoughts_delete_audit`.

**Issue: `actor_role`/`actor_user` always show the same role.**
That is the `SECURITY DEFINER` owner. Read `session_user_name` for the real calling role.

**Issue: PostgREST still does not see the new table.**
The migration emits `NOTIFY pgrst, 'reload schema'`. If it does not take effect, reload from Dashboard → Project Settings → API → Reload schema.

## More from Nate

Open Brain is built in the open by Nate B. Jones — more practical systems like this on his [Substack](https://substack.com/@natesnewsletter) and at [natebjones.com](https://natebjones.com).
