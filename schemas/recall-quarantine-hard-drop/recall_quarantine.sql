create table if not exists public.recall_quarantine (
  thought_id uuid primary key references public.thoughts(id) on delete cascade,
  reason text not null default 'review_required',
  created_by text not null default current_user,
  created_at timestamptz not null default now()
);

create table if not exists public.recall_filter_audit (
  id bigserial primary key,
  query_label text,
  excluded_thought_ids uuid[] not null default '{}',
  excluded_count integer not null default 0,
  returned_count integer not null default 0,
  created_at timestamptz not null default now()
);

-- Lock both tables down to match the base recall posture. Quarantine controls what
-- recall returns, so it must never be writable with a public client key: row level
-- security is enabled unconditionally, and on Supabase-style setups (where the
-- service_role role exists) a service-role-only policy plus grant is added. On plain
-- Postgres there is no service_role; the table owner bypasses RLS, which is what the
-- local fixture and self-hosted setups use.
alter table public.recall_quarantine enable row level security;
alter table public.recall_filter_audit enable row level security;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    if not exists (
      select 1 from pg_policies
      where schemaname = 'public' and tablename = 'recall_quarantine'
        and policyname = 'Service role only'
    ) then
      execute 'create policy "Service role only" on public.recall_quarantine'
        || ' as permissive for all to service_role using (true) with check (true)';
    end if;
    if not exists (
      select 1 from pg_policies
      where schemaname = 'public' and tablename = 'recall_filter_audit'
        and policyname = 'Service role only'
    ) then
      execute 'create policy "Service role only" on public.recall_filter_audit'
        || ' as permissive for all to service_role using (true) with check (true)';
    end if;
    execute 'grant all on table public.recall_quarantine to service_role';
    execute 'grant all on table public.recall_filter_audit to service_role';
    execute 'grant usage, select on sequence public.recall_filter_audit_id_seq to service_role';
  end if;
end
$$;

-- Single-pass wrapper: the underlying match_thoughts runs exactly once per call
-- (a multi-statement version would re-run it per step and could disagree with
-- itself under concurrent writes). Runs with the caller's rights (no security
-- definer): callers that may read recall results may also be audited.
create or replace function public.match_thoughts_filtered(
  query_embedding vector(1536),
  match_threshold float default 0.0,
  match_count int default 10,
  filter jsonb default '{}'::jsonb,
  audit_query_label text default null,
  extra_candidate_count int default 25
)
returns table (
  id uuid,
  content text,
  metadata jsonb,
  similarity float,
  recall_filter jsonb
)
language sql
volatile
set search_path = public
as $$
  with raw as (
    select mt.id, mt.content, mt.metadata, mt.similarity,
           row_number() over () as rn,
           exists (
             select 1 from public.recall_quarantine rq where rq.thought_id = mt.id
           ) as is_quarantined
    from public.match_thoughts(
      query_embedding,
      match_threshold,
      match_count + greatest(extra_candidate_count, 0),
      filter
    ) as mt
  ),
  excluded as (
    select coalesce(array_agg(raw.id order by raw.rn), '{}'::uuid[]) as ids
    from raw
    where raw.is_quarantined
  ),
  filtered as (
    select raw.id, raw.content, raw.metadata, raw.similarity, raw.rn
    from raw
    where not raw.is_quarantined
    order by raw.rn
    limit match_count
  ),
  returned as (
    select coalesce(array_agg(filtered.id order by filtered.rn), '{}'::uuid[]) as ids,
           count(*)::int as n
    from filtered
  ),
  audit as (
    insert into public.recall_filter_audit
      (query_label, excluded_thought_ids, excluded_count, returned_count)
    select audit_query_label,
           excluded.ids,
           coalesce(array_length(excluded.ids, 1), 0),
           returned.n
    from excluded, returned
    where audit_query_label is not null and audit_query_label <> ''
    returning recall_filter_audit.id
  )
  select filtered.id,
         filtered.content,
         filtered.metadata,
         filtered.similarity,
         jsonb_build_object(
           'status', 'OK',
           'excluded_count', coalesce(array_length(excluded.ids, 1), 0),
           'excluded_ids', excluded.ids,
           'audit_id', (select audit.id from audit limit 1)
         ) as recall_filter
  from filtered, excluded
  order by filtered.rn;
$$;
