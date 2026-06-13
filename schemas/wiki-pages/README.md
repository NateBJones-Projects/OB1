# Persistent Wiki Pages

> Wiki pages that survive regeneration. A machine can keep a page fresh without ever overwriting the parts a human has taken ownership of.

## The regen guard (why this exists)

Most wiki generators treat a page as a throwaway file: regenerate it and any human edit is shredded on the next run. This schema removes that footgun.

Pages here are persistent database objects split into sections, and each section has an owner:

- A **machine-owned** section (`origin = 'generated'`) can be regenerated freely — the next generated write overwrites it in place.
- A **human-owned** section (`origin = 'manual'`, or any section that is `locked`) is protected. A generated write to it does **not** overwrite the live text. It parks the new draft in a pending buffer, where a human can review it and either accept it or leave it.

Accepting a pending draft is a deliberate human action (`wiki_accept_pending`). The section stays human-owned afterward, so the machine keeps proposing but never auto-applies.

This is the same trust model as the rest of Open Brain's human-in-the-loop surfaces: **machine writes propose, a human accepts.** The rule lives in exactly one place — the `wiki_write_section` RPC — so every writer, current and future, goes through the same guard instead of each generator script re-implementing it (and getting it subtly wrong).

### How is this different from the wiki-compiler / wiki-synthesis recipes?

Those recipes (`recipes/wiki-compiler`, `recipes/wiki-synthesis`) **compile a throwaway artifact**: they read your thoughts and emit a fresh markdown document each run. There is no stored page, no section ownership, no revision history, and no protection for a human edit — by design, because the output is meant to be regenerated wholesale.

This schema is the **durable, override-safe storage layer** those compilers were missing:

| | wiki-compiler / wiki-synthesis | persistent wiki pages (this schema) |
|---|---|---|
| Output | A regenerated markdown artifact | A persistent page in the database |
| Human edits | Overwritten on the next run | Protected — machine writes park as pending |
| History | None | Append-only per-section revisions |
| Ownership | N/A | Per-section (`generated` vs `manual`/`locked`) |

They are complementary. A compiler recipe can use this schema as its write target by calling `wiki_write_section` instead of overwriting a file — and immediately gain the human-override guard and revision history for free.

## What it installs

- **`public.wiki_pages`** — one row per page, keyed by a unique `slug`. Holds the title, a `page_kind`, a `status`, and a free-form `metadata` jsonb.
- **`public.wiki_sections`** — chapters within a page. Carries the `origin` ownership marker, the live `body_md`, the `pending_generated_md` parking buffer, a `locked` flag, and `evidence_thought_ids` (a `UUID[]` citing the thoughts that support the section).
- **`public.wiki_section_revisions`** — append-only history; one row per body change, so nothing a human or machine wrote is ever lost.
- **`wiki_upsert_page(slug, title, page_kind, metadata, actor)`** — create or update a page by slug. Returns `{page_id, created}`.
- **`wiki_write_section(page_id, section_key, body_md, origin, ...)`** — **the single write guard.** Returns `{section_id, action}` where `action` is `created`, `pending`, or `updated`.
- **`wiki_accept_pending(section_id, actor)`** — promote a parked draft to the live body and snapshot a revision. Returns `{section_id, action}` (`accepted` or `no_pending`).

### ID contract

OB1's canonical `public.thoughts.id` is a `UUID`, and every id here is UUID-aligned:

- `wiki_pages.id` and `wiki_sections.id` are `UUID` (`gen_random_uuid()`).
- `wiki_sections.page_id` → `wiki_pages.id` is a `UUID` foreign key.
- `wiki_section_revisions.section_id` → `wiki_sections.id` is a `UUID` foreign key.
- `wiki_sections.evidence_thought_ids` is a `UUID[]` referencing `public.thoughts(id)`.

`wiki_section_revisions.id` is a `BIGINT` identity surrogate — an internal revision sequence, never a thought id. This schema never references `brain_thoughts`, never uses a bigint thought id, and never installs a view trigger.

## Prerequisites

- A working Open Brain setup ([getting-started guide](../../docs/01-getting-started.md)). This schema is additive and standalone — it does not alter `public.thoughts`. The only cross-reference is the optional `evidence_thought_ids` array, which holds `public.thoughts(id)` values when you want to cite supporting thoughts.
- Access to the Supabase SQL Editor (or the Supabase CLI) with the service role.
- The `pgcrypto` extension for `gen_random_uuid()`. The script enables it with `CREATE EXTENSION IF NOT EXISTS pgcrypto`; on Supabase / Postgres 13+ this is already present and the line is a no-op.
- Pages are written by server-side jobs running as the `service_role`. The tables are RLS-on and granted to `service_role` only — they are not exposed to `anon` / `authenticated`.

## Steps

1. Open your **Supabase SQL Editor** (Dashboard → SQL Editor).
2. Paste the full contents of [`schema.sql`](./schema.sql) and run it. The script is idempotent — `CREATE TABLE IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`, `CREATE OR REPLACE FUNCTION`, and a guarded `ON CONFLICT` seed — so re-running it is safe.
3. Confirm the tables and RPCs exist:

   ```sql
   SELECT to_regclass('public.wiki_pages')            AS pages_table,
          to_regclass('public.wiki_sections')         AS sections_table,
          to_regclass('public.wiki_section_revisions') AS revisions_table;

   SELECT proname
   FROM pg_proc
   WHERE proname IN ('wiki_upsert_page', 'wiki_write_section', 'wiki_accept_pending')
   ORDER BY proname;
   ```

4. Confirm the fictional seed page is present (one page, one section):

   ```sql
   SELECT slug, title FROM public.wiki_pages WHERE slug = 'getting-started';
   SELECT section_key, origin FROM public.wiki_sections s
   JOIN public.wiki_pages p ON p.id = s.page_id
   WHERE p.slug = 'getting-started';
   ```

Or, if you keep migrations in `supabase/migrations/`, apply via the CLI:

```bash
supabase db push
```

## Worked example: the regen guard end to end

This walks the three outcomes — a machine write being overwritten, a human edit being protected, and a human accepting the parked draft.

```sql
-- 1. Create a page and a machine-generated section.
SELECT public.wiki_upsert_page('quarterly-summary', 'Quarterly Summary');

-- Capture the page id for the calls below (or read it from wiki_pages.slug).
-- Here we inline a subquery for clarity.
SELECT public.wiki_write_section(
  (SELECT id FROM public.wiki_pages WHERE slug = 'quarterly-summary'),
  'overview',
  'Auto-generated overview, version 1.',
  'generated'
);                                  -- → action: "created"

-- 2. A second generated write to the still-machine-owned section overwrites it.
SELECT public.wiki_write_section(
  (SELECT id FROM public.wiki_pages WHERE slug = 'quarterly-summary'),
  'overview',
  'Auto-generated overview, version 2.',
  'generated'
);                                  -- → action: "updated"  (body is now v2)

-- 3. A human edits the section. A 'manual' write takes ownership of it.
SELECT public.wiki_write_section(
  (SELECT id FROM public.wiki_pages WHERE slug = 'quarterly-summary'),
  'overview',
  'Hand-written overview the team actually wants to keep.',
  'manual',
  'Overview'                        -- also set a heading
);                                  -- → action: "updated"  (origin is now 'manual')

-- 4. The generator runs again. Because the section is human-owned, the machine
--    write does NOT overwrite — it PARKS as a pending draft.
SELECT public.wiki_write_section(
  (SELECT id FROM public.wiki_pages WHERE slug = 'quarterly-summary'),
  'overview',
  'Auto-generated overview, version 3.',
  'generated'
);                                  -- → action: "pending"  (live body unchanged)

-- The human-written body is still live; the machine draft waits in the buffer.
SELECT body_md, pending_generated_md
FROM public.wiki_sections s
JOIN public.wiki_pages p ON p.id = s.page_id
WHERE p.slug = 'quarterly-summary' AND s.section_key = 'overview';
--  body_md             → 'Hand-written overview the team actually wants to keep.'
--  pending_generated_md → 'Auto-generated overview, version 3.'

-- 5. A human reviews and accepts the pending draft.
SELECT public.wiki_accept_pending(
  (SELECT id FROM public.wiki_sections s
   JOIN public.wiki_pages p ON p.id = s.page_id
   WHERE p.slug = 'quarterly-summary' AND s.section_key = 'overview')
);                                  -- → action: "accepted"

-- Now the body is the accepted draft, the buffer is cleared, the section stays
-- human-owned, and every step above is recorded in wiki_section_revisions.
SELECT origin, body_md FROM public.wiki_sections s
JOIN public.wiki_pages p ON p.id = s.page_id
WHERE p.slug = 'quarterly-summary' AND s.section_key = 'overview';
--  origin  → 'manual'
--  body_md → 'Auto-generated overview, version 3.'

-- The full history, newest first.
SELECT origin, actor, created_at
FROM public.wiki_section_revisions r
JOIN public.wiki_sections s ON s.id = r.section_id
JOIN public.wiki_pages p ON p.id = s.page_id
WHERE p.slug = 'quarterly-summary' AND s.section_key = 'overview'
ORDER BY r.created_at DESC;
```

To **release** a section back to automatic generation (give up the human override), set its `origin` back to `'generated'` directly:

```sql
UPDATE public.wiki_sections
SET origin = 'generated'
WHERE id = (SELECT id FROM public.wiki_sections s
            JOIN public.wiki_pages p ON p.id = s.page_id
            WHERE p.slug = 'quarterly-summary' AND s.section_key = 'overview');
```

## Expected outcome

After running the migration:

- Three tables exist — `public.wiki_pages`, `public.wiki_sections`, `public.wiki_section_revisions` — all RLS-enabled and granted to `service_role` only (revoked from `PUBLIC` / `anon` / `authenticated`).
- The id chain is UUID throughout: `wiki_sections.page_id` and `wiki_section_revisions.section_id` are `UUID` foreign keys, and `evidence_thought_ids` is `UUID[]`.
- Three RPCs exist — `wiki_upsert_page`, `wiki_write_section`, `wiki_accept_pending` — each `SECURITY INVOKER` and executable by `service_role` only.
- One fictional seed page (`getting-started`) exists with a single generated section (`intro`). Re-running `schema.sql` does not duplicate it.
- The regen guard behaves as in the worked example: a generated write to a human-owned section returns `action: "pending"` and leaves the live body untouched; `wiki_accept_pending` promotes the parked draft and records a revision.
- No column on `public.thoughts` is altered or dropped.
- PostgREST's schema cache is reloaded (`NOTIFY pgrst, 'reload schema'`).

## Rollback

To remove the persistent-wiki system entirely:

```sql
DROP FUNCTION IF EXISTS public.wiki_accept_pending(UUID, TEXT);
DROP FUNCTION IF EXISTS public.wiki_write_section(UUID, TEXT, TEXT, TEXT, TEXT, JSONB, UUID[], INTEGER, TEXT);
DROP FUNCTION IF EXISTS public.wiki_upsert_page(TEXT, TEXT, TEXT, JSONB, TEXT);
DROP TABLE IF EXISTS public.wiki_section_revisions;
DROP TABLE IF EXISTS public.wiki_sections;
DROP TABLE IF EXISTS public.wiki_pages;

NOTIFY pgrst, 'reload schema';
```

Dropping the tables removes all wiki pages, sections, and their revision history. It does not touch `public.thoughts`.

## Troubleshooting

**A generated regeneration keeps returning `action: "pending"`.**
The section is human-owned (`origin = 'manual'`) or `locked`. That is the guard working as intended — the machine cannot overwrite it. Accept the pending draft with `wiki_accept_pending`, or release the section back to automatic with `UPDATE ... SET origin = 'generated'`.

**`wiki_write_section` raises `invalid section origin`.**
`p_origin` must be exactly `'manual'` or `'generated'`. Any other value is rejected so a typo cannot silently create an un-guardable section.

**`gen_random_uuid()` does not exist.**
The `pgcrypto` extension is not enabled. The script runs `CREATE EXTENSION IF NOT EXISTS pgcrypto`; if your role cannot create extensions, ask a superuser to enable `pgcrypto` once, then re-run.

**PostgREST does not see the new RPCs.**
The migration emits `NOTIFY pgrst, 'reload schema'`. If it does not take effect, reload from Dashboard → Project Settings → API → Reload schema.
