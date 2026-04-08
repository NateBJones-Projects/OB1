-- Lock down security
alter table thoughts enable row level security;

create policy "Service role full access"
  on thoughts
  for all
  using (auth.role() = 'service_role');
  
-- Grant permissions to service_role
grant select, insert, update, delete on table public.thoughts to service_role;