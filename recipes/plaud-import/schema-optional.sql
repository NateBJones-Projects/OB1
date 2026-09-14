-- Optional side table for `import-plaud.mjs --store-recordings`.
--
-- The ingestion metadata contract forbids storing raw transcripts in
-- `thoughts.metadata`, and a full transcript is too long to embed usefully. If
-- you want the verbatim record in the database anyway -- to re-atomize later
-- with a better model without re-exporting from Plaud -- create this table.
--
-- It is OFF by default. Everything else in the recipe works without it.
--
-- Note: this table holds complete transcripts. Apply the same access controls
-- you would apply to `thoughts` rows tiered `restricted`.

create table if not exists public.plaud_recordings (
  id                text primary key,           -- Plaud recording id
  title             text,
  start_at          timestamptz,
  duration_ms       integer,
  participants      text[],
  transcript        text,
  summary           text,
  sensitivity_tier  text not null default 'personal'
                      check (sensitivity_tier in ('standard','personal','restricted')),
  imported_at       timestamptz not null default now()
);

create index if not exists plaud_recordings_start_at_idx
  on public.plaud_recordings (start_at desc);

create index if not exists plaud_recordings_tier_idx
  on public.plaud_recordings (sensitivity_tier);

-- The importer POSTs with `Prefer: resolution=merge-duplicates`, so re-running
-- updates the row rather than failing on the primary key.

alter table public.plaud_recordings enable row level security;
-- Add your own policies. With RLS on and no policy, only the service role
-- (which the importer uses) can read or write this table.
