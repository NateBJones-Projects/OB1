-- Supersession and update — v1
-- A capture can retire the row it replaces; search excludes retired rows by
-- default; any row's metadata and content can be corrected in place with the
-- embedding kept consistent.
--
-- Retirement marker: a row is retired iff superseded_at is not null.
-- superseded_by is the pointer to the replacement and may be null for rows
-- retired with no successor (and the FK sets it null if the replacement is
-- ever deleted), so the "current rows only" predicate is superseded_at.

-- pgvector lives in the extensions schema on hosted projects; the migration
-- session's search_path does not include it by default.
set search_path = public, extensions;

alter table thoughts
  add column superseded_by uuid references thoughts(id) on delete set null,
  add column superseded_at timestamptz,
  add column supersede_reason text;

-- Partial index: supports the default "current rows only" filter.
create index thoughts_current_idx on thoughts (id) where superseded_at is null;

create index thoughts_superseded_by_idx on thoughts (superseded_by);

-- match_thoughts gains include_superseded and returns supersession fields.
-- The return type changes, so the old function must be dropped first.
drop function if exists match_thoughts(vector, double precision, integer, jsonb);

create or replace function match_thoughts(
  query_embedding vector(1536),
  match_threshold float default 0.7,
  match_count int default 10,
  filter jsonb default '{}'::jsonb,
  include_superseded boolean default false
)
returns table (
  id uuid,
  content text,
  metadata jsonb,
  similarity float,
  created_at timestamptz,
  superseded_by uuid,
  superseded_at timestamptz
)
language plpgsql
as $$
begin
  return query
  select
    t.id,
    t.content,
    t.metadata,
    1 - (t.embedding <=> query_embedding) as similarity,
    t.created_at,
    t.superseded_by,
    t.superseded_at
  from thoughts t
  where 1 - (t.embedding <=> query_embedding) > match_threshold
    and (filter = '{}'::jsonb or t.metadata @> filter)
    and (include_superseded or t.superseded_at is null)
  order by t.embedding <=> query_embedding
  limit match_count;
end;
$$;

-- Retire one thought, optionally pointing at its replacement.
-- All validation lives here (not in constraints) so the errors that reach the
-- MCP client are readable by an agent. Also reused by upsert_thought so a
-- capture and the retirement of its targets share one transaction.
create or replace function supersede_thought(
  p_id uuid,
  p_superseded_by uuid default null,
  p_reason text default null
)
returns jsonb
language plpgsql
as $$
declare
  v_target thoughts%rowtype;
  v_replacement thoughts%rowtype;
  v_row thoughts%rowtype;
begin
  if p_superseded_by is not null and p_superseded_by = p_id then
    raise exception 'A thought cannot supersede itself (%).', p_id;
  end if;

  select * into v_target from thoughts where id = p_id;
  if not found then
    raise exception 'Thought % does not exist; nothing was superseded.', p_id;
  end if;
  if v_target.superseded_at is not null then
    raise exception 'Thought % is already superseded (at %, by %); refusing to change an existing supersession.',
      p_id, v_target.superseded_at, coalesce(v_target.superseded_by::text, 'no successor');
  end if;

  if p_superseded_by is not null then
    select * into v_replacement from thoughts where id = p_superseded_by;
    if not found then
      raise exception 'Replacement thought % does not exist; nothing was superseded.', p_superseded_by;
    end if;
    if v_replacement.superseded_at is not null then
      raise exception 'Replacement thought % is itself superseded; point at the current head of the chain instead.',
        p_superseded_by;
    end if;
  end if;

  update thoughts
  set superseded_by = p_superseded_by,
      superseded_at = now(),
      supersede_reason = p_reason
  where id = p_id
  returning * into v_row;

  return jsonb_build_object(
    'id', v_row.id,
    'superseded_by', v_row.superseded_by,
    'superseded_at', v_row.superseded_at,
    'supersede_reason', v_row.supersede_reason
  );
end;
$$;

-- upsert_thought gains optional supersession targets. Insert and retirement
-- run in the same transaction: if any target is invalid the whole call fails
-- and the new row is not written.
drop function if exists upsert_thought(text, jsonb);

create or replace function upsert_thought(
  p_content text,
  p_payload jsonb default '{}'::jsonb,
  p_supersedes uuid[] default null,
  p_supersede_reason text default null
)
returns jsonb
language plpgsql
as $$
declare
  v_fingerprint text;
  v_id uuid;
  v_target uuid;
begin
  v_fingerprint := encode(sha256(convert_to(
    lower(trim(regexp_replace(p_content, '\s+', ' ', 'g'))),
    'UTF8'
  )), 'hex');

  insert into thoughts (content, content_fingerprint, metadata)
  values (p_content, v_fingerprint, coalesce(p_payload->'metadata', '{}'::jsonb))
  on conflict (content_fingerprint) where content_fingerprint is not null do update
  set updated_at = now(),
      metadata = thoughts.metadata || coalesce(excluded.metadata, '{}'::jsonb)
  returning id into v_id;

  if p_supersedes is not null then
    foreach v_target in array p_supersedes loop
      perform supersede_thought(v_target, v_id, p_supersede_reason);
    end loop;
  end if;

  return jsonb_build_object('id', v_id, 'fingerprint', v_fingerprint);
end;
$$;

-- Patch a thought in place. Content changes recompute the fingerprint with the
-- same normalization as upsert_thought and require a fresh embedding; metadata
-- patches merge, and p_metadata_remove clears keys. One statement, so partial
-- updates cannot land.
create or replace function update_thought(
  p_id uuid,
  p_content text default null,
  p_embedding vector(1536) default null,
  p_metadata_patch jsonb default '{}'::jsonb,
  p_metadata_remove text[] default array[]::text[]
)
returns jsonb
language plpgsql
as $$
declare
  v_row thoughts%rowtype;
begin
  if p_content is not null and p_embedding is null then
    raise exception 'Content updates require a regenerated embedding; refusing to change content and leave the old embedding in place.';
  end if;

  begin
    update thoughts
    set content = coalesce(p_content, content),
        content_fingerprint = case
          when p_content is not null then encode(sha256(convert_to(
            lower(trim(regexp_replace(p_content, '\s+', ' ', 'g'))),
            'UTF8'
          )), 'hex')
          else content_fingerprint
        end,
        embedding = case when p_content is not null then p_embedding else embedding end,
        metadata = (metadata || p_metadata_patch) - p_metadata_remove
    where id = p_id
    returning * into v_row;
  exception when unique_violation then
    raise exception 'Another thought already has identical content; updating % to that content would create a duplicate.', p_id;
  end;

  if v_row.id is null then
    raise exception 'Thought % does not exist; nothing was updated.', p_id;
  end if;

  return jsonb_build_object(
    'id', v_row.id,
    'content', v_row.content,
    'metadata', v_row.metadata,
    'created_at', v_row.created_at,
    'updated_at', v_row.updated_at,
    'superseded_by', v_row.superseded_by,
    'superseded_at', v_row.superseded_at,
    'supersede_reason', v_row.supersede_reason
  );
end;
$$;
