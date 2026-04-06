-- Ingestion Jobs schema for Open Brain
-- Tracks document ingestion through extract, dedup, reconcile, and execute lifecycle
--
-- Prerequisites: public.thoughts table exists

-- 1. ingestion_jobs -- one row per ingest invocation
create table if not exists public.ingestion_jobs (
  id              uuid primary key default gen_random_uuid(),
  source_label    text,
  input_hash      text not null unique,
  input_length    int,
  status          text not null default 'pending'
                    check (status in (
                      'pending', 'extracting', 'dry_run_complete',
                      'executing', 'complete', 'failed'
                    )),
  extracted_count int default 0,
  added_count     int default 0,
  skipped_count   int default 0,
  appended_count  int default 0,
  revised_count   int default 0,
  error_message   text,
  metadata        jsonb default '{}'::jsonb,
  created_at      timestamptz default now(),
  completed_at    timestamptz
);

-- 2. ingestion_items -- individual extracted thoughts within a job
create table if not exists public.ingestion_items (
  id                uuid primary key default gen_random_uuid(),
  job_id            uuid not null references public.ingestion_jobs(id) on delete cascade,
  extracted_content text not null,
  action            text not null default 'pending'
                      check (action in (
                        'pending', 'add', 'skip', 'append_evidence', 'create_revision'
                      )),
  status            text not null default 'pending'
                      check (status in ('pending', 'ready', 'executed', 'failed')),
  reason            text,
  matched_thought_id uuid,
  similarity_score  numeric(5,4),
  result_thought_id uuid,
  error_message     text,
  metadata          jsonb default '{}'::jsonb,
  created_at        timestamptz default now()
);

-- Indexes
create index if not exists ingestion_items_job_id_idx
  on public.ingestion_items (job_id);

-- 3. append_thought_evidence RPC
--    Appends to metadata.evidence[] on an existing thought.
--    Idempotent via SHA-256 identity of (source_label || excerpt || thought_id).
create or replace function public.append_thought_evidence(
  p_thought_id uuid,
  p_evidence   jsonb  -- {source, extracted_at, excerpt, source_label}
)
returns jsonb
language plpgsql
security definer
as $$
declare
  v_identity text;
  v_current_evidence jsonb;
  v_entry jsonb;
  v_count int;
begin
  -- Compute a stable identity for this evidence entry
  v_identity := encode(
    sha256(
      convert_to(
        coalesce(p_evidence->>'source_label', '') ||
        coalesce(p_evidence->>'excerpt', '') ||
        p_thought_id::text,
        'UTF8'
      )
    ),
    'hex'
  );

  -- Fetch current evidence array
  select coalesce(metadata->'evidence', '[]'::jsonb)
    into v_current_evidence
    from public.thoughts
   where id = p_thought_id
   for update;

  if not found then
    raise exception 'thought % not found', p_thought_id;
  end if;

  -- Check for duplicate by scanning existing identities
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

  -- Append new evidence entry with identity tag
  update public.thoughts
     set metadata = jsonb_set(
           coalesce(metadata, '{}'::jsonb),
           '{evidence}',
           v_current_evidence || jsonb_build_object(
             '_identity', v_identity,
             'source', p_evidence->'source',
             'extracted_at', p_evidence->'extracted_at',
             'excerpt', p_evidence->'excerpt',
             'source_label', p_evidence->'source_label'
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

-- Grant access to service_role
grant select, insert, update, delete on table public.ingestion_jobs to service_role;
grant select, insert, update, delete on table public.ingestion_items to service_role;
grant execute on function public.append_thought_evidence to service_role;
revoke execute on function public.append_thought_evidence(uuid, jsonb) from public;

-- RLS: enable row-level security (no policies = service-role only by default)
alter table public.ingestion_jobs enable row level security;
alter table public.ingestion_items enable row level security;
