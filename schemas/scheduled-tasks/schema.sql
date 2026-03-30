create table scheduled_tasks (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  description text,
  enabled boolean default true,

  -- Trigger configuration
  trigger_type text not null check (trigger_type in ('cron', 'due_date', 'event', 'manual')),
  cron_expression text,
  due_date_source text,
  due_date_lead_days int default 1,
  event_source text,
  event_lead_hours int default 2,

  -- Data gathering
  gather_config jsonb not null default '{}',

  -- Execution
  task_type text not null check (task_type in (
    'llm_prompt', 'alert_digest', 'deck_builder', 'stale_loop_scan', 'trend_analysis'
  )),
  prompt_template text,
  deck_template_id text,
  output_format text default 'markdown' check (output_format in ('markdown', 'html', 'pptx', 'json')),

  -- Delivery
  delivery_channel text not null default 'email' check (delivery_channel in ('email', 'telegram', 'slack', 'file', 'mcp_response')),
  delivery_config jsonb default '{}',

  -- Metadata
  last_run_at timestamptz,
  last_run_status text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table task_run_log (
  id uuid primary key default gen_random_uuid(),
  task_id uuid references scheduled_tasks(id) on delete cascade,
  started_at timestamptz default now(),
  completed_at timestamptz,
  status text not null default 'running' check (status in ('running', 'success', 'error')),
  input_summary text,
  output_summary text,
  error_message text,
  delivery_status text
);

create index idx_task_runs_task_id on task_run_log(task_id);
create index idx_scheduled_tasks_trigger on scheduled_tasks(trigger_type) where enabled = true;
