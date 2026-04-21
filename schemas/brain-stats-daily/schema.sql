-- Brain Stats Daily + Heatmap RPCs
-- Server-side daily-bucket aggregation for dashboard heatmaps.
-- Replaces client-side bucketing passes that only cover recent days at
-- typical capture rates.
--
-- Installs four RPC functions plus one internal helper:
--   brain_stats_daily(p_days, p_source_type, p_exclude_restricted)
--     → returns (date, count) over the last p_days by created_at.
--   brain_stats_daily_lifelog(p_days, p_exclude_restricted)
--     → returns (date, count) for dated-event source_types, bucketing
--       by metadata life-date fields (fallback: created_at).
--   brain_stats_daily_jsonb(...)  · brain_stats_daily_lifelog_jsonb(...)
--     → JSONB variants that bypass PostgREST's default 1000-row cap by
--       returning a single jsonb array. Use these for 1+ year windows.
--   _brain_stats_try_parse_iso_date(text)
--     → internal helper: safely parses a YYYY-MM-DD prefix into a date,
--       returning NULL on bad input so one bad row doesn't kill the RPC.
--
-- Safe to run multiple times (fully idempotent — CREATE OR REPLACE).
-- Does NOT modify the core thoughts table.
--
-- Security model:
--   All RPCs are SECURITY INVOKER, so they respect whatever RLS policies
--   you have on the `thoughts` table. Execute is granted to authenticated
--   and service_role by default (NOT anon) — if you want unauthenticated
--   dashboards to read aggregate counts, explicitly add the anon grant
--   yourself AFTER reviewing your RLS policy.
--
-- Prerequisites:
--   - The core `thoughts` table from the Open Brain getting-started guide.
--   - The `enhanced-thoughts` schema (adds `source_type` and
--     `sensitivity_tier` columns used by these RPCs). Install that first.
--
-- If the optional columns are missing the RPCs will error the first time
-- you call them (PL/pgSQL parses SQL statements at first execution, not
-- at CREATE FUNCTION time) — install enhanced-thoughts first.


-- ============================================================
-- 0. Internal helper: safe ISO-date prefix parser.
--    Used by both lifelog variants so one bad metadata string
--    doesn't abort the whole heatmap query.
-- ============================================================

create or replace function public._brain_stats_try_parse_iso_date(p_raw text)
returns date
language plpgsql
immutable
security invoker
set search_path = public
as $$
begin
  if p_raw is null then
    return null;
  end if;
  -- Require a YYYY-MM-DD prefix before attempting the cast. This is a
  -- cheap pre-filter; the BEGIN/EXCEPTION still catches any remaining
  -- out-of-range values (e.g. '2026-99-99').
  if p_raw !~ '^\d{4}-\d{2}-\d{2}' then
    return null;
  end if;
  return substring(p_raw from 1 for 10)::date;
exception
  when others then
    return null;
end;
$$;

comment on function public._brain_stats_try_parse_iso_date(text) is
  'Internal helper: safely parses a YYYY-MM-DD prefix to a date, returning NULL on invalid input so one bad metadata value does not abort the whole RPC.';


-- ============================================================
-- 1. brain_stats_daily — buckets by thoughts.created_at.
--    Used by the dashboard heatmap for "capture activity".
--
--    Window semantics: "last p_days calendar days in UTC",
--    inclusive of today. p_days=1 returns at most one row (today).
-- ============================================================

create or replace function public.brain_stats_daily(
  p_days integer default 180,
  p_source_type text default null,
  p_exclude_restricted boolean default true
)
returns table (date date, count bigint)
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  v_days integer := greatest(1, least(coalesce(p_days, 180), 3650));
  v_today_utc date := (now() at time zone 'UTC')::date;
  v_since_date date := v_today_utc - v_days + 1;
begin
  return query
  select
    (t.created_at at time zone 'UTC')::date as date,
    count(*)::bigint as count
  from public.thoughts t
  where (t.created_at at time zone 'UTC')::date >= v_since_date
    and (p_source_type is null or t.source_type = p_source_type)
    and (not p_exclude_restricted or lower(t.sensitivity_tier) is distinct from 'restricted')
  group by 1
  order by 1 asc;
end;
$$;

grant execute on function public.brain_stats_daily(integer, text, boolean)
  to authenticated, service_role;

comment on function public.brain_stats_daily(integer, text, boolean) is
  'Returns (date, count) buckets of thought captures over the last p_days calendar days (UTC) by created_at. Used by dashboard heatmaps.';


-- ============================================================
-- 2. brain_stats_daily_lifelog — buckets by metadata life-date
--    fields, covering dated-event source types (LifeLog-style
--    imports, conversation imports, journal imports, etc.).
--
--    Date resolved via event_at → life_date → conversation_created_at
--    → source_date → captured_at → original_date → date → created_at.
--    Each candidate is parsed independently so a bad earlier field
--    doesn't hide a valid later one.
--    Restricted-tier thoughts excluded by default.
--
--    The source list covers common "happened on a real date" capture
--    sources. Edit v_lifelog_sources below to extend it.
--    NOTE: This list is duplicated in brain_stats_daily_lifelog_jsonb
--    below — keep both copies in sync.
-- ============================================================

create or replace function public.brain_stats_daily_lifelog(
  p_days integer default 180,
  p_exclude_restricted boolean default true
)
returns table (date date, count bigint)
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  v_days integer := greatest(1, least(coalesce(p_days, 180), 3650));
  v_since_date date := (now() at time zone 'UTC')::date - v_days + 1;
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
        public._brain_stats_try_parse_iso_date(nullif(t.metadata->>'event_at', '')),
        public._brain_stats_try_parse_iso_date(nullif(t.metadata->>'life_date', '')),
        public._brain_stats_try_parse_iso_date(nullif(t.metadata->>'conversation_created_at', '')),
        public._brain_stats_try_parse_iso_date(nullif(t.metadata->>'source_date', '')),
        public._brain_stats_try_parse_iso_date(nullif(t.metadata->>'captured_at', '')),
        public._brain_stats_try_parse_iso_date(nullif(t.metadata->>'original_date', '')),
        public._brain_stats_try_parse_iso_date(nullif(t.metadata->>'date', '')),
        (t.created_at at time zone 'UTC')::date
      ) as d
    from public.thoughts t
    where t.source_type = any(v_lifelog_sources)
      and (not p_exclude_restricted or lower(t.sensitivity_tier) is distinct from 'restricted')
  )
  select d as date, count(*)::bigint as count
  from resolved
  where d is not null and d >= v_since_date
  group by 1
  order by 1 asc;
end;
$$;

grant execute on function public.brain_stats_daily_lifelog(integer, boolean)
  to authenticated, service_role;

comment on function public.brain_stats_daily_lifelog(integer, boolean) is
  'Daily buckets of life-log thoughts across dated-event source_types. Date resolved via metadata fields (each parsed independently) with fallback to created_at. Restricted-tier thoughts excluded by default.';


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
security invoker
set search_path = public
as $$
declare
  v_days integer := greatest(1, least(coalesce(p_days, 180), 3650));
  v_today_utc date := (now() at time zone 'UTC')::date;
  v_since_date date := v_today_utc - v_days + 1;
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
    where (t.created_at at time zone 'UTC')::date >= v_since_date
      and (p_source_type is null or t.source_type = p_source_type)
      and (not p_exclude_restricted or lower(t.sensitivity_tier) is distinct from 'restricted')
    group by 1
  ) agg;
  return v_rows;
end;
$$;

grant execute on function public.brain_stats_daily_jsonb(integer, text, boolean)
  to authenticated, service_role;

comment on function public.brain_stats_daily_jsonb(integer, text, boolean) is
  'JSONB variant of brain_stats_daily — bypasses the PostgREST 1000-row cap by returning a single jsonb array. Use for 1+ year windows.';


-- ============================================================
-- 4. brain_stats_daily_lifelog_jsonb — JSONB variant of #2.
--    NOTE: v_lifelog_sources below is duplicated in
--    brain_stats_daily_lifelog above — keep both copies in sync.
-- ============================================================

create or replace function public.brain_stats_daily_lifelog_jsonb(
  p_days integer default 180,
  p_exclude_restricted boolean default true
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  v_days integer := greatest(1, least(coalesce(p_days, 180), 3650));
  v_since_date date := (now() at time zone 'UTC')::date - v_days + 1;
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
          public._brain_stats_try_parse_iso_date(nullif(t.metadata->>'event_at', '')),
          public._brain_stats_try_parse_iso_date(nullif(t.metadata->>'life_date', '')),
          public._brain_stats_try_parse_iso_date(nullif(t.metadata->>'conversation_created_at', '')),
          public._brain_stats_try_parse_iso_date(nullif(t.metadata->>'source_date', '')),
          public._brain_stats_try_parse_iso_date(nullif(t.metadata->>'captured_at', '')),
          public._brain_stats_try_parse_iso_date(nullif(t.metadata->>'original_date', '')),
          public._brain_stats_try_parse_iso_date(nullif(t.metadata->>'date', '')),
          (t.created_at at time zone 'UTC')::date
        ) as d
      from public.thoughts t
      where t.source_type = any(v_lifelog_sources)
        and (not p_exclude_restricted or lower(t.sensitivity_tier) is distinct from 'restricted')
    )
    select d, count(*)::bigint as c
    from resolved
    where d is not null and d >= v_since_date
    group by 1
  ) agg;
  return v_rows;
end;
$$;

grant execute on function public.brain_stats_daily_lifelog_jsonb(integer, boolean)
  to authenticated, service_role;

comment on function public.brain_stats_daily_lifelog_jsonb(integer, boolean) is
  'JSONB variant of brain_stats_daily_lifelog — single-row response, no PostgREST row-cap clipping.';


-- Reload PostgREST schema cache so the new RPCs are reachable via
-- the Supabase REST API immediately.
NOTIFY pgrst, 'reload schema';
