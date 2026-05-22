# Thought Audit

> Append-only audit table capturing every `capture` / `update` / `delete` on the thoughts table, plus an `author_session_id` convention for multi-participant attribution.

## What It Does

Adds one new table (`thought_audit`) and a couple of optional query helpers. The goal is to make "who changed what, when" answerable once more than one agent is writing to your Open Brain — Claude Desktop, Codex, ChatGPT via the API, a background importer, or any combination of the above.

The schema is strictly **additive**. No existing columns on the `thoughts` table are altered or dropped. Existing functions (`match_thoughts`, `upsert_thought`) are not replaced. Every statement is idempotent and safe to re-run.

**Key pieces:**

1. **`thought_audit` table.** Append-only. Records an action (`capture` / `update` / `delete`), a source tag, an optional session id, and a compact JSONB diff — for deletes, the prior content is preserved so the event is recoverable from the audit log alone.
2. **Deliberate non-FK.** `thought_audit.thought_id` has no foreign key to `thoughts(id)`. Audit rows must outlive the thoughts they describe.
3. **Grants are INSERT-only.** The audit table is append-only by design. `service_role` gets `SELECT, INSERT` — never `UPDATE` or `DELETE`. Nothing downstream can rewrite history without an explicit migration.
4. **`author_session_id` convention.** A short opaque string your capture tools tuck into `thoughts.metadata.author_session_id`. No schema change needed — it is just a convention on the existing JSONB column. The optional second SQL file adds a helper view and RPC for querying by session.

**Example audit timeline:**

```
t=10:00  capture_thought  source=claude-desktop     session=sess-AAA  id=thought-123
t=10:05  update_thought   source=claude-desktop     session=sess-AAA  id=thought-123 (metadata patch)
t=11:30  update_thought   source=chatgpt-api        session=sess-BBB  id=thought-123 (content rewrite)
t=15:00  delete_thought   source=codex-cli          session=sess-CCC  id=thought-123 (previous_content preserved)
```

A single query against `thought_audit` where `thought_id = 'thought-123'` returns the full provenance.

## Prerequisites

- Working Open Brain setup ([guide](../../docs/01-getting-started.md))

## Credential Tracker

Copy this block into a text editor and fill it in as you go.

```text
THOUGHT AUDIT -- CREDENTIAL TRACKER
--------------------------------------

SUPABASE (from your Open Brain setup)
  Project URL:           ____________
  Service role key:      ____________

--------------------------------------
```

## Steps

1. Open your Supabase dashboard → **SQL Editor → New query**.
2. Paste the full contents of `schema.sql` and click **Run**. This creates the `thought_audit` table, its indexes, RLS, and the INSERT-only grant for `service_role`.
3. *(Optional)* Open a new query, paste the full contents of `author-session-id.sql`, and click **Run**. This creates the `thought_provenance` view and `thoughts_by_session()` RPC used to query by session id.
4. **Wire audit writes into your mutation tools.** This schema is storage only — no trigger, no hidden magic. You (or a mutation integration like `integrations/update-thought-mcp` and `integrations/delete-thought-mcp`) are responsible for inserting a row after each capture / update / delete. See the "How to write audit rows" section below for copy-paste examples.
5. Navigate to **Table Editor** → confirm `thought_audit` appears with columns `id, thought_id, action, source, author_session_id, diff, actor_context, created_at`.
6. Run `insert into thought_audit (thought_id, action, source) values (gen_random_uuid(), 'capture', 'manual-test');` then `select * from thought_audit order by created_at desc limit 1;` to confirm writes land.

## Expected Outcome

- A new `thought_audit` table with three indexes (`thought_id`, `author_session_id`, `created_at desc`).
- `service_role` holds `SELECT, INSERT` on the table — **not** `UPDATE` or `DELETE`. This is deliberate: the audit log is append-only.
- RLS is enabled (service_role bypasses RLS by default, matching the existing project convention).
- *(If you ran `author-session-id.sql`)* A read-only `thought_provenance` view and a `thoughts_by_session(p_session_id text)` RPC.

## How To Write Audit Rows

The audit table is purely storage. Your capture / update / delete tools insert rows. Here are the three patterns — keep them fire-and-forget so a failure in the audit insert never blocks the main operation.

**On capture:**

```ts
await supabase.from("thought_audit").insert({
  thought_id: newThoughtId,
  action: "capture",
  source: input.source ?? "claude-desktop",
  author_session_id: input.author_session_id ?? null,
  diff: { content_length: content.length, type: extractedType },
  actor_context: { origin: "mcp:capture_thought" },
});
```

**On update (see `integrations/update-thought-mcp`):**

```ts
await supabase.from("thought_audit").insert({
  thought_id: id,
  action: "update",
  source: afterMetadata.source ?? beforeMetadata.source ?? null,
  author_session_id: afterMetadata.author_session_id ?? beforeMetadata.author_session_id ?? null,
  diff: {
    content: contentChanged ? { before_length: before.length, after_length: after.length } : null,
    metadata: metadataDiff(beforeMetadata, afterMetadata),
  },
  actor_context: { origin: "mcp:update_thought" },
});
```

**On delete (see `integrations/delete-thought-mcp`):**

```ts
await supabase.from("thought_audit").insert({
  thought_id: id,
  action: "delete",
  source: priorMetadata.source ?? null,
  author_session_id: priorMetadata.author_session_id ?? null,
  diff: {
    previous_content: priorContent,
    previous_metadata: priorMetadata,
  },
  actor_context: { origin: "mcp:delete_thought" },
});
```

All three are **best-effort**. Wrap them in `try { ... } catch { console.warn(...) }` so an audit write failure never surfaces to the caller — the original operation already succeeded by the time you reach the audit insert.

## The `author_session_id` Convention

This is just a string you tuck into `thoughts.metadata.author_session_id` at capture time. Nothing enforces it — if you do not write it, queries that filter on it simply return nothing for that thought.

**Suggested generation pattern:**

```ts
// At session start (agent boot, REPL load, chat thread open):
const author_session_id = `sess-${crypto.randomUUID().slice(0, 8)}`;
```

**Suggested source tags** (adopted by the reference integrations):

| Tag | Meaning |
| --- | ------- |
| `claude-desktop` | Claude Desktop chat, via custom connectors |
| `claude-code-live` | Claude Code CLI, human-in-the-loop |
| `chatgpt-live` | ChatGPT UI, user-driven captures |
| `chatgpt-api` | Automation using the OpenAI API |
| `codex-cli` | Codex CLI sessions |
| `ingest-worker` | Background ingest jobs (email, docs, imports) |

The source column is an open `text` — feel free to add your own. Keep them short and hyphen-separated so queries stay readable.

## Dependencies and Companions

- `integrations/update-thought-mcp` — adds an `update_thought` MCP tool. Its README documents how to extend it to write audit rows.
- `integrations/delete-thought-mcp` — adds a `delete_thought` MCP tool. Its README documents how to extend it to write audit rows with preserved prior content.

Both are standalone — installing this schema without those integrations is perfectly valid (you can write audit rows from your own capture / mutation code instead).

## Troubleshooting

**Issue: `permission denied for table thought_audit` when inserting from an Edge Function**
Solution: Re-run the `GRANT SELECT, INSERT ON TABLE public.thought_audit TO service_role;` statement from `schema.sql`. Supabase does not grant CRUD on new tables to `service_role` by default.

**Issue: Trying to `DELETE FROM thought_audit` fails**
Solution: This is intentional. `service_role` is granted only `SELECT, INSERT`. If you need to prune old rows, write a deliberate migration that temporarily grants `DELETE`, removes the rows with a precise `WHERE`, and revokes again. That way pruning is a reviewed operation, not an accident.

**Issue: `author_session_id` is always NULL in the audit rows**
Solution: The audit table stores whatever the caller inserts. If your capture tools do not set `metadata.author_session_id` (or do not pass it to the audit insert), the column stays NULL. That is fine — legacy traffic is allowed to predate the convention. Start tagging new writes and those sessions will become queryable immediately.
