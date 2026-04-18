# Workflow Status Tracking

> Adds `status` and `status_updated_at` columns to the `thoughts` table for kanban-style workflow management of tasks and ideas.

## What It Does

Extends the `thoughts` table with two columns that track workflow state. This enables the [Workflow board](../../dashboards/open-brain-dashboard-next/#workflow-board) in the Next.js dashboard and the `progress_task` MCP tool for AI-assisted task management.

**Valid statuses:** `new`, `planning`, `active`, `review`, `done`, `archived`

Only `task` and `idea` thought types use the status field. All other types have `status = NULL`.

## Prerequisites

- Working Open Brain setup ([guide](../../docs/01-getting-started.md))
- Access to the Supabase SQL Editor or CLI

## Credential Tracker

```text
WORKFLOW STATUS -- CREDENTIAL TRACKER
--------------------------------------

SUPABASE (from your Open Brain setup)
  Project URL:           ____________
  Secret key:            ____________

--------------------------------------
```

## Steps

![Step 1](https://img.shields.io/badge/Step_1-Run_Migration-1E88E5?style=for-the-badge)

1. Open your **Supabase SQL Editor** (Dashboard > SQL Editor)
2. Paste and run the migration:

<details>
<summary>SQL: Add status columns and backfill existing tasks/ideas</summary>

```sql
-- Add status column (nullable — only task/idea types use it)
ALTER TABLE thoughts ADD COLUMN IF NOT EXISTS status TEXT DEFAULT NULL;

-- Add timestamp for tracking when status last changed
ALTER TABLE thoughts ADD COLUMN IF NOT EXISTS status_updated_at TIMESTAMPTZ DEFAULT now();

-- Index for fast status filtering (partial — only rows with a status)
CREATE INDEX IF NOT EXISTS idx_thoughts_status ON thoughts (status) WHERE status IS NOT NULL;

-- Backfill: set existing task and idea thoughts to 'new' status
UPDATE thoughts
SET status = 'new', status_updated_at = now()
WHERE type IN ('task', 'idea') AND status IS NULL;
```

</details>

Or via the Supabase CLI:

```bash
supabase db push
```

(if you have the migration file in `supabase/migrations/`)

![Step 2](https://img.shields.io/badge/Step_2-Verify-1E88E5?style=for-the-badge)

3. Verify the columns exist:

```sql
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'thoughts' AND column_name IN ('status', 'status_updated_at');
```

4. Verify the backfill worked:

```sql
SELECT status, count(*) FROM thoughts
WHERE type IN ('task', 'idea')
GROUP BY status;
```

## Expected Outcome

After running the migration:

- The `thoughts` table has two new columns: `status` (TEXT, nullable) and `status_updated_at` (TIMESTAMPTZ)
- All existing `task` and `idea` thoughts have `status = 'new'`
- A partial index `idx_thoughts_status` exists for fast status queries
- Other thought types (`observation`, `reference`, etc.) have `status = NULL` and are unaffected

> [!TIP]
> The migration is idempotent — safe to run multiple times. `IF NOT EXISTS` prevents duplicate columns or indexes.

## MCP Integration

Once the schema is applied, update your `open-brain-mcp` Edge Function to include the `progress_task` tool. This allows AI assistants to manage task status conversationally:

| Tool | Parameters | Description |
|------|-----------|-------------|
| `progress_task` | `thought_id` (required), `status`, `importance` | Update workflow status or priority of a task/idea |

Example prompts after setup:
- "Move thought 42 to active"
- "Set the priority on the API redesign to high"
- "Mark the karaoke task as done"

## Troubleshooting

**Issue: "column already exists" error**
Solution: This is expected if you run the migration twice. The `IF NOT EXISTS` clause handles this — the error is informational only.

**Issue: Existing tasks don't appear on the Workflow board**
Solution: Run the backfill query manually: `UPDATE thoughts SET status = 'new' WHERE type IN ('task', 'idea') AND status IS NULL;`

**Issue: Non-task thoughts showing status values**
Solution: The status column should only be set for `task` and `idea` types. Run: `UPDATE thoughts SET status = NULL WHERE type NOT IN ('task', 'idea');`
