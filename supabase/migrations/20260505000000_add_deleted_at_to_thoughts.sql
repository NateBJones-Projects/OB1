-- Soft-delete column for thoughts.
-- NULL = visible. Non-null timestamp = soft-deleted at that time.
-- Read paths (dashboard listThoughts/getThought/distinctMetadataValues/getNeighbors,
-- MCP search/list/stats) filter `deleted_at is null` so soft-deleted rows
-- disappear from every surface without losing the data.
--
-- Partial index keeps the visible-row scan fast as deleted rows accumulate.
--
-- Reversible:
--   drop index if exists thoughts_visible_idx;
--   alter table public.thoughts drop column if exists deleted_at;

alter table public.thoughts
  add column if not exists deleted_at timestamptz;

create index if not exists thoughts_visible_idx
  on public.thoughts (created_at desc, id desc)
  where deleted_at is null;
