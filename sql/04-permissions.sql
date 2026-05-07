-- =============================================================
-- Step 2.5: Grant service_role access
-- From: Nate's OB1 getting-started guide
-- Run: Supabase SQL Editor → New query → paste and Run
-- =============================================================

-- Allow the service_role to read and write thoughts
grant select, insert, update, delete on table public.thoughts to service_role;
