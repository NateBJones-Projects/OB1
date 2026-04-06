-- Fix: household shared-table RLS policies recurse through household_members
--
-- The shared household tables use policies like:
--   household_id IN (SELECT household_id FROM household_members WHERE user_id = auth.uid())
-- But household_members itself also has a self-referential SELECT policy,
-- which can trigger PostgreSQL 42P17 infinite recursion.
--
-- Fix: centralize membership lookups behind SECURITY DEFINER helpers and
-- rewrite affected policies to use those helpers instead of subquerying
-- household_members directly.

create or replace function public.get_my_household_id()
returns uuid
language sql
security definer
stable
set search_path = ''
as $$
  select household_id
  from public.household_members
  where user_id = auth.uid()
  limit 1;
$$;

create or replace function public.get_my_household_role()
returns text
language sql
security definer
stable
set search_path = ''
as $$
  select role
  from public.household_members
  where user_id = auth.uid()
  limit 1;
$$;

create or replace function public.is_my_household_owner()
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select coalesce(public.get_my_household_role() = 'owner', false);
$$;

create or replace function public.get_my_household_membership()
returns table (household_id uuid, role text)
language sql
security definer
stable
set search_path = ''
as $$
  select hm.household_id, hm.role
  from public.household_members hm
  where hm.user_id = auth.uid()
  limit 1;
$$;

drop policy if exists "household_members_select" on household_members;
drop policy if exists "household_members_insert" on household_members;
drop policy if exists "household_members_update" on household_members;
drop policy if exists "household_members_delete" on household_members;

create policy "household_members_select" on household_members
  for select using (
    household_id = public.get_my_household_id()
  );

create policy "household_members_insert" on household_members
  for insert with check (
    household_id = public.get_my_household_id()
    and public.is_my_household_owner()
  );

create policy "household_members_update" on household_members
  for update
  using (
    household_id = public.get_my_household_id()
    and public.is_my_household_owner()
  )
  with check (
    household_id = public.get_my_household_id()
    and public.is_my_household_owner()
  );

create policy "household_members_delete" on household_members
  for delete using (
    household_id = public.get_my_household_id()
    and public.is_my_household_owner()
  );

drop policy if exists "maintenance_tasks_select" on maintenance_tasks;
drop policy if exists "maintenance_tasks_insert" on maintenance_tasks;
drop policy if exists "maintenance_tasks_update" on maintenance_tasks;
drop policy if exists "maintenance_tasks_delete" on maintenance_tasks;

create policy "maintenance_tasks_select" on maintenance_tasks
  for select using (household_id = public.get_my_household_id());

create policy "maintenance_tasks_insert" on maintenance_tasks
  for insert with check (household_id = public.get_my_household_id());

create policy "maintenance_tasks_update" on maintenance_tasks
  for update
  using (household_id = public.get_my_household_id())
  with check (household_id = public.get_my_household_id());

create policy "maintenance_tasks_delete" on maintenance_tasks
  for delete using (
    household_id = public.get_my_household_id()
    and public.is_my_household_owner()
  );

drop policy if exists "maintenance_logs_select" on maintenance_logs;
drop policy if exists "maintenance_logs_insert" on maintenance_logs;
drop policy if exists "maintenance_logs_update" on maintenance_logs;
drop policy if exists "maintenance_logs_delete" on maintenance_logs;

create policy "maintenance_logs_select" on maintenance_logs
  for select using (household_id = public.get_my_household_id());

create policy "maintenance_logs_insert" on maintenance_logs
  for insert with check (household_id = public.get_my_household_id());

create policy "maintenance_logs_update" on maintenance_logs
  for update
  using (household_id = public.get_my_household_id())
  with check (household_id = public.get_my_household_id());

create policy "maintenance_logs_delete" on maintenance_logs
  for delete using (
    household_id = public.get_my_household_id()
    and public.is_my_household_owner()
  );

drop policy if exists "household_items_select" on household_items;
drop policy if exists "household_items_insert" on household_items;
drop policy if exists "household_items_update" on household_items;
drop policy if exists "household_items_delete" on household_items;

create policy "household_items_select" on household_items
  for select using (household_id = public.get_my_household_id());

create policy "household_items_insert" on household_items
  for insert with check (household_id = public.get_my_household_id());

create policy "household_items_update" on household_items
  for update
  using (household_id = public.get_my_household_id())
  with check (household_id = public.get_my_household_id());

create policy "household_items_delete" on household_items
  for delete using (
    household_id = public.get_my_household_id()
    and public.is_my_household_owner()
  );

drop policy if exists "household_vendors_select" on household_vendors;
drop policy if exists "household_vendors_insert" on household_vendors;
drop policy if exists "household_vendors_update" on household_vendors;
drop policy if exists "household_vendors_delete" on household_vendors;

create policy "household_vendors_select" on household_vendors
  for select using (household_id = public.get_my_household_id());

create policy "household_vendors_insert" on household_vendors
  for insert with check (household_id = public.get_my_household_id());

create policy "household_vendors_update" on household_vendors
  for update
  using (household_id = public.get_my_household_id())
  with check (household_id = public.get_my_household_id());

create policy "household_vendors_delete" on household_vendors
  for delete using (
    household_id = public.get_my_household_id()
    and public.is_my_household_owner()
  );

notify pgrst, 'reload schema';
