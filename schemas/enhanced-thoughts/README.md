# Enhanced Thoughts Columns and Utility RPCs

<div align="center">

![Community Contribution](https://img.shields.io/badge/OB1_COMMUNITY-Approved_Contribution-2ea44f?style=for-the-badge&logo=github)

**Created by [@alanshurafa](https://github.com/alanshurafa)**

</div>

> Adds structured columns and utility functions to the Open Brain thoughts table for richer classification, full-text search, statistics, and connection discovery.

## What It Does

This schema extension adds six new columns to the `thoughts` table (`type`, `sensitivity_tier`, `importance`, `quality_score`, `source_type`, `enriched`) so thoughts can be classified, filtered, and ranked without parsing the metadata JSONB every time. It also installs four RPC functions:

- **`search_thoughts_text`** -- Full-text search with boolean operators, ILIKE fallback, pagination, and result counts.
- **`brain_stats_aggregate`** -- Returns total thought count, top types, and top topics as a single JSONB payload.
- **`get_thought_connections`** -- Finds thoughts that share metadata topics or people with a given thought.
- **`backfill_thought_types(p_allowed_types TEXT[])`** -- Populates the new top-level `type` column from `metadata->>'type'`. The default allowlist covers the canonical eight values (`idea`, `task`, `person_note`, `reference`, `decision`, `lesson`, `meeting`, `journal`). Pass a custom array to accept additional values, or pass `NULL` to backfill whatever `metadata->>'type'` contains.

It also overrides the base `upsert_thought` so structured columns (`type`, `source_type`, `importance`, `quality_score`, `sensitivity_tier`, `status`) stay in sync on capture, and (when `schemas/typed-reasoning-edges` is installed) installs one optional opt-in RPC:

- **`match_thoughts_superseded_aware`** -- The same nearest-neighbor search as the core `match_thoughts`, plus a `superseded_by` column. Thoughts that have been replaced (the target of a `supersedes` edge in `thought_edges`) get a 0.8x ranking penalty so fresh thoughts surface above their stale predecessors. The core `match_thoughts` is left untouched; callers opt in by name.

## Prerequisites

- Working Open Brain setup (see the getting-started guide in `docs/01-getting-started.md`)
- Supabase project with the `thoughts` table, `match_thoughts` function, and `upsert_thought` function already created
- Apply `schemas/workflow-status/` first if it is not already applied. The `upsert_thought` override here writes to the `status` and `status_updated_at` columns that `workflow-status` creates. Both files use `ADD COLUMN IF NOT EXISTS`, so applying either order is safe, but `workflow-status` must be present before the first `upsert_thought` call runs.
- Optional: `schemas/typed-reasoning-edges/` (creates `public.thought_edges`). Required only for `match_thoughts_superseded_aware`. If it is absent, the rest of this migration still applies and that one function is skipped with a `NOTICE`; re-run this `schema.sql` after installing typed-reasoning-edges to add it.

## Credential Tracker

Copy this block into a text editor and fill it in as you go.

```text
ENHANCED THOUGHTS -- CREDENTIAL TRACKER
--------------------------------------

SUPABASE (from your Open Brain setup)
  Project URL:           ____________
  Secret key:            ____________

--------------------------------------
```

## Steps

1. Open your Supabase dashboard and navigate to the **SQL Editor**
2. Create a new query and paste the full contents of `schema.sql`
3. Click **Run** to execute the migration
4. Open **Table Editor** and select the `thoughts` table to confirm the new columns appear: `type`, `sensitivity_tier`, `importance`, `quality_score`, `source_type`, `enriched`
5. Navigate to **Database > Functions** and verify the functions exist: `search_thoughts_text`, `brain_stats_aggregate`, `get_thought_connections`, `backfill_thought_types`, and `upsert_thought`. If you have applied `schemas/typed-reasoning-edges/`, `match_thoughts_superseded_aware` is present too; if not, that one function is skipped (see Prerequisites)
6. If you have existing thoughts with `type` or `source` values stored in the metadata JSONB, the script automatically calls `backfill_thought_types()` with the default canonical allowlist. If your brain uses non-canonical `type` values, re-run `SELECT backfill_thought_types(ARRAY['your','custom','types']);` or `SELECT backfill_thought_types(NULL);` to accept any value

## Expected Outcome

After running the migration:

- The `thoughts` table has six new columns with sensible defaults:
  - `sensitivity_tier TEXT DEFAULT 'standard'` (canonical values: `'standard'`, `'personal'`, `'restricted'`)
  - `importance SMALLINT DEFAULT 3` (the column default is 3; the `upsert_thought` override accepts and clamps payload values to 0-100. See "Changes from v1" for why this is NOT the ExoCortex 0-6 scale.)
  - `quality_score NUMERIC(5,2) DEFAULT 50` (scale: 0-100, where 50 is the default)
  - `enriched BOOLEAN DEFAULT false`
  - `type TEXT` (nullable; populated by backfill or writers)
  - `source_type TEXT` (nullable; populated by backfill or writers)
- New indexes on `type`, `importance`, `source_type`, and a GIN tsvector index on `content` for fast full-text search.
- Four new RPC functions callable via the Supabase client or REST API (`search_thoughts_text`, `brain_stats_aggregate`, `get_thought_connections`, `backfill_thought_types`).
- Any existing thoughts with `type` or `source` in their metadata JSONB will have those values copied into the new top-level columns (via `backfill_thought_types()` for `type` with the canonical allowlist, plus an inline `UPDATE` for `source_type`).

## Changes from v1

v1.1 brings the RPCs in line with how the reference Open Brain install runs them today. Everything is additive and idempotent — re-running `schema.sql` on a v1 install is safe. The `upsert_thought` return contract (`{id, fingerprint}`) and the `status` / `status_updated_at` handling are unchanged, so existing callers and `schemas/workflow-status/` are not affected.

What changed for an existing install:

- **`search_thoughts_text` now reads three control keys out of `p_filter`.** `start_date` and `end_date` (ISO 8601 timestamps) filter `created_at` to that range; `exclude_restricted` (boolean) drops restricted rows. A row counts as restricted when **either** the promoted `sensitivity_tier` column **or** `metadata->>'sensitivity_tier'` is `'restricted'`, so rows captured before this schema — or by canonical flows that keep the tier only in `metadata` (the same place `schemas/provenance-chains` reads it) — do not leak through on the column's `'standard'` default. These keys are stripped from the metadata-containment predicate, so they no longer require a literal metadata key of the same name. Any other `p_filter` key keeps its original `metadata @> filter` behavior. If you were (accidentally) relying on a metadata key literally named `start_date`/`end_date`/`exclude_restricted`, it is now interpreted as a control key instead.

- **`upsert_thought` gained two dedup/merge guards.**
  - *Original-fingerprint fallback*: when a thought's content is corrected, its fingerprint changes. If your update path appends the pre-edit fingerprint to an append-only array `metadata.original_fingerprints[]`, a later reimport of the original source text now lands on the corrected row as a dedup hit instead of inserting a stale sibling that "outvotes" the correction. Exact-fingerprint match still wins first. If you never write `original_fingerprints`, behavior is identical to v1 (an extra indexed lookup on miss, no semantic change). On this fallback path the incoming `p_content` is the **old, pre-correction** text, so the return payload now carries a `matched_via` field (`'inserted'`, `'fingerprint'`, or `'original_fingerprint'`) alongside the unchanged `{id, fingerprint}`. A caller that recomputes an embedding from `p_content` (such as `integrations/open-brain-rest`) checks for `matched_via = 'original_fingerprint'` and skips writing the stale-text embedding over the corrected row. The RPC itself never writes `content` or `embedding` on the merge path, so older callers that ignore `matched_via` keep their previous behavior.
  - *User-edit guard*: keys listed in `metadata.user_edits` are treated as human-owned. On the merge path they (and the system-managed `user_edits` / `original_fingerprints` maps) are stripped from the incoming patch so an automated reimport cannot resurrect stale values over a human correction. The guard now also covers the **promoted scalar columns**: if a field (`type`, `importance`, `quality_score`, `source_type`, `sensitivity_tier`) is marked human-owned, the scalar column is preserved too, so the column and `metadata.<key>` stay in agreement instead of the column silently overwriting. If you never write `user_edits`, behavior is identical to v1.
  - *Merge preserves omitted fields*: on a re-upsert that **omits** a structured field, the existing column is now kept rather than reset to a hardcoded default. A metadata-only re-upsert (new tags, a note) no longer rewrites `importance`/`quality_score`/`type`/`source_type`/`sensitivity_tier` — in particular it no longer silently downgrades `sensitivity_tier` from `restricted` to `standard`. An explicitly provided value still updates the column, and brand-new rows still get the documented insert defaults.
  - To make the fallback possible the function now does an explicit fingerprint lookup and branches INSERT vs UPDATE instead of using `ON CONFLICT`. The visible result is the same `{id, fingerprint}` payload.

- **Importance stays on the 0-100 scale (deliberate deviation).** ExoCortex widened its own importance to a 0-6 scale. Open Brain's `upsert_thought` already accepts a wider 0-100 range, so it does not clip 0-6 values — adopting 0-6 here would retroactively rescale every existing row's importance, which is a breaking data change, not an additive one. The column default remains 3; payload values are clamped to 0-100. Treat 0-6 as a subset if you want cross-system parity.

- **New opt-in RPC `match_thoughts_superseded_aware`** (installed only when `schemas/typed-reasoning-edges/` is present). It returns the same columns as the core `match_thoughts` plus `superseded_by UUID`, and applies a 0.8x penalty to thoughts that are the target of a `supersedes` edge so stale predecessors rank below their replacements without being excluded. The core `match_thoughts` is not modified. If `public.thought_edges` is missing, this function is skipped with a `NOTICE` and the rest of the migration still applies.

## Security

This schema follows stock Open Brain's "service_role only" posture:

- `brain_stats_aggregate` and `get_thought_connections` are `SECURITY DEFINER` with `SET search_path = public` (defense in depth against search-path hijacks). They can read the full `thoughts` table regardless of RLS.
- `search_thoughts_text` is `SECURITY INVOKER` and respects RLS.
- `match_thoughts_superseded_aware` is `SECURITY INVOKER` and granted to `service_role` only, matching the access posture of `public.thought_edges` (service-role only).
- `upsert_thought` is granted to `service_role` only. The `exclude_restricted` control key on `search_thoughts_text` lets a caller drop restricted rows, but the default is `false` (restricted rows are returned), so set it explicitly when building any lower-trust surface.
- **None of the read RPCs are granted to `anon`.** Execute privilege is limited to `authenticated` and `service_role` (or `service_role` only, per function above). The publishable anon key cannot call them.

If you want to expose any of these to `anon` (for example, a public-read dashboard), add your own `GRANT EXECUTE ... TO anon;` in a follow-up migration and confirm that `p_exclude_restricted := true` (the default) plus your sensitivity-tier hygiene gives you the exposure surface you actually want. This is an explicit opt-in: the default stance is private.

## Troubleshooting

**Issue: "column already exists" warnings**
Solution: These are safe to ignore. The `ADD COLUMN IF NOT EXISTS` syntax prevents errors but may log informational notices.

**Issue: search_thoughts_text returns no results**
Solution: Confirm your thoughts have content populated. Try a simple query first (single word, no operators). If using boolean operators, ensure the syntax matches websearch format ("quoted phrases", word AND word, -excluded).

**Issue: brain_stats_aggregate returns empty types or topics**
Solution: The function filters by `created_at`. Pass `p_since_days := 0` for all-time stats. Also confirm that your thoughts have the `type` column populated. If you use non-canonical type values in `metadata->>'type'` (anything outside `idea`, `task`, `person_note`, `reference`, `decision`, `lesson`, `meeting`, `journal`), call the backfill RPC with your own allowlist, e.g. `SELECT backfill_thought_types(ARRAY['idea','task','article','quote']);`, or `SELECT backfill_thought_types(NULL);` to accept whatever is present.

## More from Nate

Open Brain is built in the open by Nate B. Jones — more practical systems like this on his [Substack](https://substack.com/@natesnewsletter) and at [natebjones.com](https://natebjones.com).
