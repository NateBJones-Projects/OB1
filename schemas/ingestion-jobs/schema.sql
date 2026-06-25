-- Ingestion Jobs schema for Open Brain
-- Tracks dry-run import jobs, extracted items, reconciliation decisions, and execution.
--
-- This migration stores extracted/reviewable thought candidates, not full raw
-- transcripts. Keep raw exports outside the database unless a later trusted
-- workflow explicitly calls for archival storage.

create extension if not exists pgcrypto;

create table if not exists public.ingestion_jobs (
  id uuid primary key default gen_random_uuid(),
  source_type text not null default 'unknown',
  source_label text not null,
  input_hash text not null,
  input_bytes integer not null default 0 check (input_bytes >= 0),
  dry_run boolean not null default true,
  status text not null default 'pending'
    check (status in (
      'pending',
      'converting',
      'validating',
      'extracting',
      'reconciling',
      'dry_run_complete',
      'approved',
      'executing',
      'complete',
      'failed',
      'cancelled'
    )),
  extracted_count integer not null default 0 check (extracted_count >= 0),
  added_count integer not null default 0 check (added_count >= 0),
  skipped_count integer not null default 0 check (skipped_count >= 0),
  appended_count integer not null default 0 check (appended_count >= 0),
  revised_count integer not null default 0 check (revised_count >= 0),
  failed_count integer not null default 0 check (failed_count >= 0),
  error_message text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (source_type, input_hash)
);

create table if not exists public.ingestion_items (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.ingestion_jobs(id) on delete cascade,
  sequence integer not null check (sequence >= 1),
  extracted_content text not null check (
    char_length(extracted_content) > 0
    and char_length(extracted_content) <= 20000
  ),
  content_fingerprint text,
  action text not null default 'pending'
    check (action in (
      'pending',
      'add',
      'skip',
      'append_evidence',
      'create_revision'
    )),
  status text not null default 'pending'
    check (status in ('pending', 'ready', 'executed', 'failed', 'cancelled')),
  review_status text not null default 'unreviewed'
    check (review_status in ('unreviewed', 'approved', 'rejected')),
  reason text,
  matched_thought_id uuid,
  similarity_score numeric(6,5) check (
    similarity_score is null
    or (similarity_score >= 0 and similarity_score <= 1)
  ),
  result_thought_id uuid,
  error_message text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  executed_at timestamptz,
  unique (job_id, sequence)
);

create index if not exists ingestion_jobs_status_idx
  on public.ingestion_jobs (status, created_at desc);

create index if not exists ingestion_jobs_source_idx
  on public.ingestion_jobs (source_type, created_at desc);

create index if not exists ingestion_items_job_id_idx
  on public.ingestion_items (job_id, sequence);

create index if not exists ingestion_items_status_idx
  on public.ingestion_items (status, review_status);

create unique index if not exists ingestion_items_job_fingerprint_idx
  on public.ingestion_items (job_id, content_fingerprint)
  where content_fingerprint is not null;

create or replace function public.set_ingestion_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists ingestion_jobs_set_updated_at on public.ingestion_jobs;
create trigger ingestion_jobs_set_updated_at
before update on public.ingestion_jobs
for each row execute function public.set_ingestion_updated_at();

drop trigger if exists ingestion_items_set_updated_at on public.ingestion_items;
create trigger ingestion_items_set_updated_at
before update on public.ingestion_items
for each row execute function public.set_ingestion_updated_at();

create or replace function public.recount_ingestion_job(p_job_id uuid)
returns public.ingestion_jobs
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job public.ingestion_jobs;
begin
  update public.ingestion_jobs job
     set extracted_count = coalesce(counts.extracted_count, 0),
         added_count = coalesce(counts.added_count, 0),
         skipped_count = coalesce(counts.skipped_count, 0),
         appended_count = coalesce(counts.appended_count, 0),
         revised_count = coalesce(counts.revised_count, 0),
         failed_count = coalesce(counts.failed_count, 0)
    from (
      select
        count(*)::integer as extracted_count,
        count(*) filter (where action = 'add' and status = 'executed')::integer as added_count,
        count(*) filter (where action = 'skip')::integer as skipped_count,
        count(*) filter (where action = 'append_evidence' and status = 'executed')::integer as appended_count,
        count(*) filter (where action = 'create_revision' and status = 'executed')::integer as revised_count,
        count(*) filter (where status = 'failed')::integer as failed_count
      from public.ingestion_items
      where job_id = p_job_id
    ) counts
   where job.id = p_job_id
   returning job.* into v_job;

  if not found then
    raise exception 'ingestion job % not found', p_job_id;
  end if;

  return v_job;
end;
$$;

create or replace function public.append_thought_evidence(
  p_thought_id uuid,
  p_evidence jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_identity text;
  v_current_evidence jsonb;
  v_entry jsonb;
  v_count integer;
begin
  if char_length(coalesce(p_evidence->>'excerpt', '')) > 5000 then
    raise exception 'evidence excerpt is too long; store a concise excerpt, not a raw transcript';
  end if;

  v_identity := encode(
    digest(
      coalesce(p_evidence->>'source_label', '') ||
      coalesce(p_evidence->>'excerpt', '') ||
      p_thought_id::text,
      'sha256'
    ),
    'hex'
  );

  select coalesce(metadata->'evidence', '[]'::jsonb)
    into v_current_evidence
    from public.thoughts
   where id = p_thought_id
   for update;

  if not found then
    raise exception 'thought % not found', p_thought_id;
  end if;

  for v_entry in select jsonb_array_elements(v_current_evidence)
  loop
    if v_entry->>'_identity' = v_identity then
      return jsonb_build_object(
        'thought_id', p_thought_id,
        'evidence_count', jsonb_array_length(v_current_evidence),
        'action', 'already_exists'
      );
    end if;
  end loop;

  update public.thoughts
     set metadata = jsonb_set(
       coalesce(metadata, '{}'::jsonb),
       '{evidence}',
       v_current_evidence || jsonb_build_object(
         '_identity', v_identity,
         'source', p_evidence->'source',
         'source_label', p_evidence->'source_label',
         'source_locator', p_evidence->'source_locator',
         'extracted_at', p_evidence->'extracted_at',
         'excerpt', p_evidence->'excerpt',
         'review_status', coalesce(p_evidence->'review_status', '"unreviewed"'::jsonb)
       )
     )
   where id = p_thought_id;

  v_count := jsonb_array_length(v_current_evidence) + 1;

  return jsonb_build_object(
    'thought_id', p_thought_id,
    'evidence_count', v_count,
    'action', 'appended'
  );
end;
$$;

grant select, insert, update, delete on table public.ingestion_jobs to service_role;
grant select, insert, update, delete on table public.ingestion_items to service_role;
grant execute on function public.recount_ingestion_job(uuid) to service_role;
grant execute on function public.append_thought_evidence(uuid, jsonb) to service_role;

revoke all on table public.ingestion_jobs from anon, authenticated;
revoke all on table public.ingestion_items from anon, authenticated;
revoke execute on function public.recount_ingestion_job(uuid) from public;
revoke execute on function public.append_thought_evidence(uuid, jsonb) from public;

alter table public.ingestion_jobs enable row level security;
alter table public.ingestion_items enable row level security;

comment on table public.ingestion_jobs is
  'Dry-run import jobs. Stores source metadata, lifecycle status, and counts; raw source documents should stay outside the table.';

comment on table public.ingestion_items is
  'Reviewable extracted items for an ingestion job. Items are evidence-grade until approved and executed by a trusted workflow.';
