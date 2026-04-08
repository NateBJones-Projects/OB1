-- Create the thoughts table
create table thoughts (
  id uuid default gen_random_uuid() primary key,
  content text not null,
  embedding vector(1536),
  metadata jsonb default '{}'::jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Index for fast vector similarity search
create index on thoughts
  using hnsw (embedding vector_cosine_ops);

-- Index for filtering by metadata fields
create index on thoughts using gin (metadata);

-- Index for date range queries
create index on thoughts (created_at desc);

-- Auto-update the updated_at timestamp
create or replace function update_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger thoughts_updated_at
  before update on thoughts
  for each row
  execute function update_updated_at();