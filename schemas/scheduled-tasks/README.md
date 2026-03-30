# Scheduled Tasks

General-purpose task engine for "Claude takes action based on a trigger." Supports morning briefings, alert digests, stale loop scans, deck prep, and trend analysis — all following the same shape:

```
Trigger -> Data gathering -> Execution -> Delivery
```

## Tables

### `scheduled_tasks`

Stores task definitions including trigger configuration, gather config, task type, and delivery settings.

| Column | Purpose |
|--------|---------|
| `trigger_type` | `cron`, `due_date`, `event`, or `manual` |
| `task_type` | `llm_prompt`, `alert_digest`, `deck_builder`, `stale_loop_scan`, `trend_analysis` |
| `gather_config` | JSONB defining which brain tables to query |
| `delivery_channel` | `email`, `telegram`, `slack`, `file`, or `mcp_response` |

### `task_run_log`

Execution log for every task run, with timing, status, input/output summaries, and delivery status.

## MCP Tools

Served by the `scheduled-tasks-mcp` Edge Function:

- `create_scheduled_task` — register a new task
- `update_scheduled_task` — modify task config
- `list_scheduled_tasks` — show all tasks with last run status
- `run_task_now` — manually trigger any task
- `task_run_history` — view recent run logs
