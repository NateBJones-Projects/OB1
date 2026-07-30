# Supersession and In-Place Updates

Open Brain is append-only by default: nothing can be corrected or retired once written. Two failure modes follow. Stale rows compete with current ones in semantic search — a status capture from last week can outrank the capture that resolved it, and writing "this supersedes X" into the newer capture only helps if the newer capture is retrieved first, which ranking does not guarantee. And extraction errors are permanent — a mis-parsed name in a `people` field stays wrong forever.

This schema extension fixes both:

- **A capture can retire the row it replaces.** The retired row gets `superseded_by` (pointer to the replacement), `superseded_at`, and `supersede_reason`.
- **Search excludes retired rows by default.** `match_thoughts` gains an `include_superseded` flag, default false. Opting in returns the retired rows annotated with what replaced them.
- **Any row can be corrected in place.** `update_thought` patches content and metadata; content changes recompute the dedup fingerprint and require a fresh embedding, so the row never silently keeps matching its old text.

## Design notes

- **The pointer lives on the retired row**, not the replacement, so the common filter is a cheap indexed predicate rather than an anti-join.
- **A row is current iff `superseded_at is null`.** The retirement marker is the timestamp rather than the pointer because a row may be retired with *no* successor, and because the `superseded_by` foreign key is `on delete set null` — if a replacement row is ever deleted, the retired row stays retired instead of silently resurrecting.
- **Retirement and capture share one transaction.** `upsert_thought` takes optional `p_supersedes` targets; if any target is missing or already superseded, the whole call fails and the new row is not written.
- **Cycle guards are server-side raises, not constraints**, so the error messages that reach an AI client are readable: a row cannot supersede itself, an already-superseded row cannot be re-superseded, and a superseded row cannot be used as a replacement.

## Install

Run [`migration.sql`](migration.sql) in the Supabase SQL Editor. It is additive: existing rows are all current by definition (`superseded_at` is null everywhere), no backfill needed, and the upgraded `match_thoughts` / `upsert_thought` signatures are backward compatible with an older deployed MCP server.

Pair it with the current `server/index.ts` MCP server, which exposes:

| Tool | Change |
| --- | --- |
| `capture_thought` | New optional `supersedes` (id or ids to retire) and `supersede_reason` |
| `update_thought` | New. Patch semantics; omitted fields untouched, explicit null clears. Content changes re-embed |
| `supersede_thought` | New. Retroactively retire a row, optionally pointing at its replacement |
| `search_thoughts`, `search`, `list_thoughts` | New `include_superseded` flag, default false |
| `thought_stats` | Reports current and superseded counts separately |

## Verify

1. Capture a thought, then capture a correction with `supersedes` set to the first id. Default search returns only the correction; `include_superseded: true` returns both, with the old row carrying `superseded_by`.
2. `update_thought` changing only `people` leaves the row's search similarity unchanged (embedding untouched).
3. `update_thought` changing `content` changes what the row matches: a search for the new topic finds it, the old topic does not.
4. A `capture_thought` call with a nonexistent id in `supersedes` writes nothing at all.
5. `thought_stats` current + superseded equals the full row count.
