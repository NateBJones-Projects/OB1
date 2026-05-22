# CRM Person Tiers

> Standalone person table with a four-tier relationship taxonomy, a mentions join table linking persons to your core `thoughts`, and an RPC that returns per-person tiers with an activity-based promotion rule.

## What It Does

This schema adds a lightweight CRM layer to Open Brain without modifying the core `thoughts` table:

- **`crm_persons`** — one row per person, with a `relationship_tier` column constrained to four values: `connected`, `contact`, `known`, `unknown`
- **`crm_person_mentions`** — join table that links a person to a `thoughts` row so mention counts can roll up without touching the core table
- **`crm_person_tiers(...)` RPC** — paginated people view that returns each person's stored `relationship_tier`, an `effective_tier` that promotes high-activity recent contacts to `connected`, the aggregated `mention_count`, and pagination metadata

The RPC gives you a ready-made backend for a "people in my brain" dashboard without having to stitch tiers together on the client.

### Tier vocabulary (most permissive first)

| Tier        | Meaning                                                         |
|-------------|-----------------------------------------------------------------|
| `connected` | Family, close contacts, or high-activity recent contacts        |
| `contact`   | In your contact list / address book                             |
| `known`     | Engaged thread (you replied) — some real interaction history    |
| `unknown`   | Seen once, no prior engagement                                  |

The `connected` promotion rule defaults to: `mention_count >= 20 AND last_seen_at >= now() - interval '7 days'`. Both knobs are RPC parameters (`p_promote_min_mentions`, `p_promote_within`), so you can retune per call.

## Prerequisites

- Working Open Brain setup ([guide](../../docs/01-getting-started.md))
- Access to your Supabase SQL Editor or CLI
- Core `thoughts` table already created

> [!IMPORTANT]
> The `crm_person_mentions.thought_id` column is typed `UUID` to match the default `thoughts.id` from the getting-started guide. If your deployment uses `BIGINT` ids instead, change the column type in `schema.sql` before running it (comment in the file flags the spot).

## Credential Tracker

Copy this block into a text editor and fill it in as you go.

```text
CRM PERSON TIERS -- CREDENTIAL TRACKER
--------------------------------------

SUPABASE (from your Open Brain setup)
  Project URL:           ____________
  Secret key:            ____________

--------------------------------------
```

## Steps

![Step 1](https://img.shields.io/badge/Step_1-Run_Migration-1E88E5?style=for-the-badge)

1. Open your **Supabase SQL Editor** (Dashboard > SQL Editor)
2. Paste and run the full contents of `schema.sql`

<details>
<summary>What the migration creates</summary>

- Table `public.crm_persons` with `relationship_tier` CHECK constraint (`connected`, `contact`, `known`, `unknown`)
- Unique index on `lower(canonical_name)` so imports don't create duplicate records
- Indexes on `relationship_tier` and `last_seen_at`
- Table `public.crm_person_mentions` (person_id + thought_id primary key)
- Trigger that auto-updates `crm_persons.updated_at`
- Function `public.crm_person_tiers(p_limit, p_offset, p_search, p_promote_min_mentions, p_promote_within)` (SECURITY INVOKER)
- Grants: tables → `service_role`; RPC execute → `authenticated` + `service_role` (no `anon`, by design — see Security below)
- `NOTIFY pgrst, 'reload schema'` so PostgREST picks up the new RPC

</details>

![Step 2](https://img.shields.io/badge/Step_2-Verify-1E88E5?style=for-the-badge)

1. Verify the tables exist:

   ```sql
   SELECT table_name
     FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name IN ('crm_persons', 'crm_person_mentions');
   ```

   You should see both rows.

2. Verify the RPC is callable:

   ```sql
   SELECT * FROM public.crm_person_tiers(p_limit := 5);
   ```

   You should get back 0 rows (expected — the table is empty) with the full column shape.

> [!TIP]
> Insert a test person to confirm the full round trip:
>
> ```sql
> INSERT INTO public.crm_persons (canonical_name, relationship_tier)
> VALUES ('Test Person', 'known');
>
> SELECT canonical_name, relationship_tier, effective_tier, mention_count
>   FROM public.crm_person_tiers(p_limit := 5);
> ```

![Step 3](https://img.shields.io/badge/Step_3-Populate-1E88E5?style=for-the-badge)

1. Insert persons however you prefer (manual SQL, an import script, an Edge Function that watches new thoughts, etc.). A minimal insert looks like:

   ```sql
   INSERT INTO public.crm_persons (canonical_name, aliases, relationship_tier)
   VALUES ('Alex Rivera', '["Alex","A. Rivera"]'::jsonb, 'contact');
   ```

2. (Optional) Link a person to a `thoughts` row so the mention count rolls up into the RPC:

   ```sql
   INSERT INTO public.crm_person_mentions (person_id, thought_id, mention_role)
   VALUES (
     (SELECT id FROM public.crm_persons WHERE canonical_name = 'Alex Rivera'),
     '<your-thought-uuid>',
     'subject'
   );
   ```

## Security

By default, `crm_person_tiers` is `SECURITY INVOKER` with `EXECUTE` granted to `authenticated` and `service_role` only (not `anon`). This is deliberate: if you ship your Supabase **anon** key to a browser or mobile app, any caller with that key could otherwise dump every person's `canonical_name`, `aliases`, and `metadata` from this table. The intended install path is:

- Call the RPC from a **server-side** client that uses the `service_role` key (Next.js server components, Edge Functions, cron jobs), or
- Call it from an **authenticated** client after you've enabled Row Level Security on `crm_persons` + `crm_person_mentions` with a policy that matches your auth model (e.g. `owner_id = auth.uid()` if you add an `owner_id` column).

If you *want* to expose the RPC to anon clients on purpose (a public "who's in this brain" page), add `GRANT EXECUTE ON FUNCTION public.crm_person_tiers(...) TO anon;` in a follow-up migration, and consider RLS policies first.

## Optional Dashboard Snippet

`dashboard-snippets/page.tsx` is a drop-in Next.js App Router page that renders the output of the RPC as a tier-grouped people list. It uses a server-side `getSupabaseServerClient()` helper (service-role recommended) to match the least-privilege grants above. See `dashboard-snippets/README.md` for install instructions — short version: copy the file into your dashboard at `app/crm/page.tsx` and update the Supabase client import path.

## Expected Outcome

After running the migration:

- Tables `crm_persons` and `crm_person_mentions` exist in the `public` schema with indexes, a CHECK constraint on `relationship_tier`, and a trigger on `updated_at`
- Function `crm_person_tiers` is callable via SQL and via the Supabase PostgREST endpoint as `/rest/v1/rpc/crm_person_tiers`
- Calling the RPC with no arguments returns persons ordered by effective tier priority, then `last_seen_at` desc, then mention count desc, then name asc
- The core `thoughts` table is unchanged

## Troubleshooting

**Issue: "relation public.crm_persons does not exist"**
Solution: The migration didn't run in the right database. Double-check you're connected to the Supabase project that hosts your `thoughts` table and re-run `schema.sql`.

**Issue: "invalid input value for relationship_tier"**
Solution: The CHECK constraint only accepts `connected`, `contact`, `known`, `unknown`. If you need a different vocabulary, edit the CHECK constraint in `schema.sql` before running it, or swap it for a lookup table.

**Issue: All rows come back with `effective_tier = 'unknown'`**
Solution: Stored `relationship_tier` defaults to `unknown` on new inserts. Update the column manually (or via your import script) when you already know the person. The "connected" promotion only fires when a person has a recent `last_seen_at` AND enough mentions — without `crm_person_mentions` rows, no one will get promoted.

**Issue: "foreign key violation" inserting into `crm_person_mentions`**
Solution: `thought_id` is not foreign-keyed to `thoughts` on purpose (the core `thoughts` table structure is not modified by this schema). The violation is therefore against `crm_persons` — confirm the `person_id` exists first.

**Issue: Dashboard page throws "crm_person_tiers RPC failed"**
Solution: Run `NOTIFY pgrst, 'reload schema';` in SQL Editor so PostgREST picks up the new function, then reload the dashboard.
