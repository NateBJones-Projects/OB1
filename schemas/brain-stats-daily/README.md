# Brain Stats Daily + Heatmap RPCs

> Adds server-side daily-bucket aggregation RPCs so dashboard heatmaps work over multi-year windows without hitting PostgREST's default row cap.

## What It Does

Installs four Postgres functions that return daily capture counts for the `thoughts` table — both as `(date, count)` row sets and as a single JSONB array. The JSONB variants exist specifically to bypass PostgREST's default `db-max-rows=1000` cap so a 1-year or 10-year heatmap works end-to-end.

- **`brain_stats_daily(p_days, p_source_type, p_exclude_restricted)`** — Daily counts bucketed by `thoughts.created_at`. Used for "capture activity" heatmaps.
- **`brain_stats_daily_lifelog(p_days, p_exclude_restricted)`** — Daily counts for dated-event source types (LifeLog, Limitless, ChatGPT/Claude/Gemini imports, journal imports), bucketed by metadata life-date fields (`event_at`, `life_date`, `conversation_created_at`, `source_date`, etc., with `created_at` as the final fallback).
- **`brain_stats_daily_jsonb(...)`** and **`brain_stats_daily_lifelog_jsonb(...)`** — JSONB return-type variants. Return a single jsonb array so a multi-year window fits in one response row.

The RPCs read `source_type` and `sensitivity_tier` columns from the [enhanced-thoughts schema](../enhanced-thoughts/) — install that schema first, then this one.

## Prerequisites

- Working Open Brain setup ([guide](../../docs/01-getting-started.md)) with the core `thoughts` table.
- The [enhanced-thoughts](../enhanced-thoughts/) schema, which adds the `source_type` and `sensitivity_tier` columns these RPCs read. Install it first — if those columns are missing, the RPCs will error the first time you call them (PL/pgSQL validates column references at execution, not at `CREATE FUNCTION`).
- **Optional:** the [open-brain-dashboard-next](../../dashboards/open-brain-dashboard-next/) dashboard if you want the `HeatmapSourceFilter` component wired up — see the snippet README at [`dashboard-snippets/README.md`](dashboard-snippets/README.md).

## Security Model

All four RPCs run as `SECURITY INVOKER`, so they respect whatever Row Level Security policies you've put on the `thoughts` table. Execute is granted to the `authenticated` and `service_role` roles only — **not `anon`**. If you want an unauthenticated public dashboard to read these aggregates, review your RLS policy first and then grant `anon` yourself, e.g.:

```sql
grant execute on function public.brain_stats_daily(integer, text, boolean) to anon;
grant execute on function public.brain_stats_daily_jsonb(integer, text, boolean) to anon;
-- (repeat for the _lifelog and _lifelog_jsonb variants if needed)
```

Leaving `anon` off is the safer default — even aggregate counts can leak activity patterns of a private brain.

## Credential Tracker

Copy this block into a text editor and fill it in as you go.

```text
BRAIN STATS DAILY -- CREDENTIAL TRACKER
--------------------------------------

SUPABASE (from your Open Brain setup)
  Project URL:           ____________
  Secret key:            ____________

--------------------------------------
```

## Steps

1. Open your Supabase dashboard and navigate to the **SQL Editor**.
2. Create a new query and paste the full contents of [`schema.sql`](schema.sql).
3. Click **Run** to execute the migration. It's idempotent — safe to run again later if you reinstall.
4. Navigate to **Database → Functions** and verify the four new functions exist:
   - `brain_stats_daily`
   - `brain_stats_daily_lifelog`
   - `brain_stats_daily_jsonb`
   - `brain_stats_daily_lifelog_jsonb`
5. Test a call from the SQL Editor:

   ```sql
   select * from brain_stats_daily(30);
   select brain_stats_daily_jsonb(365);
   ```

6. (Optional) Call the JSONB variant from your dashboard via the Supabase REST API to confirm it's reachable:

   ```bash
   curl -s "$SUPABASE_URL/rest/v1/rpc/brain_stats_daily_jsonb" \
     -H "apikey: $SUPABASE_ANON_KEY" \
     -H "Authorization: Bearer $SUPABASE_ANON_KEY" \
     -H "Content-Type: application/json" \
     -d '{"p_days": 180}'
   ```

7. (Optional) Wire up the source-filter pill row — see [`dashboard-snippets/README.md`](dashboard-snippets/README.md) for copy-paste instructions for `open-brain-dashboard-next`.

## Expected Outcome

After running the migration:

- Four RPC functions exist in the `public` schema, all callable via the Supabase client or REST API.
- `brain_stats_daily(30)` returns one row per day with non-zero captures in the last 30 days.
- `brain_stats_daily_jsonb(3650)` returns a 10-year window as a single jsonb array (not clipped by PostgREST's row cap).
- Passing `p_source_type => 'chatgpt_import'` filters the results to a single source (uses the `source_type` column from `enhanced-thoughts`).
- Any existing `thoughts` with ISO-8601-prefixed metadata dates (e.g., `metadata.conversation_created_at = "2026-04-21T09:30:00Z"`) bucket by the event date, not the import date, when you use the `_lifelog` variants.

## Troubleshooting

**Issue: "function brain_stats_daily does not exist" when calling from the REST API**
Solution: The migration ends with `NOTIFY pgrst, 'reload schema'` to reload the PostgREST schema cache. If the function exists in **Database → Functions** but REST still 404s, reload manually from the Supabase dashboard: **Settings → API → Reload schema cache**, or run the NOTIFY again in SQL Editor.

**Issue: Multi-year heatmap is clipped to 1000 rows**
Solution: You're calling the setof variant (`brain_stats_daily`). PostgREST caps setof responses at `db-max-rows=1000` by default. Switch to the JSONB variant (`brain_stats_daily_jsonb`) — it returns a single jsonb array so the cap doesn't apply. Unwrap the array on the client.

**Issue: `ERROR: column t.source_type does not exist` (or `t.sensitivity_tier`) when calling an RPC**
Solution: Install the [enhanced-thoughts schema](../enhanced-thoughts/) first. It adds the two columns these RPCs read. The error surfaces the first time you call the RPC (PL/pgSQL validates column references at execution time, not at `CREATE FUNCTION`), so a successful `schema.sql` run is not proof the columns exist. Then rerun this schema's SQL (idempotent — safe to re-run).

**Issue: Lifelog variant returns zero rows even though I have imports**
Solution: The lifelog variant filters by a fixed list of source types (`google_drive_import`, `limitless_import`, `chatgpt_import`, etc.). If your import source_type isn't in the list, add it to the `v_lifelog_sources` array at the top of both lifelog functions in `schema.sql` and rerun.
