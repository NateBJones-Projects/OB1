# Thought Lifecycle Receipts

> An append-only receipt log plus a single transactional write path for lifecycle and correction actions on Open Brain thoughts. Every mutation and its receipt commit — or roll back — together, so an unreceipted mutation cannot exist.

## What It Does

This schema adds `public.thought_lifecycle_events` (an append-only audit log) and a write-path function, `public.receipted_thought_write`, that patches a thought and records its receipt in **one transaction**. If any part fails, the whole action rolls back: you never end up with a changed thought and no receipt, or a receipt for a change that didn't land.

It is additive and stays out of the way of core Open Brain:

- It does **not** alter or replace the `thoughts` table (it only reads it and writes to `thoughts.metadata`/`thoughts.status`, which is ordinary usage).
- It does **not** add a task manager, and it adds **no delete behavior**.
- Core Open Brain tools (search, recall, dashboards) keep working unchanged and never need to read anything this pack writes.

Typical adopters are agents or services that take *consequential* actions on thoughts (marking something done, deferring it, flagging it for review, correcting its content) and need a tamper-evident trail of who did what, when, and to what.

## Prerequisites

- A working Open Brain setup with the base `thoughts` table.
- The [`workflow-status`](../workflow-status/migration.sql) schema applied, so `thoughts.status` and `thoughts.status_updated_at` exist. The write path projects each action onto a `thoughts.status` value.
- `pgvector` installed (it ships with core Open Brain). The `correct_thought` action rewrites `thoughts.embedding`; the function passes the embedding as a literal that the column's own input function parses, so it never names the vector type's schema.
- Supabase's `service_role` (the default service key). The table's row-level security and the function's `EXECUTE` grant are restricted to `service_role`; a normal edge function or MCP server using the service key can call it.

## Installation

> [!NOTE]
> This is plain SQL. Run it in the Supabase SQL Editor (or any `psql` session against your project). It is safe to run more than once — every statement is idempotent (`IF NOT EXISTS` / `CREATE OR REPLACE`).

**1. Apply the prerequisite** (skip if you already have it):

```sql
-- schemas/workflow-status/migration.sql
```

**2. Open the Supabase SQL Editor** → your project → **SQL Editor** → **New query**.

**3. Paste and run [`schema.sql`](schema.sql).** This creates the `thought_lifecycle_events` table, its indexes, row-level security, and the two functions (`thought_state_summary` and `receipted_thought_write`).

**4. (Optional, recommended once your writer is ready) run [`actor-hardening.sql`](actor-hardening.sql).** It adds a `CHECK` constraint requiring every *new* receipt to carry a real `party:context` actor (e.g. `user:chat`, `agent:review`, `system:scheduler`). Apply it only **after** the code that writes receipts is emitting real actors — see Troubleshooting.

✅ **Done when:** `select proname from pg_proc where proname in ('receipted_thought_write','thought_state_summary');` returns both rows, and `select to_regclass('public.thought_lifecycle_events');` is not null.

## How It Works

### Supported actions

The write path accepts these actions:

```text
mark_done        mark_still_open   defer          needs_review
archive          suppress_noise    mark_superseded correct_thought
```

Seven are lifecycle transitions; `correct_thought` is a content correction (see below).

### Action → status projection

The single place where a lifecycle action becomes an upstream `thoughts.status` is the `CASE` inside `receipted_thought_write`. Keeping it in the database (rather than in a caller) means there is exactly one copy of this mapping and nothing to drift against it. Upstream consumers (kanban dashboards, status filters) only ever see legal Open Brain statuses:

| Action | Upstream `status` | `lifecycle_state` (in metadata) | Suppressed from an operating loop? |
| --- | --- | --- | --- |
| `mark_done` | `done` | `done` | yes |
| `mark_still_open` | `active` | `open` | no |
| `defer` | `planning` | `deferred` | no |
| `needs_review` | `review` | `needs_review` | no |
| `archive` | `archived` | `archived` | yes |
| `suppress_noise` | `archived` | `noise` | yes |
| `mark_superseded` | `archived` | `superseded` | yes |
| `correct_thought` | unchanged | unchanged | unchanged |

`correct_thought` rewrites `content`, regenerates the embedding, records the correction metadata, and logs a receipt — but it is *not* a lifecycle transition, so `status` and `lifecycle_state` are left untouched.

### The receipted write path

`receipted_thought_write` is `SECURITY INVOKER` — it adds no authority the caller doesn't already have — and does the following in one transaction, under a row lock on the target thought:

1. Reads the current state into a compact `before_state` snapshot (via the pure helper `thought_state_summary`).
2. Applies the patch (status, lifecycle metadata, or a content correction).
3. Writes the receipt row into `thought_lifecycle_events`, including the `after_state` snapshot.

Because the read, patch, and receipt share one transaction and one row lock, a crash cannot leave a mutated thought without its receipt, and two concurrent writers cannot lose each other's metadata updates.

### Metadata keys written to `thoughts.metadata`

The write path stamps a small, well-defined set of keys on `thoughts.metadata` (the substrate's own envelope). This is the reference for what a receipted action records:

<details>
<summary>📋 <strong>Metadata keys</strong> (click to expand)</summary>

| Key | Written by | Meaning |
| --- | --- | --- |
| `lifecycle_state` | every lifecycle action | `done`, `open`, `deferred`, `needs_review`, `archived`, `noise`, or `superseded` |
| `lifecycle_action` | every lifecycle action | the last action applied |
| `lifecycle_updated_at` | every lifecycle action | ISO timestamp of the last lifecycle write |
| `lifecycle_note` | any action, when a note is given | optional human note |
| `lifecycle_reason` | `archive`, `suppress_noise`, `mark_superseded` | why the thought left the loop |
| `suppress_from_operating_loop` | every action (`true` on closing actions) | explicit visibility flag for an operating layer; the thought stays fully recallable as memory |
| `review_after` | `defer` (set); `mark_done`/`mark_still_open` (cleared) | exact `YYYY-MM-DD` the item should resurface |
| `next_action` | `mark_still_open`, `defer` (optional); cleared by `mark_done` | the preserved next step for an open/deferred loop |
| `completed_at` / `reopened_at` / `deferred_at` / `needs_review_at` / `archived_at` / `suppressed_at` / `superseded_at` | the matching action | action timestamp, for evidence |
| `superseded_by` | `mark_superseded` (optional) | UUID of the replacing thought, written on the replaced one |
| `corrected_at` / `corrected_by` / `correction_count` / `correction_note` | `correct_thought` | correction audit trail; `corrected_by` is a `party:context` actor |
| `correction_metadata_strategy` | `correct_thought` | always `preserved_existing_metadata` — corrections never re-run extraction or overwrite prior classification |

</details>

## Standalone by design

This pack works on its own. Its write path has two *optional* touchpoints with other schemas, both guarded so their absence is a graceful no-op, not an error:

- **`provenance-chains` (`supersedes` column).** On `mark_superseded`, the function best-effort writes the canonical `supersedes` pointer. If that schema isn't installed, the pointer is skipped, a warning rides the result, and the metadata receipt remains the record.
- **A brief/approval outcome table (`brief_item_outcome_events`).** When a receipt is written on behalf of an approved brief item, the function tries to record an outcome event. If that table doesn't exist, it catches the error, returns a warning telling you which schema to apply, and still commits the receipt.

The `thought_lifecycle_events` table carries nullable `brief_id`, `run_id`, and `brief_hash` columns so that receipts produced by an approval flow can later be tied back to the brief that authorized them. A partial `UNIQUE` index on `(brief_id, thought_id) WHERE brief_id IS NOT NULL` makes "one execution per brief item" a database rule: two racing approvals of the same item cannot both write a receipt. For direct (non-brief) actions those columns are simply `NULL` and the index doesn't apply.

## Expected Outcome

After running `schema.sql`, a `service_role` caller invokes `receipted_thought_write(...)` for each action. You should observe:

- Every action inserts exactly one row in `thought_lifecycle_events`, with truthful `before_state` and `after_state` snapshots.
- The thought's `status` and `metadata` reflect the action, projected consistently by the in-database `CASE`.
- Interrupting a call mid-write leaves **neither** a partial change **nor** an orphaned receipt (atomic rollback).
- Attempting to execute the same brief item twice is refused by the `UNIQUE` index.

The table stays separate from `thoughts`, so Open Brain remains memory infrastructure while this pack adds an auditable operating-state layer on top.

## Troubleshooting

> [!IMPORTANT]
> **`actor-hardening.sql` makes every lifecycle write fail with a check-constraint violation.**
> The constraint requires each new receipt's `actor` to match `party:context` (and forbids the literal `mcp`). If your caller is still sending a placeholder actor, hardening will reject every write. Fix the caller to send a real actor (e.g. `agent:review`) *first*, then apply `actor-hardening.sql`. Existing rows are intentionally left as-is — the constraint is `NOT VALID` by design and binds new rows only, because rewriting an append-only audit log is not an option.

> [!WARNING]
> **`permission denied for function receipted_thought_write` (or for the table).**
> Row-level security and the function grant are restricted to `service_role`. Call it with your Supabase service key, not the anon/authenticated key. On newer Supabase projects, confirm the `GRANT` statements at the bottom of `schema.sql` actually ran — Supabase no longer auto-grants CRUD to `service_role` on new projects.

> [!NOTE]
> **A `defer` in the future "disappears."**
> That is intended: `review_after` set to a future `YYYY-MM-DD` is an explicit hold. The thought is still fully recallable as memory — `review_after` only signals when an operating layer should resurface it.

> [!NOTE]
> **`brief_item_outcome_events does not exist` warning in the result.**
> Harmless when you aren't using brief/approval linkage — the receipt still committed. If you *do* want brief outcome events, apply the companion brief-store schema. Nothing in this pack requires it.
