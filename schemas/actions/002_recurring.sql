-- Add recurrence columns to actions table
alter table actions add column recurrence text check (recurrence in ('daily', 'weekly', 'monthly'));
alter table actions add column recurrence_source_id uuid references actions(id) on delete set null;

-- Index for finding recurring actions due for regeneration
create index idx_actions_recurrence on actions(recurrence) where recurrence is not null;
