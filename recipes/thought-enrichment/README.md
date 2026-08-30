# Thought Enrichment Pipeline

![Community Contribution](https://img.shields.io/badge/OB1_COMMUNITY-Approved_Contribution-2ea44f?style=for-the-badge&logo=github)

**Created by [@alanshurafa](https://github.com/alanshurafa)**

Retroactively classify and enrich your existing thoughts with structured metadata. The pipeline uses an LLM (via OpenRouter or Anthropic API) to extract type, summary, topics, tags, people, action items, confidence, and importance for each thought. A separate regex-based scanner detects sensitive content (SSNs, credit cards, API keys, health data) and assigns sensitivity tiers.

## Prerequisites

- A working Open Brain setup with Supabase
- The **enhanced thoughts schema** applied (from `schemas/enhanced-thoughts/`) -- your `thoughts` table must have columns: `type`, `importance`, `source_type`, `enriched`, `sensitivity_tier`, and `metadata` (JSONB)
- [Node.js 18+](https://nodejs.org/)
- An [OpenRouter](https://openrouter.ai/) API key (recommended) or an [Anthropic](https://console.anthropic.com/) API key

## Setup

1. Copy `.env.local.example` (or create `.env.local`) in this recipe folder with your credentials:

   ```
   SUPABASE_URL=https://your-project-ref.supabase.co
   SUPABASE_SERVICE_ROLE_KEY=eyJ...
   OPENROUTER_API_KEY=sk-or-v1-...
   ```

2. If using Anthropic directly instead of OpenRouter, add `ANTHROPIC_API_KEY` and pass `--provider anthropic` when running.

## Scripts

### enrich-thoughts.mjs -- LLM-based enrichment

Classifies each thought using an LLM and writes structured metadata back to Supabase.

1. Preview what the enrichment will do (no writes):

   ```bash
   node enrich-thoughts.mjs --dry-run --limit 10
   ```

2. Run enrichment for real:

   ```bash
   node enrich-thoughts.mjs --apply --concurrency 5
   ```

3. Check progress at any time:

   ```bash
   node enrich-thoughts.mjs --status
   ```

4. Retry any previously failed thoughts:

   ```bash
   node enrich-thoughts.mjs --apply --retry-failed
   ```

**Flags:** `--provider` (openrouter or anthropic), `--concurrency`, `--limit`, `--skip`, `--model`, `--max-calls`, `--reset-state`.

The `--max-calls` flag is a hard ceiling on the number of LLM calls per run. The default is `10000`; pass `--max-calls 0` to disable the cap. When the limit is hit the script aborts cleanly, prints a summary, and leaves remaining rows with `enriched=false` so you can resume later. This protects against a shell typo (e.g. dropping `--limit`) burning unbounded spend against a large un-enriched table.

**Resume.** The script checkpoints `lastProcessedId` to `data/enrichment-state.json` after each concurrency chunk. On startup, if a checkpoint exists and neither `--skip` nor `--reset-state` was passed, the run resumes from `id > lastProcessedId`. The `enriched=false` filter is still applied as a second layer of defense. Pass `--reset-state` to ignore the checkpoint and start from scratch.

### backfill-type.mjs -- Type canonicalization

Fixes thoughts where the top-level `type` column is still `reference` but `metadata.type` contains a valid different type.

1. Preview:

   ```bash
   node backfill-type.mjs --dry-run
   ```

2. Apply:

   ```bash
   node backfill-type.mjs
   ```

### backfill-sensitivity.mjs -- Regex-based sensitivity detection

Scans thought content for patterns matching SSNs, credit cards, API keys, passwords, medications, health data, and financial details. Upgrades `sensitivity_tier` from `standard` to `personal` or `restricted` as appropriate.

1. Preview:

   ```bash
   node backfill-sensitivity.mjs --dry-run
   ```

2. Apply:

   ```bash
   node backfill-sensitivity.mjs --apply
   ```

## Recommended execution order

1. Run `backfill-type.mjs` first to fix any type mismatches from prior imports.
2. Run `backfill-sensitivity.mjs` to tag sensitive content before enrichment.
3. Run `enrich-thoughts.mjs --dry-run --limit 20` to preview LLM classifications.
4. Run `enrich-thoughts.mjs --apply` to enrich all remaining thoughts.

## Security notes

- **Prompt injection:** thought content is wrapped in `<thought_content>` tags and the system prompt instructs the model to treat everything inside as untrusted data. Any literal tag occurrences in content are escaped. Output fields (`summary`, `topics`, `tags`, `people`, `action_items`) are length-capped and control-char-stripped before they are written to `metadata`. Even so, enriching hostile third-party imports (shared chat exports, scraped feeds) can still influence classification labels — review before trusting them as ground truth.
- **Bearer token on the wire:** every request carries your Supabase service-role key. Double-check that `SUPABASE_URL` points at your own Supabase project, not a proxy or debug server.

## Cost expectations

The default OpenRouter model is `openai/gpt-4o-mini` at roughly $0.001--0.002 per thought. For 1,000 thoughts, expect approximately $1--2. The `backfill-type` and `backfill-sensitivity` scripts are free (no LLM calls -- they use local logic only).

## Expected outcome

After running the full pipeline:

- Every thought has a validated `type` (idea, task, decision, lesson, meeting, journal, person_note, or reference)
- `importance` is scored 1--5 with calibrated distribution (most at 3)
- `metadata` contains `summary`, `topics`, `tags`, `people`, `action_items`, `confidence`, `detected_source_type`, and enrichment provenance
- Thoughts containing sensitive patterns are flagged with `sensitivity_tier` = `personal` or `restricted`
- The `enriched` boolean is set to `true` for all processed thoughts

## Troubleshooting

**`TypeError: Failed to parse URL from /rest/v1/thoughts?...`**

`SUPABASE_URL` is empty, so the request path is relative. Config is read from
`.env.local` layered over `process.env` — confirm the variable is set in one of
them. (Before the fix in this recipe's history, only `.env.local` was consulted,
so env-injected credentials from CI or a wrapper script were invisible.)

**`invalid input syntax for type uuid: "0"` from `backfill-sensitivity.mjs`**

An older revision seeded its pagination cursor with the integer `0`, which
PostgREST rejects when `thoughts.id` is a uuid. The symptom was a run reporting
`Scanned: 0` with `Errors: 1` — a false all-clear. Update to a revision that
seeds the all-zeros uuid.

**Metadata lookups return NULL after a successful enrichment run**

If `metadata->>'source'` is NULL, `metadata ? 'topics'` is false, or
`jsonb_object_keys(metadata)` raises `cannot call jsonb_object_keys on a scalar`,
the column holds a JSON *string* rather than an object. An older revision
pre-stringified `metadata` before serializing the request body, double-encoding
it. Check for affected rows:

```sql
select jsonb_typeof(metadata), count(*) from thoughts group by 1;
-- 'string' rows are double-encoded
```

No data is lost — the original object survives verbatim inside the string. To
repair, confirm every affected row parses back to an object, then un-nest:

```sql
select count(*) from thoughts
where jsonb_typeof(metadata)='string'
  and jsonb_typeof((metadata #>> '{}')::jsonb)='object';

update thoughts set metadata = (metadata #>> '{}')::jsonb
where jsonb_typeof(metadata)='string'
  and jsonb_typeof((metadata #>> '{}')::jsonb)='object';
```

**A few thoughts fail every run**

Malformed LLM JSON, typically well under 1%. Re-run with `--apply
--retry-failed`. Persistent failures are usually very short or non-prose content.

## File overview

| File | Purpose |
|------|---------|
| `enrich-thoughts.mjs` | Main LLM enrichment script |
| `backfill-type.mjs` | Type canonicalization from metadata |
| `backfill-sensitivity.mjs` | Regex-based sensitivity detection |
| `sensitivity-patterns.json` | Configurable regex patterns |
| `lib/sensitivity-patterns.mjs` | Compiles JSON patterns into RegExp |
| `lib/memory-core.mjs` | sha256Hex, canonicalizeText helpers |
