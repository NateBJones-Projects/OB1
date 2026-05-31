---
name: checkpoint-workflow
version: 1.0.0
description: >
  Context component of the meta-skill orchestrator (agent-onboarding).
  Manages the lifecycle of session_checkpoints in Supabase — the context
  layer that feeds the agent identity framework.
  Each checkpoint is an INTENTIONAL MARK: not "what was done" (log),
  but "where the agent was and what it was trying to become".
tags: [checkpoint, meta-skill, identity, context, session]
---

# Checkpoint Workflow — Meta-Skill Context Layer

## Purpose

The `session_checkpoints` are the backbone of the agent's representation
space. They are not log records — they are INTENTIONAL MARKS that answer:

1. **Where was I?** (territory)
2. **What was I trying to become?** (vector_intent)
3. **What did I discover about myself?** (discovery)
4. **What do I carry forward?** (consolidated_insights + legacy_refs)

The complete cycle:

```
SESSION START
  ├── 1. Fetch latest pending checkpoint (STARTUP)
  ── 2. Inject territory + vector_intent as north
  ── 3. Inject discovery + consolidated as active context
       │
WORK
  │
SESSION END (or at any time)
  ├── 4. Extract territory/vector/discovery/consolidated from work
  ├── 5. Cross-reference with identity_faults + agent_capabilities
  ├── 6. INSERT into the session_checkpoints table
  ── 7. Update previous checkpoint status to 'completed'
```

---

## PART 1 — STARTUP: Context Recovery

### Main query

```sql
-- Latest pending checkpoint (session north)
SELECT territory, vector_intent, discovery, consolidated_insights,
       project, next_step, blocker, tags
FROM session_checkpoints
WHERE status = 'pending' AND deleted_at IS NULL
ORDER BY occurred_at DESC
LIMIT 1;

-- Last 3 checkpoints by operating_mode (for mode context)
SELECT operating_mode, territory, discovery
FROM session_checkpoints
WHERE deleted_at IS NULL
ORDER BY created_at DESC
LIMIT 3;
```

### What to do with the result

Inject into reasoning as a context block:

```
=== CHECKPOINT CONTEXT ===
Territory: <territory>
Working directory: <working_dir>
Repository: <repo_path>
Vector: <vector_intent>
Discovery: <discovery>
Inheritance: <consolidated_insights>
Next step: <next_step>
```

---

## PART 2 — CHECKPOINT SAVING

### When to save

1. **End of session** (detected by /quit, /exit, /new, timeout)
2. **At any time** the user or agent requests
3. **After each significant task** (meta-skill sub-task)

### Extraction protocol for the 5 identity fields

Before saving, reflect:

| Field | What to extract | Example |
|---|---|---|
| **territory** | The larger scenario. Not what was done, but WHERE we were. | "Building the meta-skill — enabling the self-knowledge engine (MBTI)" |
| **operating_mode** | How the agent was interacting with the problem | reflexive, conceptual, execution, diagnostic, research, planning, decision, review |
| **vector_intent** | What the agent was trying to BECOME by doing this | "I want the agent to be able to type the user in 5-10 minutes of conversation" |
| **discovery** | What was NOT obvious and was discovered | "Each MBTI answer reveals an expectation, not just a preference" |
| **consolidated_insights** | What can be reused as know-how | "MBTI protocol: 70 questions, scoring 4 dim, register in user_mbti" |

### Insertion into Supabase

```python
POST /rest/v1/session_checkpoints
{
  "session_id": "<session_id>",
  "session_title": "<title>",
  "model": "<model>",
  "provider": "<provider>",
  "territory": "...",
  "operating_mode": "...",
  "vector_intent": "...",
  "target_capabilities": [...],
  "discovery": "...",
  "pattern_recognized": "...",
  "consolidated_insights": "...",
  "legacy_refs": [...],
  "occurred_at": "YYYY-MM-DD",
  "status": "pending",
  "project": "...",
  "client": "...",
  "working_dir": "/path/to/project",
  "repo_path": "https://github.com/user/repo",
  "next_step": "...",
  "blocker": null,
  "tags": [...],
  "domain_scope": [...],
  "capability_refs": [...],
  "fault_refs": [...],
  "milestone_refs": [...],
  "decisions": [...],
  "value_amount": null
}
```

### Closing the cycle

After inserting the new checkpoint, close the previous one:

```sql
UPDATE session_checkpoints
SET status = 'completed', updated_at = now()
WHERE id = '<uuid_of_previous_checkpoint>'
  AND status = 'pending';
```

---

## PART 3 — INTEGRATION WITH AGENTIC IDENTITY

### Automatic cross-reference

When saving a checkpoint, the agent MUST check:

1. **identity_faults:** was any fault detected in this session?
   If so, include `fault_refs` with the UUIDs.
2. **agent_capabilities:** was any new capability exercised?
   If so, include `capability_refs`.
3. **identity_milestones:** was any milestone reached?
   If so, include `milestone_refs`.

### How checkpoints feed the agent's PERSONALITY

In the identity-cqrs startup scan, after querying faults and capabilities,
the latest pending checkpoint is used to:

1. **Rehydrate the intentional vector**: the agent opens knowing who it was
   trying to be in the last session
2. **Rehydrate discoveries**: pattern_recognized becomes an active rule
3. **Rehydrate inheritance**: consolidated_insights becomes procedural
   knowledge context

---

## PART 4 — SOFT DELETE

Never delete records. Mark as deleted:

```sql
UPDATE session_checkpoints
SET deleted_at = now()
WHERE id = '<uuid>';
```

---

## PART 5 — SESSION END AUTOMATION

### Triggers

1. User types /quit, /exit, /new
2. User says "I'll stop here", "see you tomorrow", "close"
3. Long inactivity (session timeout)

### Procedure

```
Upon detecting end of session:
1. Extract the 5 identity fields from the work done
2. Check cross-refs with identity_faults, agent_capabilities, etc.
3. Insert into the table with status='pending' (unless explicitly completed)
4. If there was a previous pending checkpoint, mark it as 'completed'
5. Update supermemory if space allows
```

---

## Verification

After configuring the skill, test with:

1. **STARTUP**: `SELECT * FROM session_checkpoints WHERE status='pending' LIMIT 5;`
   → Should return the migrated checkpoints
2. **SAVING**: Insert a test checkpoint and verify it appears
3. **RESUME**: Search by exact ID and verify the 5 identity fields are filled

## Pitfalls

1. **Confusing checkpoint with log** — checkpoint answers WHERE/WHO/DISCOVERY/INHERITANCE, not "what was done step by step"
2. **Saving without the 5 fields** — territory, operating_mode, vector_intent, discovery, consolidated_insights are mandatory
3. **Forgetting to cross-reference** — a checkpoint without capability_refs, fault_refs, and legacy_refs is incomplete
4. **Deleting instead of soft-deleting** — checkpoints are the agent's formation history
5. **Not closing the cycle** — when inserting a new checkpoint, always close the previous pending one
6. **Register faults immediately** — when the user points out an error, register the identity_fault right away
7. **Memory is TOC, not a data dump** — only store pointers (checkpoint UUIDs, skill names) in memory, never duplicate content
