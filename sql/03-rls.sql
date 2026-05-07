-- =============================================================
-- Step 2.4: Row Level Security
-- From: Nate's OB1 getting-started guide
-- Run: Supabase SQL Editor → New query → paste and Run
-- =============================================================

alter table thoughts enable row level security;

create policy "Service role full access"
  on thoughts
  for all
  using (auth.role() = 'service_role');
