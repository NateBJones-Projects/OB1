-- Brain Stats Daily + Heatmap RPCs
-- Server-side daily-bucket aggregation for dashboard heatmaps.
-- Replaces client-side bucketing passes that only cover recent days at
-- typical capture rates.
--
-- Installs four RPC functions:
--   brain_stats_daily(p_days, p_source_type, p_exclude_restricted)
--     → returns (date, count) over the last p_days by created_at.
--   brain_stats_daily_lifelog(p_days, p_exclude_restricted)
--     → returns (date, count) for dated-event source_types, bucketing
--       by metadata life-date fields (fallback: created_at).
--   brain_stats_daily_jsonb(...)  · brain_stats_daily_lifelog_jsonb(...)
--     → JSONB variants that bypass PostgREST's default 1000-row cap by
--       returning a single jsonb array. Use these for 1+ year windows.
--
-- Safe to run multiple times (fully idempotent — CREATE OR REPLACE).
-- Does NOT modify the core thoughts table.
--
-- Prerequisites:
--   - The core `thoughts` table from the Open Brain getting-started guide.
--   - The `enhanced-thoughts` schema (adds `source_type` and
--     `sensitivity_tier` columns used by these RPCs). Install that first.
--
-- If the optional columns are missing the RPCs will error at CREATE time
-- — install enhanced-thoughts first and re-run this file.

-- ============================================================
-- 1. brain_stats_daily — buckets by thoughts.created_at.
--    Used by the dashboard heatmap for "capture activity".
-- ============================================================

create or replace function public.brain_stats_daily(
  p_days integer default 180,
  p_source_type text default null,
  p_exclude_restricted boolean default true
)
returns table (date date, count bigint)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_days integer := greatest(1, least(coalesce(p_days, 180), 3650));
  v_since timestamptz := now() - (v_days || ' days')::interval;
begin
  return query
  select
    (t.created_at at time zone 'UTC')::date as date,
    count(*)::bigint as count
  from public.thoughts t
  where t.created_at >= v_since
    and (p_source_type is null or t.source_type = p_source_type)
    and (not p_exclude_restricted or t.sensitivity_tier is distinct from 'restricted')
  group by 1
  order by 1 asc;
end;
$$;

grant execute on function public.brain_stats_daily(integer, text, boolean)
  to authenticated, anon, service_role;

comment on function public.brain_stats_daily(integer, text, boolean) is
  'Returns (date, count) buckets of thought captures over the last p_days by created_at. Used by dashboard heatmaps.';


-- ============================================================
-- 2. brain_stats_daily_lifelog — buckets by metadata life-date
--    fields, covering dated-event source types (LifeLog-style
--    imports, conversation imports, journal imports, etc.).
--
--    Date resolved via event_at → life_date → conversation_created_at
--    → source_date → captured_at → original_date → date → created_at.
--    Restricted-tier thoughts excluded by default.
--
--    The source list covers common "happened on a real date" capture
--    sources. Edit v_lifelog_sources below to extend it.
-- ============================================================

create or replace function public.brain_stats_daily_lifelog(
  p_days integer default 180,
  p_exclude_restricted boolean default true
)
returns table (date date, count bigint)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_days integer := greatest(1, least(coalesce(p_days, 180), 3650));
  v_since_date date := (current_date - v_days + 1);
  v_lifelog_sources text[] := array[
    'google_drive_import',
    'limitless_import',
    'gemini_import',
    'chatgpt_import',
    'claude_import',
    'grok_import',
    'x_twitter_import',
    'instagram_import',
    'facebook_import',
    'google_activity_import',
    'blogger_import',
    'journals_import'
  ];
begin
  return query
  with resolved as (
    select
      coalesce(
        nullif(t.metadata->>'event_at', ''),
        nullif(t.metadata->>'life_date', ''),
        nullif(t.metadata->>'conversation_created_at', ''),
        nullif(t.metadata->>'source_date', ''),
        nullif(t.metadata->>'captured_at', ''),
        nullif(t.metadata->>'original_date', ''),
        nullif(t.metadata->>'date', ''),
        (t.created_at at time zone 'UTC')::text
      ) as raw_date
    from public.thoughts t
    where t.source_type = any(v_lifelog_sources)
      and (not p_exclude_restricted or t.sensitivity_tier is distinct from 'restricted')
  ),
  parsed as (
    select
      case
        when raw_date ~ '^\d{4}-\d{2}-\d{2}' then substring(raw_date from 1 for 10)::date
        else null
      end as d
    from resolved
  )
  select d as date, count(*)::bigint as count
  from parsed
  where d is not null and d >= v_since_date
  group by 1
  order by 1 asc;
end;
$$;

grant execute on function public.brain_stats_daily_lifelog(integer, boolean)
  to authenticated, anon, service_role;

comment on function public.brain_stats_daily_lifelog(integer, boolean) is
  'Daily buckets of life-log thoughts across dated-event source_types. Date resolved via metadata fields with fallback to created_at. Restricted-tier thoughts excluded by default.';


-- ============================================================
-- 3. brain_stats_daily_jsonb — JSONB variant of #1.
--    Returns a single jsonb array, bypassing PostgREST's default
--    db-max-rows=1000 cap for multi-year windows.
-- ============================================================

create or replace function public.brain_stats_daily_jsonb(
  p_days integer default 180,
  p_source_type text default null,
  p_exclude_restricted boolean default true
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_days integer := greatest(1, least(coalesce(p_days, 180), 3650));
  v_since timestamptz := now() - (v_days || ' days')::interval;
  v_rows jsonb;
begin
  select coalesce(
    jsonb_agg(jsonb_build_object('date', date, 'count', count) order by date asc),
    '[]'::jsonb
  )
  into v_rows
  from (
    select
      (t.created_at at time zone 'UTC')::date as date,
      count(*)::bigint as count
    from public.thoughts t
    where t.created_at >= v_since
      and (p_source_type is null or t.source_type = p_source_type)
      and (not p_exclude_restricted or t.sensitivity_tier is distinct from 'restricted')
    group by 1
  ) agg;
  return v_rows;
end;
$$;

grant execute on function public.brain_stats_daily_jsonb(integer, text, boolean)
  to authenticated, anon, service_role;

comment on function public.brain_stats_daily_jsonb(integer, text, boolean) is
  'JSONB variant of brain_stats_daily — bypasses the PostgREST 1000-row cap by returning a single jsonb array. Use for 1+ year windows.';


-- ============================================================
-- 4. brain_stats_daily_lifelog_jsonb — JSONB variant of #2.
-- ============================================================

create or replace function public.brain_stats_daily_lifelog_jsonb(
  p_days integer default 180,
  p_exclude_restricted boolean default true
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_days integer := greatest(1, least(coalesce(p_days, 180), 3650));
  v_since_date date := (current_date - v_days + 1);
  v_lifelog_sources text[] := array[
    'google_drive_import',
    'limitless_import',
    'gemini_import',
    'chatgpt_import',
    'claude_import',
    'grok_import',
    'x_twitter_import',
    'instagram_import',
    'facebook_import',
    'google_activity_import',
    'blogger_import',
    'journals_import'
  ];
  v_rows jsonb;
begin
  select coalesce(
    jsonb_agg(jsonb_build_object('date', d, 'count', c) order by d asc),
    '[]'::jsonb
  )
  into v_rows
  from (
    with resolved as (
      select
        coalesce(
          nullif(t.metadata->>'event_at', ''),
          nullif(t.metadata->>'life_date', ''),
          nullif(t.metadata->>'conversation_created_at', ''),
          nullif(t.metadata->>'source_date', ''),
          nullif(t.metadata->>'captured_at', ''),
          nullif(t.metadata->>'original_date', ''),
          nullif(t.metadata->>'date', ''),
          (t.created_at at time zone 'UTC')::text
        ) as raw_date
      from public.thoughts t
      where t.source_type = any(v_lifelog_sources)
        and (not p_exclude_restricted or t.sensitivity_tier is distinct from 'restricted')
    ),
    parsed as (
      select
        case
          when raw_date ~ '^\d{4}-\d{2}-\d{2}' then substring(raw_date from 1 for 10)::date
          else null
        end as d
      from resolved
    )
    select d, count(*)::bigint as c
    from parsed
    where d is not null and d >= v_since_date
    group by 1
  ) agg;
  return v_rows;
end;
$$;

grant execute on function public.brain_stats_daily_lifelog_jsonb(integer, boolean)
  to authenticated, anon, service_role;

comment on function public.brain_stats_daily_lifelog_jsonb(integer, boolean) is
  'JSONB variant of brain_stats_daily_lifelog — single-row response, no PostgREST row-cap clipping.';


-- Reload PostgREST schema cache so the new RPCs are reachable via
-- the Supabase REST API immediately.
NOTIFY pgrst, 'reload schema';
