create extension if not exists pgcrypto;

do $$
begin
  create type public.errata_domain as enum (
    'engineering',
    'product',
    'ops',
    'customer_success',
    'finance',
    'gtm',
    'other'
  );
exception when duplicate_object then null;
end $$;

do $$
begin
  create type public.errata_escape_point as enum (
    'authored_unreviewed',
    'passed_ai_review',
    'passed_human_review',
    'passed_ci',
    'reached_prod',
    'no_guardrail_existed'
  );
exception when duplicate_object then null;
end $$;

do $$
begin
  create type public.errata_responsible_actor as enum (
    'coding_agent',
    'review_agent',
    'human',
    'pair',
    'process_absent',
    'external'
  );
exception when duplicate_object then null;
end $$;

do $$
begin
  create type public.errata_severity as enum (
    'low',
    'medium',
    'high',
    'critical'
  );
exception when duplicate_object then null;
end $$;

do $$
begin
  create type public.errata_status as enum (
    'captured',
    'rca',
    'remediation_proposed',
    'remediating',
    'resolved',
    'accepted_risk',
    'recurred'
  );
exception when duplicate_object then null;
end $$;

do $$
begin
  create type public.errata_artifact_kind as enum (
    'pr',
    'commit',
    'bead',
    'spec',
    'doctrine_page',
    'config_change'
  );
exception when duplicate_object then null;
end $$;

create table if not exists public.root_cause_classes (
  slug text primary key,
  label text not null,
  description text,
  domain public.errata_domain,
  status text not null default 'active'
    check (status in ('active', 'merged_into', 'deprecated')),
  merged_into text references public.root_cause_classes(slug),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.errata (
  id uuid primary key default gen_random_uuid(),
  canonical_thought_id uuid,
  workspace_id text not null default 'default',
  title text not null,
  summary text not null default '',
  domain public.errata_domain not null default 'other',
  escape_point public.errata_escape_point not null default 'authored_unreviewed',
  responsible_actor public.errata_responsible_actor not null default 'process_absent',
  actor_agent text,
  actor_model text,
  actor_harness text,
  root_cause_class text not null,
  caught_by text,
  introduced_at timestamptz,
  detected_at timestamptz,
  severity public.errata_severity not null default 'medium',
  impact jsonb not null default '{}'::jsonb,
  status public.errata_status not null default 'captured',
  idempotency_key text unique,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.errata_cause_links (
  id uuid primary key default gen_random_uuid(),
  erratum_id uuid not null references public.errata(id) on delete cascade,
  target_kind text not null check (target_kind in ('pr', 'commit')),
  target_ref text not null,
  repo text,
  author_actor text,
  merged_at timestamptz,
  role text not null default 'suspected'
    check (role in ('introduced', 'contributed', 'suspected')),
  confidence numeric check (confidence is null or (confidence >= 0 and confidence <= 1)),
  source_timestamp timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (erratum_id, target_kind, target_ref, role)
);

create table if not exists public.errata_resolution_links (
  id uuid primary key default gen_random_uuid(),
  erratum_id uuid not null references public.errata(id) on delete cascade,
  target_kind public.errata_artifact_kind not null,
  target_ref text not null,
  repo text,
  kind text not null
    check (kind in ('immediate_fix', 'systemic_remediation')),
  scope text not null
    check (scope in ('repo', 'openclaw', 'doctrine', 'review_process', 'business_process')),
  status_mirror text,
  source_timestamp timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (erratum_id, target_kind, target_ref, kind)
);

create table if not exists public.errata_bug_links (
  id uuid primary key default gen_random_uuid(),
  erratum_id uuid not null references public.errata(id) on delete cascade,
  bug_ref text not null,
  bug_kind text not null default 'stakeholder_request',
  role text not null default 'cause',
  contribution_weight numeric check (
    contribution_weight is null or (contribution_weight >= 0 and contribution_weight <= 1)
  ),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (erratum_id, bug_ref, role)
);

create table if not exists public.errata_impact_links (
  id uuid primary key default gen_random_uuid(),
  erratum_id uuid not null references public.errata(id) on delete cascade,
  target_kind text not null check (target_kind in ('account', 'customer', 'company', 'person')),
  target_ref text not null,
  display_name text,
  organization_id text,
  user_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (erratum_id, target_kind, target_ref)
);

create table if not exists public.errata_thought_links (
  id uuid primary key default gen_random_uuid(),
  erratum_id uuid not null references public.errata(id) on delete cascade,
  thought_id uuid not null,
  link_kind text not null default 'discussion'
    check (link_kind in ('canonical_summary', 'intake', 'rca', 'fix', 'discussion', 'status_change', 'related', 'source_evidence', 'verification')),
  is_current boolean not null default true,
  source_timestamp timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (erratum_id, thought_id, link_kind)
);

create table if not exists public.errata_status_events (
  id uuid primary key default gen_random_uuid(),
  erratum_id uuid not null references public.errata(id) on delete cascade,
  from_status public.errata_status,
  to_status public.errata_status not null,
  actor text,
  at timestamptz not null default now(),
  note text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.errata_relations (
  id uuid primary key default gen_random_uuid(),
  from_erratum_id uuid not null references public.errata(id) on delete cascade,
  to_erratum_id uuid not null references public.errata(id) on delete cascade,
  relation text not null check (relation in ('duplicate_of', 'recurrence_of', 'related')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  check (from_erratum_id <> to_erratum_id),
  unique (from_erratum_id, to_erratum_id, relation)
);

create table if not exists public.errata_audit_events (
  id uuid primary key default gen_random_uuid(),
  erratum_id uuid not null references public.errata(id) on delete cascade,
  event_type text not null,
  actor text,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create or replace function public.errata_touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'root_cause_classes_touch_updated_at') then
    create trigger root_cause_classes_touch_updated_at
    before update on public.root_cause_classes
    for each row execute function public.errata_touch_updated_at();
  end if;

  if not exists (select 1 from pg_trigger where tgname = 'errata_touch_updated_at') then
    create trigger errata_touch_updated_at
    before update on public.errata
    for each row execute function public.errata_touch_updated_at();
  end if;
end $$;

create index if not exists errata_status_idx on public.errata(status);
create index if not exists errata_domain_idx on public.errata(domain);
create index if not exists errata_root_cause_class_idx on public.errata(root_cause_class);
create index if not exists errata_detected_at_idx on public.errata(detected_at desc nulls last);
create index if not exists errata_cause_links_erratum_idx on public.errata_cause_links(erratum_id);
create index if not exists errata_resolution_links_erratum_idx on public.errata_resolution_links(erratum_id);
create index if not exists errata_bug_links_erratum_idx on public.errata_bug_links(erratum_id);
create index if not exists errata_bug_links_bug_ref_idx on public.errata_bug_links(bug_ref);
create index if not exists errata_impact_links_erratum_idx on public.errata_impact_links(erratum_id);
create index if not exists errata_thought_links_erratum_idx on public.errata_thought_links(erratum_id);
create index if not exists errata_thought_links_thought_idx on public.errata_thought_links(thought_id);
create index if not exists errata_status_events_erratum_idx on public.errata_status_events(erratum_id);
create index if not exists errata_relations_from_idx on public.errata_relations(from_erratum_id);
create index if not exists errata_relations_to_idx on public.errata_relations(to_erratum_id);
create index if not exists errata_audit_events_erratum_idx on public.errata_audit_events(erratum_id);

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'root_cause_classes',
    'errata',
    'errata_cause_links',
    'errata_resolution_links',
    'errata_bug_links',
    'errata_impact_links',
    'errata_thought_links',
    'errata_status_events',
    'errata_relations',
    'errata_audit_events'
  ] loop
    execute format('alter table public.%I enable row level security', table_name);
    execute format('grant select, insert, update, delete on table public.%I to service_role', table_name);

    if not exists (
      select 1
      from pg_policies
      where schemaname = 'public'
        and tablename = table_name
        and policyname = 'service_role_all'
    ) then
      execute format(
        'create policy service_role_all on public.%I for all to service_role using (true) with check (true)',
        table_name
      );
    end if;
  end loop;
end $$;
