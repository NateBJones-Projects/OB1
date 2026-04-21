# Wiki Synthesis

> Synthesize topic-scoped wiki articles and per-thread email wikis from atomic thoughts, using any OpenAI-compatible LLM.

## What It Does

Takes your captured thoughts in Open Brain and produces two flavors of wiki output:

1. **Topic-scoped articles** via `synthesize-wiki.mjs`. Ships with an `autobiography` synthesizer that groups thoughts by year and asks an LLM to write 2-4 paragraphs of biographical prose per year. You can add your own synthesizers (e.g., "career", "travel", "relationships") by extending the catalogue.
2. **Per-thread email wikis** via `backfill-gmail-wikis.mjs`. Groups Gmail-imported thoughts by `thread_id`, filters to substantive threads (word-count + message/atom thresholds), summarizes each thread, and writes the result back into Open Brain as a new thought (`source_type='gmail_wiki'`) with `derived_from` edges pointing at its source atoms.

Both scripts treat wikis as **emergent, regenerable views** of atomic state — the core `thoughts` table remains the source of truth. Inspired by Andrej Karpathy's LLM Wiki pattern.

## How It Compares to Other OB1 Wiki Recipes

| Recipe | Scope | Schema prerequisites |
| ------ | ----- | -------------------- |
| `recipes/entity-wiki/` (pending) | One page per entity (person/project/topic/org/tool/place) | Requires entity-extraction schema + worker |
| `recipes/wiki-synthesis/` (this recipe) — topic mode | One page per topic slice of the corpus (e.g., autobiography by year) | Core `thoughts` table only |
| `recipes/wiki-synthesis/` (this recipe) — email-thread mode | One page per Gmail thread | Core `thoughts` + `thought_edges`, plus thoughts imported with `metadata.gmail.thread_id` |

Use this recipe when you want corpus-wide synthesis without depending on the entity-extraction pipeline.

## Prerequisites

- Working Open Brain setup ([guide](../../docs/01-getting-started.md))
- Node.js 18+ (uses built-in `fetch`)
- API key for any OpenAI-compatible Chat Completions endpoint (OpenRouter, OpenAI, Anthropic via OpenRouter, a local Ollama/LM Studio server, etc.)
- Your Supabase project URL and service role key

### Additional prerequisites per mode

**Topic mode (autobiography synthesizer):**

- Thoughts in your Open Brain with date metadata. The synthesizer prefers `metadata` keys `event_at`, `life_date`, `source_date`, `captured_at`, `original_date`, or `date`; it falls back to the `created_at` column if none are set. You can narrow the corpus with the `SOURCE_TYPE_FILTER` env var (e.g., to only pull LifeLog-style imports).

**Email-thread mode:**

- Email thoughts imported with `source_type='gmail_export'` and `metadata.gmail.thread_id` + `metadata.gmail.gmail_id` populated. The [`email-history-import`](../email-history-import/) recipe produces this shape.
- A `public.thought_edges` table with columns `(from_thought_id uuid, to_thought_id uuid, relation text, metadata jsonb)` plus a `UNIQUE (from_thought_id, to_thought_id, relation)` index so the `Prefer: resolution=ignore-duplicates` header this script sets on edge inserts works. This schema ships in OB1's Knowledge Graph work (tracked in upstream PR [#5](https://github.com/NateBJones-Projects/OB1/pull/5) and its merged variants). If you haven't applied that migration, `derived_from` edge writes will 404 or 409 and the script will log partial-edge errors per thread; the wiki thought itself still gets inserted.
- Optional: an `upsert_thought(p_content text, p_payload jsonb)` RPC. If present, the email-thread script uses it for content-fingerprint-aware upserts; otherwise it falls back to a plain `POST /thoughts` insert.

## Credential Tracker

```text
WIKI-SYNTHESIS -- CREDENTIAL TRACKER
--------------------------------------

FROM YOUR OPEN BRAIN SETUP
  OPEN_BRAIN_URL:           ____________   (https://<ref>.supabase.co)
  OPEN_BRAIN_SERVICE_KEY:   ____________   (Supabase service role key)

LLM PROVIDER
  LLM_BASE_URL:             ____________   (default: https://openrouter.ai/api/v1)
  LLM_API_KEY:              ____________
  LLM_MODEL:                ____________   (default: anthropic/claude-haiku-4-5)

OPTIONAL — TOPIC MODE
  SUBJECT_NAME:             ____________   (your name, for the autobiography voice)
  SOURCE_TYPE_FILTER:       ____________   (e.g. google_drive_import — narrow the corpus)
  WIKI_OUTPUT_DIR:          ____________   (default: ./output/wiki)

--------------------------------------
```

## Steps

### 1. Copy the scripts into your Open Brain project

From this recipe's folder, copy the two scripts into wherever you keep workflow scripts (for example, a `scripts/` directory at the root of your Open Brain project):

```bash
mkdir -p scripts
cp recipes/wiki-synthesis/scripts/synthesize-wiki.mjs scripts/
cp recipes/wiki-synthesis/scripts/backfill-gmail-wikis.mjs scripts/
```

If you downloaded the recipe standalone, adjust source paths accordingly.

### 2. Create a `.env.local` at your project root

The scripts read from `./.env.local` relative to their current working directory, then fall back to `process.env`. Fill in the tracker values from above:

```text
OPEN_BRAIN_URL=https://YOUR_REF.supabase.co
OPEN_BRAIN_SERVICE_KEY=YOUR_SERVICE_ROLE_KEY
LLM_BASE_URL=https://openrouter.ai/api/v1
LLM_API_KEY=YOUR_OPENROUTER_KEY
LLM_MODEL=anthropic/claude-haiku-4-5
SUBJECT_NAME=YourFirstName
```

> [!IMPORTANT]
> The service role key has full write access to your database. Keep `.env.local` out of version control (the repo `.gitignore` should already cover it) and never commit real keys.

### 3. Run the autobiography synthesizer (topic mode)

List available synthesizers:

```bash
node scripts/synthesize-wiki.mjs --list
```

Dry-run a single year to sanity-check the corpus without spending tokens:

```bash
node scripts/synthesize-wiki.mjs --topic autobiography --scope year=2024 --dry-run
```

Generate one year for real:

```bash
node scripts/synthesize-wiki.mjs --topic autobiography --scope year=2024
```

Or generate the full thing (one LLM call per year of data — can take a while):

```bash
node scripts/synthesize-wiki.mjs --topic autobiography
```

Output lands in `output/wiki/autobiography.md` (or `autobiography-YYYY.md` when scoped), with an `INDEX.md` listing next to it.

### 4. Run the email-thread wiki backfill (email-thread mode)

Only run this after you have email thoughts imported. Start with a dry-run to see which threads pass the eligibility filter:

```bash
node scripts/backfill-gmail-wikis.mjs --dry-run
```

Then synthesize the top N threads to confirm cost + quality before a full run:

```bash
node scripts/backfill-gmail-wikis.mjs --limit=5
```

Full backfill:

```bash
node scripts/backfill-gmail-wikis.mjs
```

The run state log lives at `./data/wiki-synthesis-state.jsonl`. Re-running the script is resume-safe — previously-ok threads are skipped, ineligible threads stay logged, and failed threads retry up to `MAX_ATTEMPTS` (3). Pass `--re-evaluate` to force a re-check of already-synthesized threads.

### 5. (Optional) Wire it into a dashboard

If you run a Next.js-based Open Brain dashboard, copy the files from [`dashboard-snippets/`](./dashboard-snippets/) into your app:

- `components/GenerateAutobiographyButton.tsx` — a Client Component that drives a Server Action.
- `app/wiki/page.tsx` — the `/wiki` index that lists generated articles and exposes a one-click regenerate button.
- `app/wiki/[slug]/page.tsx` — a `/wiki/<slug>` detail page that renders the selected article.

The snippets assume a Tailwind setup with theme tokens like `bg-bg-surface`, `text-text-primary`, `border-violet/40`. Swap these for whatever your dashboard theme uses. You must also add your own authentication guard before surfacing personal content — the snippets ship with `// e.g. await requireSessionOrRedirect();` placeholders.

> [!WARNING]
> The Server Action spawns a Node subprocess that can exceed Next.js's default server-action timeout when running a full (multi-year) autobiography. Use the year dropdown to scope one year at a time, or run the CLI directly for full generations.

## Expected Outcome

**Topic mode, after a successful autobiography run:**

- `output/wiki/autobiography.md` (or `autobiography-2024.md` when scoped) with YAML frontmatter (`title`, `type: wiki-autobiography`, `subject`, `generated_at`, `source_count`, `year_count`) followed by one `## YYYY` section per year.
- Each section is 2-4 paragraphs of second-person biographical prose, grounded in the thoughts for that year.
- `output/wiki/INDEX.md` regenerated to list every article in the directory.

**Email-thread mode, after a successful backfill:**

- One new thought per eligible Gmail thread, with `source_type='gmail_wiki'` and metadata including `gmail.thread_id`, `gmail.message_count`, `gmail.atom_count`, and `gmail.total_word_count`.
- One `thought_edges` row per source atom, with `relation='derived_from'` linking the wiki back to each atomic thought it summarized.
- An append-only state log at `./data/wiki-synthesis-state.jsonl` with one row per thread per run.

You can query back the email wikis with a simple PostgREST call:

```bash
curl -H "apikey: $OPEN_BRAIN_SERVICE_KEY" \
     -H "Authorization: Bearer $OPEN_BRAIN_SERVICE_KEY" \
     "$OPEN_BRAIN_URL/rest/v1/thoughts?source_type=eq.gmail_wiki&select=id,content,metadata&limit=5"
```

## Troubleshooting

**Issue: "No thoughts found in the requested scope" from the autobiography synthesizer**
Solution: Check that your thoughts have either date metadata (`event_at`, `life_date`, `source_date`, `captured_at`, `original_date`, or `date`) or a valid `created_at`. If you set `SOURCE_TYPE_FILTER`, confirm at least one thought matches that source_type. Run without `--scope` first to see which years show up.

**Issue: Email-thread script reports `0 gmail_export thoughts across 0 thread(s)`**
Solution: Your email importer is not writing the expected metadata shape. The script keys off `source_type='gmail_export'` and `metadata.gmail.thread_id`. If you used a different importer, either adjust its output or edit the filter in `fetchGmailThoughts` / `groupByThread`.

**Issue: "GET thought_edges ... 404" or "relation \"public.thought_edges\" does not exist"**
Solution: You need the knowledge-graph schema that defines `public.thought_edges`. Install the schema from OB1's Knowledge Graph recipe / PR first, or remove the `derived_from` edge writes if you do not want provenance links.

**Issue: "rpc/upsert_thought 404" but email-thread wikis still get inserted**
Solution: That is expected. The script prefers the `upsert_thought` RPC if it exists; otherwise it falls back to a plain `POST /thoughts` insert. The only functional difference is content-fingerprint-aware deduplication.

**Issue: The autobiography writes fabricated details for a sparse year**
Solution: The system prompt tells the model to acknowledge sparse data rather than invent. If the output still confabulates, lower the temperature inside `callLLM` (currently `0.4`), try a stronger model via `--model`, or pre-filter your corpus with `SOURCE_TYPE_FILTER`.

**Issue: Full autobiography run hangs or rate-limits partway through**
Solution: One LLM call per year can be dozens of calls for deep archives. Run year-by-year (`--scope year=YYYY`) so each generation is a single call, or switch `LLM_MODEL` to a cheaper model for drafts and re-run the year you want polished with a stronger model.
