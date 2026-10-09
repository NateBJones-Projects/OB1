-- Hybrid search for Open Brain: vector similarity + Postgres full-text search,
-- fused with reciprocal rank fusion (RRF).
--
-- Vector search finds thoughts that mean the same thing as the query.
-- Full-text search finds thoughts that contain the query's exact terms
-- (names, IDs, error strings) that embeddings often miss.
-- RRF: score = sum over both legs of 1 / (60 + rank). 60 is the standard
-- constant. A thought ranked high in either leg surfaces; a thought ranked
-- in both legs ranks best.
--
-- Safe to run more than once. Does not alter or drop any existing column,
-- table, or function. Adds one index and one function.

-- 1. Full-text index on thoughts.content.
--    An expression index, so the thoughts table itself is not changed.
create index if not exists idx_thoughts_content_fts_english
  on public.thoughts using gin (to_tsvector('english', content));

-- 2. Hybrid search function.
--    Same argument family as match_thoughts, so a client swaps one RPC call.
--    Adds query_text (the raw query, for the full-text leg) and an optional
--    since filter. Returns the match_thoughts columns plus rrf_score.
create or replace function public.hybrid_match_thoughts(
  query_embedding vector(1536),
  query_text text,
  match_count int default 10,
  filter jsonb default '{}'::jsonb,
  since timestamptz default null
)
returns table (
  id uuid,
  content text,
  metadata jsonb,
  similarity float,
  created_at timestamptz,
  rrf_score float
)
language sql
stable
as $$
  with params as (
    select greatest(least(coalesce(match_count, 10), 50), 1) as k,
           greatest(least(coalesce(match_count, 10), 50) * 3, 20) as fetch_n
  ),
  vec as (
    select t.id,
           row_number() over (order by t.embedding <=> query_embedding) as rank,
           1 - (t.embedding <=> query_embedding) as sim
    from public.thoughts t
    where t.embedding is not null
      and (filter is null or filter = '{}'::jsonb or t.metadata @> filter)
      and (since is null or t.created_at >= since)
    order by t.embedding <=> query_embedding
    limit (select fetch_n from params)
  ),
  fts as (
    select t.id,
           row_number() over (
             order by ts_rank(to_tsvector('english', t.content),
                              plainto_tsquery('english', query_text)) desc
           ) as rank
    from public.thoughts t
    where to_tsvector('english', t.content) @@ plainto_tsquery('english', query_text)
      and (filter is null or filter = '{}'::jsonb or t.metadata @> filter)
      and (since is null or t.created_at >= since)
    order by ts_rank(to_tsvector('english', t.content),
                     plainto_tsquery('english', query_text)) desc
    limit (select fetch_n from params)
  ),
  fused as (
    select coalesce(v.id, f.id) as id,
           coalesce(1.0 / (60 + v.rank), 0) + coalesce(1.0 / (60 + f.rank), 0) as rrf,
           v.sim
    from vec v
    full outer join fts f on f.id = v.id
  )
  select t.id, t.content, t.metadata,
         coalesce(fused.sim, 1 - (t.embedding <=> query_embedding))::float as similarity,
         t.created_at,
         round(fused.rrf::numeric, 4)::float as rrf_score
  from fused
  join public.thoughts t on t.id = fused.id
  order by fused.rrf desc
  limit (select k from params);
$$;

-- 3. Let the service role call the function.
--    Skipped automatically on plain Postgres, where that role does not exist.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.hybrid_match_thoughts(vector, text, int, jsonb, timestamptz)
      to service_role;
  end if;
end
$$;
