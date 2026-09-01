# wiki-profile Worker

> Synthesize a sectioned, evidence-backed "User Profile" wiki page from your atomic thoughts, written through the governed `wiki_pages` surface so a regeneration never overwrites prose you have taken ownership of.

## What It Does

`wiki-profile/index.ts` is a Supabase Edge Function that builds one persistent
page (slug `user-profile`) in the `wiki_pages` schema. On each run it upserts the
page, then for each of ten sections it does **targeted retrieval over your
thoughts → one LLM synthesis call → a governed section write**. Every section
becomes a short list of discrete, evidenced facts — not a biography.

The design is Omi-inspired ("memory → profile"): facts, not narrative; a
supersede-only-if-**FALSE**-or-**OUTDATED** conflict rule; and a keep-both rule
so two preferences that are both true never overwrite each other.

**Machine proposes, human decides.** Generated writes go through the
`wiki_write_section` regen guard. A section a human has edited (`origin='manual'`)
or locked is never overwritten — the new draft is parked as a pending draft for
review, and the run reports that section as `pending`. Sections with no
supporting thoughts are reported `skipped` and are never padded with invented
prose.

### Sections (in display order)

| # | `section_key` | Heading | Drawn from |
|---|---------------|---------|------------|
| 1 | `identity-core` | Identity & Core Facts | High-importance `person_note` / `journal` / `decision` + identity-shaped text search |
| 2 | `work-projects` | Work & Projects | `task` / `decision` / `meeting` + project/ownership search |
| 3 | `skills-expertise` | Skills & Expertise | `lesson` thoughts + demonstrated tools/skills search |
| 4 | `interests-hobbies` | Interests & Hobbies | `idea` / `reference` + top topics (`brain_stats_aggregate`) |
| 5 | `habits-lifestyle` | Habits & Lifestyle | `journal`-weighted routines/patterns |
| 6 | `people-relationships` | People & Relationships | `person_note` + relationship search; CRM contact links when `crm-core` is installed |
| 7 | `preferences-opinions` | Preferences & Opinions | Stated preferences (keep-both on coexisting preferences) |
| 8 | `learnings-insights` | Learnings & Insights | `lesson` + high-importance `reference`, external wisdom attributed |
| 9 | `current-focus` | Current Focus | Last ~30 days: active themes, open tasks, open loops (volatile facts live here by design) |
| 10 | `communication-style` | Communication & Thinking Style | Condensed from `journal` / `meeting` / `decision` — a factual description, not a roleplay persona |

### Evidence & review semantics

- **Evidence.** Each section write records `evidence_thought_ids` — the exact
  thought UUIDs handed to the LLM for that section (its retrieval set). The
  worker does **not** attribute evidence per individual fact; the citation is at
  the section level. `generation_source` records `{model, thought_count,
  queries, generated_at}`.
- **Retrieval & privacy.** Sections are filled by full-text search
  (`search_thoughts_text`) plus direct `type`/`importance`/recency filters and
  `brain_stats_aggregate` top topics — not semantic vector search, which would
  cost an embedding call per query. `restricted`-tier thoughts are **always**
  excluded (column and metadata are both checked in code); `personal`-tier
  thoughts are included unless `PROFILE_EXCLUDE_PERSONAL=true`. Direct queries
  skip machine-generated rows (`metadata.generated_by`); text-search hits are not
  `generated_by`-filtered (the RPC does not return metadata), which is harmless —
  such a row is still evidenced and the synthesis prompt deduplicates.
- **`created` / `updated`** — the section was machine-owned and was written in
  place (a revision is snapshotted only when the body actually changed; an
  identical re-run writes no new revision).
- **`pending`** — the section is human-owned (`origin='manual'` or locked). The
  regen guard parked the new draft in `pending_generated_md` for you to diff and
  accept with `wiki_accept_pending`. This is expected, not an error — the worker
  never retries it.
- **`skipped`** — no supporting thoughts (or the model found no facts, or the
  per-run LLM-call cap was reached). The section is left untouched. Sections are
  never padded to look complete.
- **`error`** — retrieval, synthesis, output validation, or the write failed for
  that section. (A response over 2,400 characters or one that does not start
  with a `-`/`*` bullet marker is rejected before writing — prompt rules alone
  don't survive provider fallback.) The run fails open: existing content is left
  in place, and the other sections still process.

### How this differs from the wiki recipes

`recipes/entity-wiki`, `recipes/wiki-synthesis`, and `recipes/wiki-compiler`
synthesize **regenerable Markdown artifacts** — to disk, to
`entities.metadata.wiki_page`, or back into the thought store as a thought —
treating the wiki as a throwaway compiled view (the Karpathy "LLM wiki"
pattern). This worker instead feeds the **governed `wiki_pages` surface**: one
persistent, revision-tracked page with per-section ownership, evidence provenance
(`evidence_thought_ids`), and a pending-draft human-review guard. Nothing here is
a throwaway file; a human edit is durable and a machine regeneration can only
propose against it.

## Prerequisites

- Working Open Brain setup ([guide](../../../docs/01-getting-started.md)).
- **Enhanced thoughts schema** ([`schemas/enhanced-thoughts`](../../../schemas/enhanced-thoughts/)) — provides the `type`, `importance`, `sensitivity_tier` columns and the `search_thoughts_text` + `brain_stats_aggregate` RPCs this worker retrieves with.
- **Wiki pages schema** ([`schemas/wiki-pages`](../../../schemas/wiki-pages/)) — provides `wiki_upsert_page` and the `wiki_write_section` regen guard the worker writes through.
- **Optional:** [`schemas/crm-core`](../../../schemas/crm-core/) — when present, the People & Relationships section appends `[Name](/contacts/{id})` links for names that match a `crm_contacts` row. The worker feature-detects it and degrades to plain names when it is absent.
- At least one LLM API key: OpenRouter (recommended), OpenAI, or Anthropic.
- Supabase CLI installed for deployment.

For the full tool and worker inventory, see [`docs/05-tool-audit.md`](../../../docs/05-tool-audit.md).

## Steps

### 1. Copy the Worker

Copy this worker folder (and the shared helpers, if you do not already have
them) into your Supabase functions directory:

```bash
cp -r integrations/consolidation-workers/wiki-profile supabase/functions/wiki-profile
cp -r integrations/consolidation-workers/_shared supabase/functions/_shared
```

If you already deployed the `bio` or `metadata-norm` workers, the `_shared/`
folder is identical — no need to overwrite.

### 2. Deploy the Edge Function

```bash
supabase functions deploy wiki-profile --no-verify-jwt
```

### 3. Set Environment Variables

```bash
supabase secrets set \
  MCP_ACCESS_KEY="your-access-key" \
  OPENROUTER_API_KEY="your-openrouter-key"
```

Optional multi-provider fallback (OpenRouter → OpenAI → Anthropic):

```bash
supabase secrets set \
  OPENAI_API_KEY="your-openai-key" \
  ANTHROPIC_API_KEY="your-anthropic-key"
```

Optional tuning:

```bash
supabase secrets set \
  PROFILE_SUBJECT_NAME="Alex Rivera" \
  PROFILE_EXCLUDE_PERSONAL="false" \
  PROFILE_MAX_THOUGHTS_PER_SECTION="40" \
  PROFILE_MAX_LLM_CALLS="10" \
  PROFILE_MAX_INPUT_CHARS="24000" \
  FETCH_TIMEOUT_MS="60000"
```

| Variable | Default | Purpose |
|----------|---------|---------|
| `MCP_ACCESS_KEY` | *(required)* | Fail-closed auth. Sent as `x-brain-key`, `Authorization: Bearer`, or `?key=`. |
| `OPENROUTER_API_KEY` / `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` | *(≥1 required)* | LLM providers, tried in that order. First configured provider is primary. |
| `OPENROUTER_CLASSIFIER_MODEL` | `anthropic/claude-haiku-4-5` | Synthesis model on the OpenRouter path. |
| `PROFILE_SUBJECT_NAME` | *(unset → "the user")* | The user's display name, for third-person synthesis. |
| `PROFILE_EXCLUDE_PERSONAL` | `false` | When `true`, also drop `sensitivity_tier='personal'` thoughts. `restricted` is **always** excluded regardless. When set, top-topic steering is disabled too; interests derive from thought types only (`brain_stats_aggregate` has no personal-tier control, so a personal-only topic string could otherwise steer searches). |
| `PROFILE_MAX_THOUGHTS_PER_SECTION` | `40` | Cap on thoughts fed to a single section's synthesis call. |
| `PROFILE_MAX_LLM_CALLS` | `10` | Cap on LLM completions per run (10 = one per section). Set an explicit `0` to disable. |
| `PROFILE_MAX_INPUT_CHARS` | `24000` | Max characters of thought content packed into one prompt. |
| `FETCH_TIMEOUT_MS` | `60000` | Per-provider LLM fetch timeout. On timeout the fallback chain advances. |

The three `PROFILE_MAX_*` caps are clamped to sane ranges. Blank, negative, or
non-numeric values fall back to the documented defaults — a blank
`PROFILE_MAX_LLM_CALLS` never disables the cap; only an explicit `0` does.
`GET /health` reports the effective post-clamp values.

### 4. Probe Health (no auth, no writes)

```bash
curl "https://<project-ref>.supabase.co/functions/v1/wiki-profile/health"
```

Confirms the function is live and reports which providers are configured and the
active cost caps before you trigger a paid run.

### 5. Preview a Run (dry run — synthesizes every section, writes nothing)

```bash
curl -X POST "https://<project-ref>.supabase.co/functions/v1/wiki-profile?dry_run=true" \
  -H "x-brain-key: your-access-key"
```

Each section comes back with `action: "preview"`, the `evidence_thought_ids`, and
the synthesized bullet list, so you can inspect the facts before persisting them.

### 6. Run It (writes through the regen guard)

```bash
curl -X POST "https://<project-ref>.supabase.co/functions/v1/wiki-profile" \
  -H "x-brain-key: your-access-key"
```

You can also trigger a run from the
[Pro dashboard](../../../dashboards/open-brain-dashboard-pro/): the
`/wiki/user-profile` page header has a **Regenerate profile** button, and the
wiki list shows a **Create your profile** card until the page exists. Both POST
through the dashboard's `/api/wiki/profile/regenerate` route, which forwards
the session's brain key to this worker and renders the per-section outcomes
(pending sections surface in the dashboard's draft-review panel).

### 7. (Optional) Schedule Regeneration

This worker does not schedule itself. To keep the profile fresh, invoke the
`POST /` endpoint on a cadence with any job runner — a Supabase scheduled
function, `pg_cron` (via `net.http_post`), a Claude Code scheduled task, or an
external cron. A daily or weekly run is plenty; the profile is durable state, not
a live feed. Because writes go through the regen guard, a scheduled run can never
overwrite a section you have edited — it only ever proposes a pending draft.

> [!NOTE]
> There is no run-lock. Concurrent runs are database-safe — the
> `wiki_write_section` guard serializes section writes — but each overlapping
> run pays its own LLM budget (up to `PROFILE_MAX_LLM_CALLS` completions).
> Pick a schedule interval comfortably longer than a run's duration so runs
> don't overlap.

## Expected Outcome

After a run:

- A `user-profile` page exists in `wiki_pages` with up to ten sections in
  `wiki_sections`, each holding a short list of discrete, evidenced facts.
- The JSON response reports per-section outcomes and run totals, e.g.:

```json
{
  "dry_run": false,
  "page": { "slug": "user-profile", "id": "…", "created": true },
  "subject": "Alex Rivera",
  "model": "anthropic/claude-haiku-4-5",
  "llm_calls": 9,
  "totals": { "created": 8, "updated": 0, "pending": 0, "skipped": 2, "error": 0 },
  "sections": [
    { "section_key": "identity-core", "action": "created", "thought_count": 22, "evidence_thought_ids": ["…"] },
    { "section_key": "habits-lifestyle", "action": "skipped", "reason": "no_supporting_thoughts", "thought_count": 0 }
  ]
}
```

- Inspect the page:

```sql
SELECT s.display_order, s.section_key, s.heading, s.origin,
       array_length(s.evidence_thought_ids, 1) AS evidence_count,
       left(s.body_md, 200) AS body_preview
FROM wiki_sections s
JOIN wiki_pages p ON p.id = s.page_id
WHERE p.slug = 'user-profile'
ORDER BY s.display_order;
```

- On the **next** run, unchanged sections write no new revision; changed
  machine-owned sections update in place and snapshot a revision; any section you
  have edited comes back as `pending` with the new draft parked in
  `pending_generated_md`.

## Troubleshooting

**Issue: `"Failed to upsert wiki page"` with a hint about `schemas/wiki-pages`.**
Solution: The wiki schema is not installed. Apply
[`schemas/wiki-pages/schema.sql`](../../../schemas/wiki-pages/schema.sql) — it
creates `wiki_upsert_page`, `wiki_write_section`, and the tables they write to.

**Issue: Every section comes back `skipped` with `no_supporting_thoughts`.**
Solution: The worker retrieves by `type`, `importance`, and full-text search. If
your thoughts have no `type` column set (or everything is `restricted`), there is
nothing to synthesize. Confirm the enhanced-thoughts schema is applied and your
thoughts carry `type` values; run the enrichment recipe first if needed.

**Issue: A section I edited keeps coming back as `pending`.**
Solution: That is the regen guard working as designed. A section you edited is
human-owned; the worker parks its new draft instead of overwriting your prose. To
adopt the machine draft, call `wiki_accept_pending(section_id)`. To hand the
section back to the machine, set its `origin` back to `'generated'`.

**Issue: `"No LLM API keys configured"` (503).**
Solution: Set at least one of `OPENROUTER_API_KEY`, `OPENAI_API_KEY`, or
`ANTHROPIC_API_KEY`. The worker tries OpenRouter first, then OpenAI, then
Anthropic; the first key you set becomes the primary provider.

**Issue: People & Relationships shows plain names, no contact links.**
Solution: Contact links require [`schemas/crm-core`](../../../schemas/crm-core/)
(a readable `crm_contacts` table). Without it the worker degrades to plain names
by design. Names are also only linked when they match a
`crm_contacts.display_name` row, and names containing markdown syntax characters
(`[`, `]`, `(`, `)`) are intentionally left unlinked to avoid emitting broken
links.
