-- Edge Function Cost Optimization migrations
-- Created: 2026-04-17
--
-- Two changes, both additive (no breaking schema modifications):
--
-- 1. thought_stats_summary() — replaces a full-table scan + JS aggregation
--    in the open-brain MCP server with a single SQL aggregation query.
--    Returns: { total, first_ts, last_ts, types{}, topics{}, people{} }
--
-- 2. upsert_thought() — adds an optional p_embedding parameter so the MCP
--    server can save content + embedding in a single round-trip instead of
--    two (INSERT then separate UPDATE). The old 2-arg signature is preserved
--    by Postgres function overloading, so existing callers continue to work.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. thought_stats_summary()
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function thought_stats_summary()
returns jsonb
language sql
stable
as $$
  with totals as (
    select
      count(*) as total,
      min(created_at) as first_ts,
      max(created_at) as last_ts
    from thoughts
  ),
  type_counts as (
    select coalesce(jsonb_object_agg(t, cnt), '{}'::jsonb) as types
    from (
      select metadata->>'type' as t, count(*) as cnt
      from thoughts
      where metadata ? 'type'
      group by metadata->>'type'
      order by count(*) desc
    ) s
  ),
  topic_counts as (
    select coalesce(jsonb_object_agg(topic, cnt), '{}'::jsonb) as topics
    from (
      select topic, count(*) as cnt
      from thoughts, jsonb_array_elements_text(coalesce(metadata->'topics', '[]'::jsonb)) as topic
      group by topic
      order by count(*) desc
      limit 10
    ) x
  ),
  people_counts as (
    select coalesce(jsonb_object_agg(person, cnt), '{}'::jsonb) as people
    from (
      select person, count(*) as cnt
      from thoughts, jsonb_array_elements_text(coalesce(metadata->'people', '[]'::jsonb)) as person
      group by person
      order by count(*) desc
      limit 10
    ) x
  )
  select jsonb_build_object(
    'total',    (select total from totals),
    'first_ts', (select first_ts from totals),
    'last_ts',  (select last_ts from totals),
    'types',    (select types from type_counts),
    'topics',   (select topics from topic_counts),
    'people',   (select people from people_counts)
  );
$$;

comment on function thought_stats_summary() is
  'Returns aggregated thought statistics in one SQL call. Replaces full-table scan + JS aggregation in the open-brain MCP edge function.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. upsert_thought() — overload with optional embedding parameter
-- ─────────────────────────────────────────────────────────────────────────────

-- New 3-arg signature: accepts an embedding vector so capture_thought can
-- save content + metadata + embedding in one round-trip. Falls back to the
-- existing 2-arg behavior when p_embedding is null.
--
-- This is a Postgres function overload — the original 2-arg upsert_thought
-- continues to exist and work unchanged.

create or replace function upsert_thought(
  p_content text,
  p_payload jsonb,
  p_embedding vector(1536)
)
returns jsonb
language plpgsql
as $$
declare
  v_fingerprint text;
  v_id uuid;
  v_result jsonb;
begin
  v_fingerprint := encode(
    sha256(convert_to(
      lower(trim(regexp_replace(p_content, '\s+', ' ', 'g'))),
      'UTF8'
    )),
    'hex'
  );

  insert into thoughts (content, content_fingerprint, metadata, embedding)
  values (
    p_content,
    v_fingerprint,
    coalesce(p_payload->'metadata', '{}'::jsonb),
    p_embedding
  )
  on conflict (content_fingerprint) where content_fingerprint is not null do update
    set updated_at = now(),
        metadata = thoughts.metadata || coalesce(excluded.metadata, '{}'::jsonb),
        embedding = coalesce(excluded.embedding, thoughts.embedding)
  returning id into v_id;

  v_result := jsonb_build_object('id', v_id, 'fingerprint', v_fingerprint);
  return v_result;
end;
$$;

comment on function upsert_thought(text, jsonb, vector) is
  'Same as upsert_thought(text, jsonb) but also stores the embedding in one round-trip. Used by capture_thought in the unified MCP edge function.';
