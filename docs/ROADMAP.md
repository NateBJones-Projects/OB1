# BigOleBrain Feature Roadmap

> Drop this file in your repo root or `docs/`. When working with Claude Code, reference a specific feature by name: `"Build Feature 1.1: Actions table — see docs/ROADMAP.md for the spec."`

---

## Guard rails (applies to every feature)

- Never modify the core `thoughts` table structure. Adding columns is fine; altering or dropping existing ones is not.
- MCP servers must be remote Supabase Edge Functions — no local Node.js servers, no `StdioServerTransport`.
- No credentials or secrets in code. Use Supabase environment variables (`Deno.env.get()`).
- Follow the existing Edge Function pattern in `supabase/functions/open-brain-mcp/index.ts`: Hono app, `StreamableHTTPTransport`, `x-brain-key` or `?key=` auth.
- Every new table needs a `README.md` + `metadata.json` in its subfolder per `CONTRIBUTING.md`.
- Dashboards use Next.js + Tailwind, deployed to Vercel. See `dashboards/data-browser/` for the template.
- SQL files must never contain `DROP TABLE`, `DROP DATABASE`, `TRUNCATE`, or unqualified `DELETE FROM`.

---

## Phase 1: Close the loops

### Feature 1.1: Actions table ✅ COMPLETE

**Status:** Deployed. Schema and MCP tools (`create_action`, `update_action`, `complete_action`, `list_actions`, `search_actions`) are live.

**Category:** `schemas/actions` + MCP tool additions to `supabase/functions/open-brain-mcp/index.ts`

<details>
<summary>Original spec (reference)</summary>

A separate `actions` table for trackable work items extracted from thoughts. The current system stores action items as metadata inside the `thoughts` table JSONB — they can't be updated, completed, or queried independently.

**Schema (`schemas/actions/schema.sql`):**

```sql
create table actions (
  id uuid primary key default gen_random_uuid(),
  thought_id uuid references thoughts(id) on delete set null,
  content text not null,
  status text not null default 'open' check (status in ('open', 'in_progress', 'done', 'cancelled')),
  due_date date,
  completed_at timestamptz,
  completion_note text,
  blocked_by text,
  unblocks text,
  tags text[] default '{}',
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index idx_actions_status on actions(status);
create index idx_actions_due_date on actions(due_date);
create index idx_actions_thought_id on actions(thought_id);

-- Auto-update updated_at
create or replace function update_actions_timestamp()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger actions_updated_at
  before update on actions
  for each row execute function update_actions_timestamp();
```

**MCP tools:**

| Tool | Params | Description |
|------|--------|-------------|
| `create_action` | `content`, `due_date?`, `tags?`, `thought_id?`, `blocked_by?`, `unblocks?` | Create a new action. If `thought_id` provided, links to source thought. |
| `update_action` | `id`, `status?`, `due_date?`, `blocked_by?`, `unblocks?`, `tags?` | Update any mutable field. |
| `complete_action` | `id`, `completion_note` | Sets status=done, completed_at=now(). `completion_note` is required. |
| `list_actions` | `status?`, `days?`, `tag?`, `limit?` | List actions filtered by status, recency, or tag. |
| `search_actions` | `query`, `limit?` | Full-text search across action content and completion notes. |

</details>

---

### Feature 1.1a: UUID exposure in retrieval tools

**Category:** Patch to `supabase/functions/open-brain-mcp/index.ts`

**What to build:**

Add the `id` (UUID) field to the output of `search_thoughts`, `list_thoughts`, and `capture_thought`. Currently these tools don't return the thought's UUID, which makes it impossible to link a thought to an action via `thought_id` in a single conversational turn.

**Changes to `open-brain-mcp/index.ts`:**

1. **`list_thoughts`** — add `id` to the select statement and output:
```typescript
// Change this:
.select("content, metadata, created_at")
// To this:
.select("id, content, metadata, created_at")
```
Update the output format to include the ID:
```typescript
return `${i + 1}. [${t.id}] [${new Date(t.created_at).toLocaleDateString()}] ...`
```

2. **`search_thoughts`** — add `id` to the type annotation and output:
```typescript
// The match_thoughts RPC already returns id — just include it in the output.
t: { id: string; content: string; metadata: Record<string, unknown>; similarity: number; created_at: string; }
parts.unshift(`ID: ${t.id}`);
```

3. **`capture_thought`** — return the new thought's UUID after insert:
```typescript
const { data: inserted, error } = await supabase.from("thoughts").insert({...}).select("id").single();
confirmation = `[${inserted.id}] ` + confirmation;
```

4. **`list_actions`** and **`search_actions`** — verify these already return `id`. If not, apply the same pattern.

**Why this matters:**
Without UUIDs in the output, a workflow like "find the thought about HVAC ductwork and create an action linked to it" requires the user to manually look up the ID in Supabase. With UUIDs exposed, Claude can do `search_thoughts` → grab the ID → pass it as `thought_id` to `create_action` in one turn.

**Test prompts after deploy:**
```
Search my thoughts for "Integrity Air"
→ Should return results with UUID visible

Create an action from that thought: "Call Integrity Air for ductwork estimate"
→ Claude should use the UUID from the search result as thought_id
```

---

### Feature 1.1b: Recurring actions

**Category:** Schema migration + MCP tool updates in `supabase/functions/open-brain-mcp/index.ts`

**What to build:**

Add recurrence support to the `actions` table so repeating tasks (weekly reviews, monthly maintenance checks, daily standup prep) automatically generate new instances when completed.

**Schema migration (`schemas/actions/002_recurring.sql`):**

```sql
-- Add recurrence columns to actions table
alter table actions add column recurrence text check (recurrence in ('daily', 'weekly', 'monthly'));
alter table actions add column recurrence_source_id uuid references actions(id) on delete set null;

-- Index for finding recurring actions due for regeneration
create index idx_actions_recurrence on actions(recurrence) where recurrence is not null;
```

**Column definitions:**
- `recurrence`: `null` = one-time action. `'daily'` / `'weekly'` / `'monthly'` = repeating.
- `recurrence_source_id`: When a recurring action is completed and a new instance is spawned, the new instance points back to the completed one. This creates a chain for completion history.

**MCP tool changes:**

1. **`create_action`** — add optional `recurrence` param.

2. **`complete_action`** — when completing a recurring action, auto-spawn the next instance:
```typescript
if (completedAction.recurrence) {
  const nextDue = calculateNextDue(completedAction.due_date, completedAction.recurrence);
  await supabase.from("actions").insert({
    content: completedAction.content,
    status: 'open',
    due_date: nextDue,
    recurrence: completedAction.recurrence,
    recurrence_source_id: completedAction.id,
    tags: completedAction.tags,
  });
}
```

3. **Due date calculation logic:**
```typescript
function calculateNextDue(currentDue: string | null, recurrence: string): string {
  const base = currentDue ? new Date(currentDue) : new Date();
  switch (recurrence) {
    case 'daily':
      base.setDate(base.getDate() + 1);
      break;
    case 'weekly':
      base.setDate(base.getDate() + 7);
      break;
    case 'monthly':
      base.setMonth(base.getMonth() + 1);
      break;
  }
  return base.toISOString().split('T')[0];
}
```

4. **`list_actions`** — add optional `recurring_only` boolean filter. Show `(recurring: weekly)` badge in output.

**Key decisions:**
- Recurrence lives on the action itself, not a separate schedule table.
- New instances spawn on completion, not on a cron. Avoids guilt-pile-up of stacked copies.
- `recurrence_source_id` chain gives you completion history for any recurring task.
- Due dates anchor to the schedule, not completion date: "Weekly review" due Sunday March 29, completed Friday March 27 → next due Sunday April 5.

**Test prompts after deploy:**
```
Create a recurring action: Weekly review. Recurrence: weekly. Due: Sunday. Tag: productivity.

Complete action [id]: Completed weekly review — surfaced 3 stale loops, captured 2 new action items.
→ Should confirm completion AND show that next instance was created with due date = next Sunday.

List my open actions.
→ Should show the newly spawned weekly review with next Sunday's due date.
```

---

### Feature 1.1c: Due dates on recurring actions

**Category:** Included in Feature 1.1b — this is a design note, not a separate build.

**Clarification:**

Feature 1.1b already handles due dates on recurring actions. When `complete_action` spawns the next instance, it calculates `due_date` from the current instance's due date (not from today). This means:

- If "Weekly review" is due Sunday March 29 and you complete it on Friday March 27, the next instance is due Sunday April 5 (7 days from the *due date*, not from *today*).
- If you complete it late on Tuesday April 1, the next instance is still due Sunday April 5 — it anchors to the schedule, not your completion date.
- If `due_date` is null on the source action, it falls back to calculating from today.

**The daily prioritization prompt should weight recurring actions with approaching due dates the same as one-time actions.** No special treatment.

---

### Feature 1.1d: Scheduled task engine

**Category:** `schemas/scheduled-tasks` + `supabase/functions/task-runner/index.ts`

**What to build:**

A general-purpose engine for "Claude takes action based on a trigger." The Andrea deck prep, morning briefing, stale loop detection, alerting — these are all the same shape:

```
Trigger (date, cron, event) → Data gathering (query brain) → Execution (LLM + output) → Delivery (email, Slack, file)
```

Building each one as a standalone Edge Function creates maintenance sprawl. Instead, build one task runner that executes registered task definitions.

**Schema (`schemas/scheduled-tasks/schema.sql`):**

```sql
create table scheduled_tasks (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  description text,
  enabled boolean default true,

  -- Trigger configuration
  trigger_type text not null check (trigger_type in ('cron', 'due_date', 'event', 'manual')),
  cron_expression text,                    -- for cron triggers: '0 7 * * *'
  due_date_source text,                    -- for due_date triggers: 'actions', 'important_dates', 'maintenance_tasks'
  due_date_lead_days int default 1,        -- how many days before due_date to fire
  event_source text,                       -- for event triggers: 'google_calendar'
  event_lead_hours int default 2,          -- how many hours before event to fire

  -- Data gathering configuration (what to pull from the brain)
  gather_config jsonb not null default '{}',

  -- Execution configuration (what to do with the gathered data)
  task_type text not null check (task_type in (
    'llm_prompt',        -- send gathered data to LLM with a prompt template
    'alert_digest',      -- format as notification digest
    'deck_builder',      -- generate a slide deck from template
    'stale_loop_scan',   -- specialized: find stale actions/questions
    'trend_analysis'     -- specialized: compute weekly metrics
  )),
  prompt_template text,            -- for llm_prompt: the system prompt to use
  deck_template_id text,           -- for deck_builder: reference to a template config
  output_format text default 'markdown' check (output_format in ('markdown', 'html', 'pptx', 'json')),

  -- Delivery configuration
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
  input_summary text,       -- what data was gathered
  output_summary text,      -- what was produced
  error_message text,
  delivery_status text       -- 'sent', 'failed', 'skipped'
);

create index idx_task_runs_task_id on task_run_log(task_id);
create index idx_scheduled_tasks_trigger on scheduled_tasks(trigger_type) where enabled = true;
```

**Edge Function: `supabase/functions/task-runner/index.ts`**

One function, called by `pg_cron` on a regular interval (every 15 minutes or hourly). On each run:

```
1. Query scheduled_tasks where enabled = true
2. For each task, evaluate trigger:
   - cron: does cron_expression match current time window?
   - due_date: are there items in due_date_source due within due_date_lead_days?
   - event: are there calendar events within event_lead_hours?
   - manual: skip (only fires via MCP tool)
3. For triggered tasks, execute gather phase using gather_config
4. Execute task_type handler with gathered data
5. Deliver output via delivery_channel
6. Log to task_run_log
```

**MCP tools:**

| Tool | Params | Description |
|------|--------|-------------|
| `create_scheduled_task` | `name`, `trigger_type`, `task_type`, `gather_config`, `delivery_channel`, + trigger-specific params | Register a new scheduled task. |
| `update_scheduled_task` | `id`, any mutable field | Update task configuration. |
| `list_scheduled_tasks` | `enabled_only?` (default true) | Show all registered tasks with last run status. |
| `run_task_now` | `id` or `name` | Manually trigger any task regardless of schedule. |
| `task_run_history` | `task_id?`, `limit?` (default 10) | View recent task execution logs. |

**Pre-built task types (register as seed data):**

| Task name | trigger_type | task_type | Description |
|-----------|-------------|-----------|-------------|
| `morning-briefing` | `cron` (`0 7 * * 1-5`) | `llm_prompt` | Weekday morning prioritization |
| `weekly-review` | `cron` (`0 9 * * 0`) | `llm_prompt` | Sunday weekly review |
| `stale-loop-scan` | `cron` (`0 9 * * 1`) | `stale_loop_scan` | Monday scan for stale actions/questions |
| `alert-digest` | `cron` (`0 7 * * *`) | `alert_digest` | Daily scan of approaching due dates |
| `andrea-deck-prep` | `event` | `deck_builder` | Pre-populate Andrea deck before calendar events |
| `weekly-trends` | `cron` (`0 9 * * 0`) | `trend_analysis` | Compute topic velocity, sentiment shifts |

**Build order within this feature:**

```
Step 1: Schema + task runner Edge Function with manual trigger only
Step 2: Add cron trigger evaluation
Step 3: Implement llm_prompt task type (powers morning briefing + weekly review)
Step 4: Implement alert_digest task type (replaces standalone alerting)
Step 5: Implement stale_loop_scan task type (scheduled mode of 3.2)
Step 6: Implement deck_builder task type (Andrea deck — BLOCKED on template)
Step 7: Add event trigger (Google Calendar integration)
Step 8: Implement trend_analysis task type (scheduled mode of 4.2)
```

**Dependencies:**
- Feature 1.1a (UUID exposure) — tasks that reference specific thoughts/actions need IDs.
- Feature 1.1b (recurring actions) — the task engine itself should be testable as a recurring action.
- Delivery infra: at minimum, email via Resend or Telegram via existing bot.

**TODO before deck_builder task type can be built:**
```
- Upload or describe the Andrea deck template:
  - How many slides?
  - What content goes on each slide?
  - What's the visual layout / branding?
  - Is it a standard PPTX template file, or a structure you recreate each time?
```

**Test prompts after deploy:**
```
List my scheduled tasks.
→ Should show all registered tasks with enabled/disabled status and last run time.

Run the morning briefing task now.
→ Should gather today's actions + calendar + recent thoughts, run the prioritization prompt, deliver via configured channel.

Create a new scheduled task: "Friday project status" — cron every Friday at 3pm,
gathers open actions tagged "litmus" and thoughts from the last 7 days about Litmus,
runs an LLM prompt to summarize status and blockers, delivers via email.
→ Should register the task. Then "Run Friday project status now" to test it.
```

---

### Feature 1.2: Action dashboard (command center)

> **⚠️ CONFLICT NOTE:** The original roadmap defined Feature 1.2 as "Thought visualization dashboard" (`dashboards/thought-explorer`) and Feature 1.3 as "Calendar view" (extending thought-explorer). **Both have been built and deployed.** The chat version reframes 1.2 as an action-oriented "command center" (`dashboards/command-center`) that absorbs the calendar view as its "Upcoming" tab and repositions the thought feed as secondary. **Resolution:** Build the command center as the new primary dashboard. The existing `thought-explorer` remains deployed and functional — it can be deprecated later or kept as the read-only thought review tool while the command center handles action-driving workflows.

**Category:** `dashboards/command-center`

**Design intent:**

This is not a thought explorer. It's a cognitive load reducer. The dashboard exists to answer two questions: **"What needs my attention?"** and **"What do I do next?"** Every view should drive toward action.

Clone `dashboards/data-browser/` as the starting skeleton.

**Primary views:**

1. **Today view** (default landing page): A single screen showing everything that needs attention right now. Not a timeline of thoughts — a prioritized action surface.
   - **Due today / overdue:** Actions with `due_date <= today` and `status = 'open'`. Red if overdue, amber if due today.
   - **Upcoming this week:** Actions due within 7 days, maintenance tasks due within 7 days, important dates within 7 days.
   - **Unprocessed thoughts:** Recent thoughts (last 48 hours) of type `action_item` or `question` that don't have a linked action yet. Each one gets a "Create action" button that pre-fills `create_action` with the thought content and links via `thought_id`.
   - **Stale loops:** Actions open > 14 days with no recent related captures (same logic as Feature 3.2 MCP tool).

2. **Upcoming view** (calendar): A unified date-based view. One place to see everything with a date across all tables.

   | Source | Table | Date field | Display |
   |--------|-------|------------|---------|
   | Actions | `actions` | `due_date` | Colored by status: blue=open, amber=in_progress, green=done |
   | Family activities | `activities` | `date` or `day_of_week` for recurring | Purple |
   | Important dates | `important_dates` | `date` | Red |
   | Maintenance tasks | `maintenance_tasks` | `next_due` | Coral |

   Layout: Monthly grid with item counts per day. Click a day to expand a detail panel. Week view toggle for denser look-ahead. Thoughts are deliberately excluded — this view is about commitments, not captures.

3. **Thoughts view** (secondary): Reverse-chronological thought feed with filters. This exists for review and retrieval, not as a landing page. Key interaction: select a thought → "Convert to action" to promote it into the actions system.

**Shared components:**
- **Quick action bar:** Persistent at top. Text input that captures a thought directly (hits `ingest-thought`). Toggle for "capture as thought" vs "create as action."
- **Filter bar:** Type, topic, person, date range filters. Shared across views.
- **Search bar:** Semantic search via `match_thoughts` RPC. Results show a "Create action from this" affordance.
- **Stats header:** Open actions count, overdue count, thoughts captured this week, stale loops count. Health indicators, not vanity metrics.

**Action-driving interactions:**
- Every thought card has a "→ Action" button that creates a linked action.
- Every action card has status controls: mark in_progress, complete (prompts for completion note), cancel.
- Completing a recurring action shows the auto-spawned next instance immediately.
- Stale loop items have "Snooze 7 days", "Cancel", or "Do now" buttons.

**Data access:**
- Supabase JS client with anon key.
- Direct table queries for actions, maintenance, calendar tables.
- `match_thoughts` RPC for semantic search.
- No RLS needed yet (single user) — add in Phase 2.

**Stack:**
- Next.js 14 App Router
- Tailwind CSS
- `@supabase/supabase-js`
- Deploy to Vercel

**File structure:**
```
dashboards/command-center/
├── README.md
├── metadata.json
├── package.json
├── next.config.js
├── tailwind.config.ts
├── tsconfig.json
├── postcss.config.js
├── src/
│   ├── app/
│   │   ├── layout.tsx
│   │   ├── page.tsx              # Today view (default)
│   │   ├── upcoming/page.tsx     # Calendar / upcoming view
│   │   └── thoughts/page.tsx     # Thought feed (review & retrieval)
│   ├── components/
│   │   ├── TodayView.tsx
│   │   ├── ActionCard.tsx        # Action with status controls
│   │   ├── ThoughtCard.tsx       # Thought with "→ Action" button
│   │   ├── UnprocessedQueue.tsx  # Thoughts needing conversion to actions
│   │   ├── StaleLoops.tsx        # Stale loop surface
│   │   ├── CalendarGrid.tsx      # Monthly upcoming view
│   │   ├── DayDetail.tsx         # Expanded single-day panel
│   │   ├── QuickActionBar.tsx    # Capture thought / create action input
│   │   ├── FilterBar.tsx
│   │   ├── SearchBar.tsx
│   │   └── StatsHeader.tsx
│   └── lib/
│       └── supabase.ts
```

---

### Feature 1.2-legacy: Thought visualization dashboard ✅ COMPLETE

**Status:** Deployed at `dashboards/thought-explorer/`. Timeline, heatmap, topic clusters, and calendar views are all functional.

> This was the original Feature 1.2 + 1.3 from the first roadmap. It remains deployed and usable. The command center (new Feature 1.2) supersedes it as the primary dashboard but doesn't replace it — thought-explorer is the read-only review tool, command center is the action-driving tool.

---

### Feature 1.3-legacy: Calendar view ✅ COMPLETE

**Status:** Deployed as a tab within `dashboards/thought-explorer/`. Monthly grid, week view, day detail panel, multi-table aggregation (thoughts, actions, activities, important dates, maintenance tasks) with colored dot indicators.

> The command center's "Upcoming view" (new Feature 1.2) covers the same calendar concept but excludes thoughts (commitments only). The thought-explorer calendar including thoughts remains useful for review sessions.

---

## Phase 2: Liv's access

### Feature 2.1: Multi-user auth + household_id

**Category:** `primitives/` update + schema migration

**What to build:**

Migrate from single-user to two-user system. One shared household, separate accounts.

**Migration steps:**

1. Add `user_id uuid references auth.users(id)` and `household_id uuid` columns to:
   - `thoughts` (user_id only — thoughts are personal)
   - `actions` (user_id only — actions are personal)
   - `recipes`, `meal_plans`, `shopping_lists` (both — shared by household)
   - `family_members`, `activities`, `important_dates` (household_id only — shared)
   - `maintenance_tasks`, `maintenance_log` (household_id only — shared)
   - `household_items`, `vendors` (household_id only — shared)

2. Create a `households` table:
```sql
create table households (
  id uuid primary key default gen_random_uuid(),
  name text not null default 'Home',
  created_at timestamptz default now()
);

create table household_members (
  household_id uuid references households(id),
  user_id uuid references auth.users(id),
  role text not null default 'member' check (role in ('owner', 'member')),
  primary key (household_id, user_id)
);
```

3. Create Supabase Auth users for Lee (owner) and Liv (member).

4. Backfill: Set `user_id` and `household_id` on all existing rows.

5. Enable RLS on all tables. Policies:
   - Personal tables (thoughts, actions): `auth.uid() = user_id`
   - Shared tables: `household_id in (select household_id from household_members where user_id = auth.uid())`

**Key decision:** Start with shared household data. The clean migration path (add column, backfill, enable RLS) means no data loss and no breaking change to existing MCP tools — they just need to start passing user context.

**MCP server changes:**
- Edge Functions need to accept a JWT or user token instead of (or in addition to) the static `MCP_ACCESS_KEY`.
- The anon key + RLS approach means queries automatically scope to the right user.
- Existing `service_role` calls bypass RLS — gradually migrate these to user-scoped queries.

---

### Feature 2.2: Liv's dashboard

**Category:** `dashboards/household-hub`

**What to build:**

A separate Next.js app (or auth-gated routes in the existing dashboard) scoped to Liv's access level.

**Views Liv gets:**
- Family calendar (read/write activities and important dates)
- Meal plans (read/write recipes and meal plans)
- Shopping list (view + mark items purchased)
- Home maintenance schedule (read upcoming tasks, log completions)
- Household knowledge (read/search items and vendors)

**Views Liv does NOT get:**
- Thoughts (Lee's personal captures)
- Actions (Lee's personal task tracking)
- Thought visualization, heatmap, topic clusters

**Auth flow:**
- Supabase Auth email/password login
- Auth state managed via `@supabase/auth-helpers-nextjs`
- Middleware checks auth and redirects to login if needed
- RLS handles data scoping — no additional filtering in app code

**Stack:** Same as Feature 1.2. Can be a separate Vercel project or routes within the same app gated by user role.

---

### Feature 2.3: Shopping list → Instacart export

**Category:** `recipes/instacart-export`

**What to build:**

Export the `shopping_lists` table into a format that works with Instacart. Two options — build option A first.

**Option A: Clipboard export (build this first)**

MCP tool `export_shopping_list` that:
1. Queries `shopping_lists` for a given week, joins to `recipes` for ingredient details.
2. Aggregates duplicate ingredients (2 recipes both need chicken → one line item with combined quantity).
3. Groups by category (produce, protein, dairy, pantry, etc.).
4. Returns a formatted text block that can be pasted into Instacart's search or any grocery app.

**Option B: Instacart deep links (future)**

Instacart supports URLs like `https://www.instacart.com/store/search_v3/[item]`. Generate a list of links, one per ingredient.

**Output format for Option A:**
```
Shopping List — Week of March 24

PRODUCE
- Broccoli, 4 cups
- Bell peppers, 2 cups
- Onion, 1 large

PROTEIN
- Chicken breast, 2 lbs

PANTRY
- Soy sauce, 6 tbsp
- Olive oil, 4 tbsp
```

---

## Phase 3: Proactive brain

> **Architecture note:** Features 3.1, 3.2, and 3.3 are implemented as **task types within the scheduled task engine** (Feature 1.1d). The specs below describe the task-type-specific logic. Build the task engine first (1.1d Steps 1-2), then implement these as task type handlers. Features 3.2 and 4.2 also have **standalone MCP tool modes** that can be built immediately without the task engine.

### Feature 3.1: Alerting / reminders

**Category:** Task type `alert_digest` within Feature 1.1d

**What to build:**

A task type handler in the task runner that scans for upcoming items and formats a notification digest.

**Scan targets (configured via `gather_config`):**
- `actions` where `status = 'open'` and `due_date` is within N days
- `important_dates` where `date` is within N days
- `maintenance_tasks` where `next_due` is within N days
- `thoughts` where `metadata->>'dates_mentioned'` contains dates within N days

**Task registration:**
```sql
insert into scheduled_tasks (name, trigger_type, cron_expression, task_type, gather_config, delivery_channel, delivery_config)
values (
  'alert-digest',
  'cron',
  '0 7 * * *',
  'alert_digest',
  '{"scan_tables": ["actions", "important_dates", "maintenance_tasks"], "thresholds_days": [1, 3, 7]}',
  'email',
  '{"email": "lee@example.com"}'
);
```

**Handler logic:**
- Query all scan targets for items due within the max threshold.
- Group by urgency tier (due today, due in 3 days, due this week).
- Format as a clean digest with section headers per tier.
- Deliver via the task's configured `delivery_channel`.

**Notification channels (delivery infra shared by all task types):**
- Email via Resend (simplest — free tier, no phone number needed)
- Telegram message via existing bot integration in `ingest-thought`
- Slack webhook (if configured)

**Corresponds to:** 1.1d Step 4.

---

### Feature 3.2: Stale loop detector

**Category:** Dual-mode — MCP tool (on-demand) + task type `stale_loop_scan` within Feature 1.1d (scheduled)

**What to build:**

The stale loop detection logic exists in two places:

1. **MCP tool `detect_stale_loops`** — called on-demand during daily/weekly reviews. Added directly to `open-brain-mcp/index.ts`. Quick win, no task engine dependency.

2. **Task type `stale_loop_scan`** — runs on a schedule (e.g., Monday mornings) via the task engine and delivers results via email/Telegram. Same logic, different trigger and delivery.

**Logic (shared by both modes):**
1. Query `actions` where `status = 'open'` and `created_at < now() - interval 'N days'` (default N=14).
2. For each stale action, search `thoughts` for any captures mentioning the same topics/people since the action was created. If none found → truly stale. If found → the user is thinking about it but hasn't closed the loop.
3. Query `thoughts` where `metadata->>'type' = 'question'` and `created_at < now() - interval 'N days'` with no subsequent thought on the same topic.

**MCP tool (build immediately — no task engine dependency):**

| Tool | Params | Description |
|------|--------|-------------|
| `detect_stale_loops` | `days?` (default 14), `limit?` (default 20) | Returns stale actions and unanswered questions with context on last related activity. |

**Task registration (build after 1.1d Step 5):**
```sql
insert into scheduled_tasks (name, trigger_type, cron_expression, task_type, gather_config, delivery_channel)
values (
  'stale-loop-scan',
  'cron',
  '0 9 * * 1',
  'stale_loop_scan',
  '{"stale_threshold_days": 14, "limit": 20}',
  'email'
);
```

**Output format:**
```
3 stale loops detected (>14 days):

1. [Action, 18 days old] "Schedule call with Integrity Air for HVAC ductwork"
   Last related capture: 12 days ago (mold remediation update)
   → Still active in your thinking but no action taken

2. [Question, 21 days old] "What's the Litmus digital twin answer for Matt?"
   No related captures since original
   → Completely cold — needs attention or cancellation

3. [Action, 16 days old] "Get Fabriq demo scheduled with Ingrid"
   Last related capture: 3 days ago (Fabriq NA planning note)
   → Active topic, but this specific action hasn't moved
```

**Corresponds to:** MCP tool is standalone (build anytime). Scheduled mode is 1.1d Step 5.

---

### Feature 3.3: Morning briefing agent

**Category:** Task type `llm_prompt` within Feature 1.1d

**What to build:**

A registered task that runs the daily prioritization prompt automatically each weekday morning. **Build this AFTER you've validated the manual daily review process.**

**Task registration:**
```sql
insert into scheduled_tasks (name, trigger_type, cron_expression, task_type, prompt_template, gather_config, delivery_channel)
values (
  'morning-briefing',
  'cron',
  '0 7 * * 1-5',
  'llm_prompt',
  'You are a personal productivity assistant... [contents of Daily_Prioritization_Prompt.md]',
  '{"thought_filters": {"types": ["action_item", "question"], "days": 7}, "search_queries": ["deadlines blockers decisions pending urgent"], "include_actions": {"status": "open"}, "include_calendar": true, "calendar_days_ahead": 1}',
  'email'
);
```

**Handler logic (within `llm_prompt` task type):**
1. Execute all queries defined in `gather_config`.
2. Format gathered data as context.
3. Send to LLM (via OpenRouter) with `prompt_template` as system prompt.
4. Deliver the LLM's response via `delivery_channel`.

**Why this is Phase 3, not Phase 1:**
You explicitly chose to keep running the manual daily review first to validate what's worth automating. This task should encode the patterns you discover, not replace the discovery process.

**Corresponds to:** 1.1d Step 3.

**Prerequisites:** 1.1a (UUIDs), 1.1b (recurring actions), 1.1d Steps 1-2 (task engine core), and several weeks of manual daily reviews to calibrate the prompt.

---

## Phase 4: Brain intelligence

### Feature 4.1: Thought graph / connection map

**Category:** Add as a route to `dashboards/command-center`

**What to build:**

Force-directed graph visualization where each node is a thought and edges connect semantically similar thoughts.

**Data pipeline:**
1. Fetch all thoughts with their embeddings.
2. Compute pairwise cosine similarity (can do this in Postgres with pgvector or client-side for <1000 thoughts).
3. Create edges only where similarity > 0.75 (configurable threshold).
4. Color nodes by type. Size nodes by connection count.

**Library:** D3 force layout (`d3-force`).

**Interactions:**
- Hover a node: highlight its connections, dim everything else.
- Click a node: show thought content in a side panel + list connected thoughts.
- Drag to rearrange. Zoom/pan.
- Filter by type/topic/date range — same filter bar as Feature 1.2.

**Route:** `dashboards/command-center/src/app/graph/page.tsx`

**Performance note:** For >500 thoughts, compute similarity server-side and cache the edge list. Add an RPC function:

```sql
create or replace function thought_graph(similarity_threshold float default 0.75)
returns table(source_id uuid, target_id uuid, similarity float) as $$
  select a.id, b.id, 1 - (a.embedding <=> b.embedding) as sim
  from thoughts a, thoughts b
  where a.id < b.id
    and 1 - (a.embedding <=> b.embedding) > similarity_threshold
  order by sim desc
  limit 500;
$$ language sql;
```

---

### Feature 4.2: Weekly trend analysis

**Category:** Dual-mode — MCP tool (on-demand) + task type `trend_analysis` within Feature 1.1d (scheduled)

**What to build:**

Replace LLM guesswork in the weekly review's "pattern detection" section with computed metrics. Like Feature 3.2, this exists in two modes:

1. **MCP tool `weekly_trends`** — called on-demand during weekly reviews. Build immediately.
2. **Task type `trend_analysis`** — runs on a schedule (Sunday mornings) via the task engine. Corresponds to 1.1d Step 8.

**MCP tool:**

| Tool | Params | Description |
|------|--------|-------------|
| `weekly_trends` | `weeks_back?` (default 4) | Compares this week's thought distribution against previous weeks. |

**Metrics computed:**
- **Topic velocity:** Topics that appeared this week but not last week (new), topics with increasing capture frequency (growing), topics present last week but absent this week (dropped).
- **Type distribution shift:** % of thoughts by type this week vs 4-week average. Flags if action_items spiked or questions dropped.
- **People frequency:** Who appeared more/less this week vs trailing average.
- **Sentiment trend:** Average sentiment score this week vs previous weeks.
- **Capture cadence:** Thoughts per day this week vs average. Flags days with zero captures.

**Output format:**
```
Weekly Trends (March 17-23 vs 4-week average)

GROWING: mold-remediation (5 captures, +3 vs avg), Fabriq (3, +2)
NEW THIS WEEK: Cody, consulting-transition
DROPPED: PDCS-2.0 (0 captures, avg was 2), MDM (0, avg 1.5)

TYPE SHIFT: action_items up 40% vs avg, questions down 25%
CAPTURE CADENCE: 4.1/day (avg 3.2) — no zero days this week
PEOPLE: Alexis (6 mentions, +3), Matt V (4, +2), Ingrid (0, was 2)
```

---

### Feature 4.3: Capture source expansion

**Category:** `integrations/`

**What to build (in priority order):**

1. **Quick capture PWA** (`integrations/quick-capture/`)
   - Single-page web app: one text field, one submit button.
   - Hits the `ingest-thought` Edge Function directly.
   - Install as PWA on phone for home-screen access.

2. **Voice memo capture** (`integrations/voice-capture/`)
   - Audio file → Whisper transcription → `capture_thought`.
   - Could be a Telegram voice message handler or standalone endpoint.

3. **Browser extension** (`integrations/browser-capture/`)
   - Highlight text on any page → right-click → "Capture to Open Brain".
   - Chrome extension with a simple popup for adding context before capture.

**Note:** Slack and Discord capture integrations already exist in the repo under `integrations/`.

---

## Build order recommendation

If working through these with Claude Code, this sequence maximizes compounding:

```
1.1  Actions table          ✅ COMPLETE
1.2L Thought explorer       ✅ COMPLETE (legacy — now read-only review tool)
1.3L Calendar view          ✅ COMPLETE (legacy — tab in thought-explorer)
1.1a UUID exposure           ← patch, do first — everything downstream needs it
1.1b Recurring actions       ← schema migration + MCP tool update
1.1c Due dates on recurring  ← design note, included in 1.1b
1.2  Command center          ← today view + upcoming + thoughts (new primary dashboard)
3.2  Stale loop detector     ← MCP tool mode, quick win, no dependencies
4.2  Weekly trends           ← MCP tool mode, quick win, improves weekly review immediately
1.1d Task engine (Steps 1-2) ← schema + runner with manual trigger only
1.1d Step 3: llm_prompt      ← powers morning briefing (3.3) — only after manual review validated
1.1d Step 4: alert_digest    ← powers alerting (3.1)
1.1d Step 5: stale_loop_scan ← scheduled mode of 3.2
1.1d Step 6: deck_builder    ← Andrea deck — BLOCKED on template
1.1d Step 7: event trigger   ← Google Calendar integration
1.1d Step 8: trend_analysis  ← scheduled mode of 4.2
2.1  Multi-user auth         ← required before Liv gets access
2.2  Liv's dashboard         ← requires 2.1
2.3  Instacart export        ← standalone, can do anytime after meal-planning exists
4.1  Thought graph           ← add as route to command center dashboard
4.3  Capture sources         ← modular, do whenever
```

---

## How to use this with Claude Code

Reference a specific feature when starting a session:

```bash
claude "Build Feature 1.1a: UUID exposure. Read docs/ROADMAP.md for the full spec. Follow the guard rails in CLAUDE.md."
```

Or for a multi-step session:

```bash
claude "I'm working through the BigOleBrain roadmap. Next up is Feature 1.2: Command center. Read docs/ROADMAP.md for the spec, clone dashboards/data-browser as the starting skeleton, and build it out."
```

Each feature spec includes enough detail for Claude Code to produce a working implementation without ambiguity. If a spec says "your call" on a decision, it means both options work — pick one and move.
