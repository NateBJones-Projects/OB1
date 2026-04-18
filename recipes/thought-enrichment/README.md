# Thought Enrichment Pipeline

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

3. Preview what the enrichment will do (no writes):

   ```bash
   node enrich-thoughts.mjs --dry-run --limit 10
   ```

4. Run enrichment for real:

   ```bash
   node enrich-thoughts.mjs --apply --concurrency 5
   ```

5. Check progress at any time:

   ```bash
   node enrich-thoughts.mjs --status
   ```

6. Retry any previously failed thoughts:

   ```bash
   node enrich-thoughts.mjs --apply --retry-failed
   ```

**Flags:** `--provider` (openrouter or anthropic), `--concurrency`, `--limit`, `--skip`, `--model`.

### backfill-type.mjs -- Type canonicalization

Fixes thoughts where the top-level `type` column is still `reference` but `metadata.type` contains a valid different type.

7. Preview:

   ```bash
   node backfill-type.mjs --dry-run
   ```

8. Apply:

   ```bash
   node backfill-type.mjs
   ```

### backfill-sensitivity.mjs -- Regex-based sensitivity detection

Scans thought content for patterns matching SSNs, credit cards, API keys, passwords, medications, health data, and financial details. Upgrades `sensitivity_tier` from `standard` to `personal` or `restricted` as appropriate.

9. Preview:

   ```bash
   node backfill-sensitivity.mjs --dry-run
   ```

10. Apply:

    ```bash
    node backfill-sensitivity.mjs --apply
    ```

## Recommended execution order

11. Run `backfill-type.mjs` first to fix any type mismatches from prior imports.
12. Run `backfill-sensitivity.mjs` to tag sensitive content before enrichment.
13. Run `enrich-thoughts.mjs --dry-run --limit 20` to preview LLM classifications.
14. Run `enrich-thoughts.mjs --apply` to enrich all remaining thoughts.

## Cost expectations

The default OpenRouter model is `openai/gpt-4o-mini` at roughly $0.001--0.002 per thought. For 1,000 thoughts, expect approximately $1--2. The `backfill-type` and `backfill-sensitivity` scripts are free (no LLM calls -- they use local logic only).

## Expected outcome

After running the full pipeline:

- Every thought has a validated `type` (idea, task, decision, lesson, meeting, journal, person_note, or reference)
- `importance` is scored 1--5 with calibrated distribution (most at 3)
- `metadata` contains `summary`, `topics`, `tags`, `people`, `action_items`, `confidence`, `detected_source_type`, and enrichment provenance
- Thoughts containing sensitive patterns are flagged with `sensitivity_tier` = `personal` or `restricted`
- The `enriched` boolean is set to `true` for all processed thoughts

## File overview

| File | Purpose |
|------|---------|
| `enrich-thoughts.mjs` | Main LLM enrichment script |
| `backfill-type.mjs` | Type canonicalization from metadata |
| `backfill-sensitivity.mjs` | Regex-based sensitivity detection |
| `sensitivity-patterns.json` | Configurable regex patterns |
| `lib/sensitivity-patterns.mjs` | Compiles JSON patterns into RegExp |
| `lib/memory-core.mjs` | sha256Hex, canonicalizeText helpers |
