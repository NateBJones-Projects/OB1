---
name: supabase-startup-protocol
version: 2.3.0
description: >
  Mandatory session open AND close protocol. Scan Supabase on startup,
  checkpoint to Supabase after each task, and consolidate at session end.
  No work action may occur before the scan.
  v2.3.0: PGRST301 pitfall permanently resolved — explicit instructions
  for using service_role_key with redact_secrets enabled.
tags: [supabase, startup, shutdown, protocol, session-init, checkpoint]
---

# Supabase Startup + Shutdown Protocol

## Full Cycle

```
STARTUP: scan Supabase → report state → identify pending items
    ↓
WORK:   execute tasks
    ↓
CHECKPOINT (per task): record to session_checkpoints → close previous checkpoint → update supermemory
    ↓
SHUTDOWN (end of session): consolidate everything → update TOC
```

---

# PART 1 — STARTUP (session opening)

## RULE #1 — BEFORE ANY CURL: Get the service_role_key

If your system has `redact_secrets: true`, grep/cat/read_file
on `secrets.env` will SHOW A REDACTED VERSION with `***`,
**not the real value**.

### The mistake

You will grep for `SUPABASE_SERVICE_ROLE_KEY` in secrets.env, see
`sb_secret_***`, and write it literally in your curl — causing a PGRST301
error (JWT with 1 part instead of 3).

### The fix (lasts forever)

```bash
# ALWAYS source the file first
source ~/.hermes/secrets.env

# Use the CORRECT variable name — the shell expands the real value
curl -s "$SUPABASE_URL/rest/v1/session_checkpoints?select=count" \
  -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" \
  -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
  -H "Prefer: count=exact"
```

## When to run

**Always** at the start of every session. First action. Non-negotiable.

## Step 1 — General state scan (parallel)

Call ALL of these MCP tools in parallel on the first turn.
The tool calls MUST be the first content in the response. Do not write text before the calls.

```python
mcp_tech_kb_get_kb_summary()
mcp_code_analyzer_get_code_analyzer_summary()
mcp_product_catalog_list_products()
mcp_escape_catalog_get_catalog_summary()
```

## Step 2 — Fetch pending checkpoints

```bash
curl -s "$SUPABASE_URL/rest/v1/session_checkpoints?select=id,project,territory,vector_intent,next_step,status,operating_mode&status=eq.pending&deleted_at=is.null&order=occurred_at.desc&limit=10" \
  -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" \
  -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY"
```

## Step 3 — Report to the user

```
=== SUPABASE STARTUP ===
📚 tech_kb:     <N> entries (latest: <name>)
🔧 code-analyzer: <N> projects, <N> snapshots
📦 products:     <N> active
🧩 escape rooms: <N> rooms
📋 pending:      <N> open checkpoints (session_checkpoints)
```

If any call fails: report as ⚠️ and continue.

---

# PART 2 — CHECKPOINT (per completed task)

## When to run

At the end of EACH significant task or sub-task.

## Required checkpoint fields

| Field | Required | Description |
|-------|----------|-------------|
| `territory` | yes | The larger scenario: where the agent was |
| `operating_mode` | yes | How it interacted with the problem |
| `vector_intent` | yes | What it was trying to become |
| `discovery` | yes | What it discovered about itself |
| `consolidated_insights` | yes | What it carries forward |
| `occurred_at` | yes | Checkpoint date |
| `status` | yes | pending / completed / blocked / cancelled |
| `next_step` | yes | Next required action |

## Expected behavior

- **Always** record a checkpoint after completing a task
- **Always** include all 5 identity fields
- **Always** include `next_step`
- **Always** close the previous pending checkpoint
- **Never** record an empty checkpoint

---

# PART 3 — SHUTDOWN (end of session)

## When to run

When detecting the session is ending:
- User types /quit, /exit, /new
- User explicitly says "I'll stop here", "see you tomorrow", "good night"
- After prolonged inactivity (session timeout)

## What to do

1. Save checkpoint with all 5 identity fields
2. Close previous pending checkpoint (UPDATE status='completed')
3. Update supermemory with summary
4. Update knowledge base if there were structural changes

---

# PART 4 — WEEKLY THOUGHTS TRIAGE

Every **Monday** after the STARTUP scan. Consolidate ideas from the input
funnel into permanent destinations and archive.

## Pitfalls

1. **Forgetting to run** — the protocol MUST be the first block of tool calls
2. **Skipping it when the user already gave a specific task** — run the scan first
3. **Assuming you "remember"** — do not trust session memory. Query Supabase.
4. **Checkpoint without `next_step`** — useless. Always fill it in.
5. **Shutdown without consolidating** — at least the last checkpoint was saved.
6. **NEVER grep/read_file on secrets.env** — the value may be redacted.
   ALWAYS `source ~/.hermes/secrets.env` and use the environment variable directly.
