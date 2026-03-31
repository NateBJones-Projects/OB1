-- Reflections schema for Open Brain
-- Structured reasoning traces linked to thoughts
--
-- Prerequisites: pgvector extension enabled, public.thoughts table exists

-- Enable pgvector if not already enabled
create extension if not exists vector with schema extensions;

-- Reflections table
create table if not exists public.reflections (
  id              uuid primary key default gen_random_uuid(),
  thought_id      uuid references public.thoughts(id) on delete set null,
  trigger_context text,
  options         jsonb default '[]'::jsonb,
  factors         jsonb default '[]'::jsonb,
  conclusion      text,
  confidence      real check (confidence is null or (confidence >= 0 and confidence <= 1)),
  reflection_type text check (reflection_type in (
    'decision', 'analysis', 'evaluation', 'planning', 'retrospective'
  )),
  embedding       extensions.vector(1536),
  metadata        jsonb default '{}'::jsonb,
  created_at      timestamptz default now(),
  updated_at      timestamptz default now()
);

-- Indexes
create index if not exists reflections_thought_id_idx
  on public.reflections (thought_id);

create index if not exists reflections_reflection_type_idx
  on public.reflections (reflection_type);

create index if not exists reflections_embedding_idx
  on public.reflections
  using hnsw (embedding extensions.vector_cosine_ops)
  with (m = 16, ef_construction = 64);

-- Auto-update updated_at on row change
create or replace function public.reflections_update_timestamp()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger reflections_set_updated_at
  before update on public.reflections
  for each row
  execute function public.reflections_update_timestamp();

-- RPC: upsert_reflection
-- Insert or update a reflection by ID
create or replace function public.upsert_reflection(
  p_id              uuid default null,
  p_thought_id      uuid default null,
  p_trigger_context text default null,
  p_options         jsonb default '[]'::jsonb,
  p_factors         jsonb default '[]'::jsonb,
  p_conclusion      text default null,
  p_confidence      real default null,
  p_reflection_type text default null,
  p_embedding       extensions.vector default null,
  p_metadata        jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
as $$
declare
  v_id uuid;
begin
  if p_id is not null then
    insert into public.reflections (
      id, thought_id, trigger_context, options, factors,
      conclusion, confidence, reflection_type, embedding, metadata
    ) values (
      p_id, p_thought_id, p_trigger_context, p_options, p_factors,
      p_conclusion, p_confidence, p_reflection_type, p_embedding, p_metadata
    )
    on conflict (id) do update set
      thought_id      = coalesce(excluded.thought_id, reflections.thought_id),
      trigger_context = coalesce(excluded.trigger_context, reflections.trigger_context),
      options         = excluded.options,
      factors         = excluded.factors,
      conclusion      = coalesce(excluded.conclusion, reflections.conclusion),
      confidence      = excluded.confidence,
      reflection_type = coalesce(excluded.reflection_type, reflections.reflection_type),
      embedding       = coalesce(excluded.embedding, reflections.embedding),
      metadata        = reflections.metadata || excluded.metadata
    returning id into v_id;
  else
    insert into public.reflections (
      thought_id, trigger_context, options, factors,
      conclusion, confidence, reflection_type, embedding, metadata
    ) values (
      p_thought_id, p_trigger_context, p_options, p_factors,
      p_conclusion, p_confidence, p_reflection_type, p_embedding, p_metadata
    )
    returning id into v_id;
  end if;

  return v_id;
end;
$$;

-- RPC: match_reflections
-- Semantic similarity search over reflection embeddings
create or replace function public.match_reflections(
  query_embedding   extensions.vector(1536),
  match_threshold   float default 0.3,
  match_count       int default 10,
  p_reflection_type text default null
)
returns table (
  id              uuid,
  thought_id      uuid,
  trigger_context text,
  options         jsonb,
  factors         jsonb,
  conclusion      text,
  confidence      real,
  reflection_type text,
  metadata        jsonb,
  similarity      float,
  created_at      timestamptz
)
language plpgsql
as $$
begin
  return query
  select
    r.id,
    r.thought_id,
    r.trigger_context,
    r.options,
    r.factors,
    r.conclusion,
    r.confidence,
    r.reflection_type,
    r.metadata,
    1 - (r.embedding <=> query_embedding) as similarity,
    r.created_at
  from public.reflections r
  where r.embedding is not null
    and 1 - (r.embedding <=> query_embedding) > match_threshold
    and (p_reflection_type is null or r.reflection_type = p_reflection_type)
  order by r.embedding <=> query_embedding
  limit match_count;
end;
$$;

-- Grants
grant select, insert, update, delete on table public.reflections to service_role;
grant execute on function public.upsert_reflection(uuid, uuid, text, jsonb, jsonb, text, real, text, extensions.vector, jsonb) to service_role;
grant execute on function public.match_reflections(extensions.vector, float, int, text) to service_role;

-- RLS: enable row-level security (no policies = service-role only by default)
alter table public.reflections enable row level security;
