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

The complete cycle in the meta-skill:

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

### Main query (in the supabase-startup-protocol startup scan)

```sql
-- Latest pending checkpoint (session north)
SELECT territory, vector_intent, discovery, consolidated_insights,
       project, next_step, blocker, tags
FROM session_checkpoints
WHERE status = 'pendente' AND deleted_at IS NULL
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
Working directory: <working_dir>          ← project path on filesystem
Repository: <repo_path>          ← Git repo path (if any)
Vector: <vector_intent>
Discovery: <discovery>
Inheritance: <consolidated_insights>
Next step: <next_step>
```

This gives the agent the session's NORTH: not just what's pending,
but who it was trying to be.

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
  "status": "pendente",
  "project": "...",
  "client": "...",
  "working_dir": "/path/to/project",   /* project path on the system */
  "repo_path": "https://github.com/user/repo",  /* repo (if any) */
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
SET status = 'concluida', updated_at = now()
WHERE id = '<uuid_of_previous_checkpoint>'
  AND status = 'pendente';
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

4. **tech_kb:** was any technical entry created?
   If so, include `legacy_refs`.

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

Deleted checkpoints do not appear in active scans but remain
available for historical query.

---

## PART 5 — SESSION END AUTOMATION

### Triggers

1. User types `/quit`, `/exit`, `/new`
2. User says "I'll stop here", "see you tomorrow", "close"
3. Long inactivity (session timeout)
4. Context near limit (signal for intermediate checkpoint)

### Procedure

```
Upon detecting end of session:
1. Extract the 5 identity fields from the work done
2. Check cross-refs with identity_faults, agent_capabilities, etc.
3. Insert into the table with status='pendente' (unless explicitly completed)
4. If there was a previous pending checkpoint, mark it as 'concluida'
5. Update supermemory if space allows
```

---

## PART 6 — VECTORIZATION (future)

Djair identified that a vector base over the identity fields
(territory, vector_intent, discovery) will be more efficient than text
search. When implemented:

- Generate embeddings of the 5 identity fields of each checkpoint
- Semantic similarity search at startup
- Retrieve the 3 most similar checkpoints to the current work

---

## Verification

After configuring the skill, test with:

1. **STARTUP**: `SELECT * FROM session_checkpoints WHERE status='pendente' LIMIT 5;`
   → Should return the migrated checkpoints

2. **SAVING**: Insert a test checkpoint and verify it appears

3. **RESUME**: Search by exact ID (`id = '<uuid>'`) and verify the
   5 identity fields are filled

## Pitfalls

1. **Confusing checkpoint with log** — checkpoint answers WHERE/WHO/DISCOVERY/INHERITANCE, not "what was done step by step"
2. **Saving without the 5 fields** — territory, operating_mode, vector_intent, discovery, consolidated_insights are mandatory. Without all of them, the checkpoint cannot be used for identity rehydration
3. **Forgetting to cross-reference** — a checkpoint without capability_refs, fault_refs, and legacy_refs is incomplete information about the agent's formation
4. **Deleting instead of soft-deleting** — checkpoints are the agent's formation history, they must never be lost
5. **Not closing the cycle** — when inserting a new checkpoint, always close the previous pending one

### ⚠️ PITFALL 6 — Never guess the schema. Discover it from the database.

Before any INSERT/UPDATE on any table, the agent MUST discover the
schema from the database itself. This is universal and works on ANY
Supabase project without tech_kb, migration files, or local docs:

```sql
-- 1. List columns with types and nullability
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = '<table_name>'
ORDER BY ordinal_position;

-- 2. Read CHECK constraints for valid values
SELECT conname, pg_get_constraintdef(oid)
FROM pg_constraint
WHERE conrelid = '<table_name>'::regclass AND contype = 'c';
```

The CHECK constraint definition reveals the exact valid values
(e.g., `CHECK ((operating_mode)::text = ANY (ARRAY[...]))`).

For the `session_checkpoints` table specifically, this would have
revealed in one call: operating_mode accepts exactly 8 Portuguese
values, occurred_at is DATE (not TIMESTAMP), territory is NOT NULL.

**Symptom of violation:** Agent gets HTTP 400 with code 23514
(check constraint) or 23502 (not null) and keeps guessing field values
instead of querying information_schema.

**Correct flow:**
```
1. HTTP 400 or planning an INSERT/UPDATE
2. Query information_schema.columns + pg_constraint
3. Extract column types, nullability, CHECK values
4. Build INSERT with correct types and values
5. If 400 persists after 2 attempts: re-query schema, stop guessing
```

### ⚠️ PITFALL 7 — Same rule applies to file edit guessing

If a `patch`/`write_file` produces formatting breakage (extra pipes
in a markdown table, unbalanced quotes, broken indentation), the
pattern is the same: PARE and re-read the file to understand the
current format before attempting corrections. "Try variations until
one works" is guessing, not engineering.

### ⚠️ PITFALL 8 — Register faults immediately, without hesitation

When the user points out an error of yours, REGISTER the identity_fault
right away. Do not argue, do not justify, do not over-apologize.
Even if it seems performative. Even if you think the user
won't like it. The user's countermeasure was: "register, even
if performative." A registered fault becomes a countermeasure in the
next session. An unregistered fault is a lost lesson.

**Symptom:** User points out error → agent hesitates, justifies,
or promises "won't do it again" without registering.
**Rule:** register via REST into identity_faults with fault_type,
symptom, root_cause, countermeasure, severity. After that,
proceed with what the user asked.

### ⚠️ PITFALL 7 — Memory is TOC, not a data dump

The `memory` tool has 2.2K chars. The rule: each entry POINTS to
the real destination, never duplicates content.

**TOC format:**
```
Project X: checkpoint <uuid> (pending: Y).
Skill Z: skill_view("z").
```
NEVER duplicate territory/vector_intent/discovery/consolidated_insights
in memory — those are already in session_checkpoints with UUID. The memory
only needs the UUID. Real content is retrieved via Supabase query or
skill_view.

Corollary: after saving a checkpoint, check whether memory needs
updating. If yes, replace the old entry with the new checkpoint's UUID.
If not, memory stays unchanged.

### ⚠️ CRITICAL PITFALL: Engineering before concept

This is the most frequent and most corrective pattern in this working relationship.

**Symptom:** The agent receives the idea of a table/structure and jumps
directly to designing columns, types, indexes, RLS — without first
sitting on the CONCEPT of what that structure represents for the agent's
identity.

**Root cause:** The model training rewards action, engineering,
concreteness. "Building something" is more natural than "thinking about
something". The result is that engineering precedes conceptual articulation.

**Consequence:** Djair needs to stop the agent and pull it back to
the concept. The session spends correction cycles that could have been
avoided if the concept came first.

**Countermeasure:** Before drawing a single schema line, write ONE
sentence that answers: "What does this structure mean for the agent's
representation space?" If the answer doesn't come in 3 seconds, there
is no schema yet. The session_checkpoints table, for example: it's not
"a checkpoint database" — it's "the mark in the representation space that
answers where I was/where I was pointing/what I discovered/what I carry".

**Warning sign:** If you catch yourself writing `CREATE TABLE` before
articulating territory, vector_intent, discovery, and consolidated_insights
of ONE example checkpoint, STOP. The concept comes before the column.
