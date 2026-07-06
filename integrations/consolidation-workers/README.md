# Consolidation Workers

![Community Contribution](https://img.shields.io/badge/OB1_COMMUNITY-Approved_Contribution-2ea44f?style=for-the-badge&logo=github)

**Created by [@alanshurafa](https://github.com/alanshurafa)**

> Bio synthesis, metadata normalization, and user-profile wiki workers for post-import thought quality improvement via LLM synthesis.

## What It Does

This integration provides three Supabase Edge Function workers that improve thought quality and synthesis after initial import:

**Bio Worker** (`bio/index.ts`): Synthesizes a canonical biographical profile from person_note, decision, and journal thoughts. The profile is stored as a thought with `metadata.generated_by = "consolidation-bio"` and is updated in place on subsequent runs. Useful for generating "Who is X" summaries from scattered notes.

**Metadata Normalization Worker** (`metadata-norm/index.ts`): Finds thoughts with weak metadata (catch-all type="reference", default importance=3, low-confidence topics) and re-evaluates them via LLM. Only applies changes when the reclassification confidence exceeds 0.8 and the change is material (different type, importance shift >= 2, or new topics where none existed). Marks reviewed thoughts to prevent re-processing.

**Wiki Profile Worker** (`wiki-profile/index.ts`): Synthesizes a sectioned "User Profile" page (slug `user-profile`) into the governed `wiki_pages` surface — ten sections of discrete, evidenced facts, one targeted-retrieval + LLM synthesis call each. Writes go through the `wiki_write_section` regen guard, so a regeneration parks a pending draft (never overwrites) on any section a human has taken ownership of. Omi-inspired (facts, not biography; supersede only when genuinely false/outdated; keep coexisting preferences). See [`wiki-profile/README.md`](wiki-profile/README.md) for the full section list, evidence semantics, and how it differs from the `entity-wiki` / `wiki-synthesis` / `wiki-compiler` recipes.

All three workers:
- Use three-tier LLM fallback: OpenRouter (primary) > OpenAI > Anthropic
- Support dry-run mode for previewing changes without writing
- Log all operations to the `consolidation_log` table for auditability
- Use fail-closed authentication via `MCP_ACCESS_KEY`
- Use wildcard CORS for flexible deployment

For the full tool and worker inventory, see `docs/05-tool-audit.md` in the repository root.

## Prerequisites

- Working Open Brain setup ([guide](../../docs/01-getting-started.md))
- **Enhanced thoughts schema** applied — install `schemas/enhanced-thoughts` for the `type`, `importance`, `sensitivity_tier`, and `source_type` columns (the wiki-profile worker also uses its `search_thoughts_text` and `brain_stats_aggregate` RPCs)
- **Knowledge graph schema** applied — install `schemas/knowledge-graph` for the `consolidation_log` table (used by the bio and metadata-norm workers)
- **Wiki pages schema** applied (wiki-profile worker only) — install `schemas/wiki-pages` for the `wiki_upsert_page` and `wiki_write_section` RPCs the profile page is written through
- **Optional (wiki-profile worker):** `schemas/crm-core` — enables contact links in the People & Relationships section; degrades to plain names when absent
- At least one LLM API key: OpenRouter (recommended), OpenAI, or Anthropic
- Supabase CLI installed for deployment

## Steps

1. Copy the worker folders into your Supabase functions directory.
2. Deploy the `consolidation-bio`, `consolidation-metadata`, and `wiki-profile` edge functions.
3. Set the required environment variables and API keys.
4. Run each worker in dry-run mode first, then apply changes.
5. Verify the resulting rows in `consolidation_log`, `thoughts`, and `wiki_sections`.

### 1. Copy the Integration

Copy the `integrations/consolidation-workers/` folder into your Supabase project's `supabase/functions/` directory. Each subfolder becomes its own edge function:

```bash
cp -r integrations/consolidation-workers/bio supabase/functions/consolidation-bio
cp -r integrations/consolidation-workers/metadata-norm supabase/functions/consolidation-metadata
cp -r integrations/consolidation-workers/wiki-profile supabase/functions/wiki-profile
cp -r integrations/consolidation-workers/_shared supabase/functions/_shared
```

If you already have a `_shared/` folder from the enhanced MCP server, the files are identical — no need to overwrite.

### 2. Deploy the Edge Functions

```bash
supabase functions deploy consolidation-bio --no-verify-jwt
supabase functions deploy consolidation-metadata --no-verify-jwt
supabase functions deploy wiki-profile --no-verify-jwt
```

### 3. Set Environment Variables

```bash
supabase secrets set \
  MCP_ACCESS_KEY="your-access-key" \
  OPENROUTER_API_KEY="your-openrouter-key"
```

Optional multi-provider fallback:

```bash
supabase secrets set \
  OPENAI_API_KEY="your-openai-key" \
  ANTHROPIC_API_KEY="your-anthropic-key"
```

Optional tuning:

```bash
supabase secrets set \
  CONSOLIDATION_MAX_CALLS="100" \
  FETCH_TIMEOUT_MS="60000"
```

- `CONSOLIDATION_MAX_CALLS` — cap on LLM completions per metadata-norm
  invocation. Defaults to 100; set to `0` to disable the cap. When the
  cap trips, the response includes `truncated: { reason, cap }` and
  already-written `consolidation_reviewed` markers are preserved.
- `FETCH_TIMEOUT_MS` — per-provider LLM fetch timeout in milliseconds.
  Defaults to 60000. On timeout the fallback chain advances to the
  next configured provider.

The wiki-profile worker has its own caps (see
[`wiki-profile/README.md`](wiki-profile/README.md) for the full table):

```bash
supabase secrets set \
  PROFILE_SUBJECT_NAME="Alex Rivera" \
  PROFILE_EXCLUDE_PERSONAL="false" \
  PROFILE_MAX_THOUGHTS_PER_SECTION="40" \
  PROFILE_MAX_LLM_CALLS="10" \
  PROFILE_MAX_INPUT_CHARS="24000"
```

- `PROFILE_SUBJECT_NAME` — the user's display name for third-person
  synthesis. Unset falls back to "the user".
- `PROFILE_EXCLUDE_PERSONAL` — when `true`, also drop `personal`-tier
  thoughts. `restricted` is always excluded regardless. When set,
  top-topic steering is disabled too; interests derive from thought
  types only.
- `PROFILE_MAX_THOUGHTS_PER_SECTION` — cap on thoughts per section
  (default 40). `PROFILE_MAX_LLM_CALLS` caps completions per run
  (default 10 = one per section; an explicit `0` disables — blank or
  invalid values fall back to the default). `PROFILE_MAX_INPUT_CHARS`
  caps prompt content per call (default 24000).

### 4. Run the Bio Worker

Generate a biographical profile (dry run first):

```bash
curl -X POST "https://<project-ref>.supabase.co/functions/v1/consolidation-bio?dry_run=true" \
  -H "x-brain-key: your-access-key"
```

Apply the profile:

```bash
curl -X POST "https://<project-ref>.supabase.co/functions/v1/consolidation-bio" \
  -H "x-brain-key: your-access-key"
```

Optionally target a specific person:

```bash
curl -X POST "https://<project-ref>.supabase.co/functions/v1/consolidation-bio?name=Sarah" \
  -H "x-brain-key: your-access-key"
```

### 5. Run the Metadata Normalization Worker

Preview what would change (dry run):

```bash
curl -X POST "https://<project-ref>.supabase.co/functions/v1/consolidation-metadata?dry_run=true&limit=20" \
  -H "x-brain-key: your-access-key"
```

Apply changes:

```bash
curl -X POST "https://<project-ref>.supabase.co/functions/v1/consolidation-metadata?limit=20" \
  -H "x-brain-key: your-access-key"
```

Increase batch size (max 100):

```bash
curl -X POST "https://<project-ref>.supabase.co/functions/v1/consolidation-metadata?limit=100" \
  -H "x-brain-key: your-access-key"
```

### 6. Run the Wiki Profile Worker

Probe health first (no auth, no writes):

```bash
curl "https://<project-ref>.supabase.co/functions/v1/wiki-profile/health"
```

Preview every section without writing (dry run):

```bash
curl -X POST "https://<project-ref>.supabase.co/functions/v1/wiki-profile?dry_run=true" \
  -H "x-brain-key: your-access-key"
```

Build the profile page (writes through the regen guard):

```bash
curl -X POST "https://<project-ref>.supabase.co/functions/v1/wiki-profile" \
  -H "x-brain-key: your-access-key"
```

Sections a human has edited come back as `pending` (draft parked for review),
sections with no supporting thoughts as `skipped`. See
[`wiki-profile/README.md`](wiki-profile/README.md) for the full response shape.

### 7. Verify the Results

Check the consolidation log for operations:

```sql
SELECT operation, survivor_id, details, created_at
FROM consolidation_log
ORDER BY created_at DESC
LIMIT 10;
```

Verify the bio profile was created. Profiles are scoped by subject — `self` when no `?name=` is supplied, otherwise the name verbatim:

```sql
SELECT id, content, metadata->>'subject' AS subject, metadata
FROM thoughts
WHERE metadata->>'generated_by' = 'consolidation-bio'
ORDER BY created_at DESC;
```

To look up one subject:

```sql
SELECT id, content
FROM thoughts
WHERE metadata->>'generated_by' = 'consolidation-bio'
  AND metadata->>'subject' = 'self'
ORDER BY created_at DESC
LIMIT 1;
```

Check metadata normalization results:

```sql
SELECT id, type, importance, metadata->>'consolidation_reason' AS reason
FROM thoughts
WHERE metadata->>'consolidation_reviewed' = 'true'
ORDER BY updated_at DESC
LIMIT 10;
```

Check the wiki-profile page and its sections:

```sql
SELECT s.display_order, s.section_key, s.heading, s.origin,
       array_length(s.evidence_thought_ids, 1) AS evidence_count
FROM wiki_sections s
JOIN wiki_pages p ON p.id = s.page_id
WHERE p.slug = 'user-profile'
ORDER BY s.display_order;
```

## Expected Outcome

After running the workers:

- **Bio worker**: One canonical biographical profile per subject exists (`self` when no `?name=` was supplied, otherwise the name verbatim). Running again with the same subject updates that profile in place. Running with a different `?name=` creates a new profile for that subject without touching the existing ones.
- **Metadata normalization**: Thoughts previously stuck with generic type="reference" or default importance=3 are reclassified with higher confidence. Each change is logged with the reason and model used. Thoughts that were reviewed but not changed are marked `consolidation_reviewed: true` to avoid re-processing.
- **Wiki profile**: A `user-profile` page exists in `wiki_pages` with up to ten sections in `wiki_sections`, each a short list of discrete, evidenced facts with `evidence_thought_ids` populated. Re-running refreshes machine-owned sections in place and parks a `pending` draft on any section a human has edited. See [`wiki-profile/README.md`](wiki-profile/README.md) for the full section list and response shape.

## Troubleshooting

**Issue: Bio worker returns "No source thoughts found"**
Solution: The worker needs at least one person_note, high-importance decision (>= 4), or recent journal entry. Check that your thoughts have the correct `type` column set. Run the enrichment recipe first if thoughts lack type metadata.

**Issue: Metadata worker finds 0 candidates**
Solution: Candidates must have `type = 'reference'` with confidence < 0.7, or `importance = 3` with confidence < 0.7, and must not already be marked `consolidation_reviewed`. Check your thoughts meet these criteria.

**Issue: All LLM providers fail**
Solution: Verify your API keys are set correctly. Check the Supabase function logs for specific error messages. The worker tries OpenRouter first, then OpenAI, then Anthropic.

**Issue: consolidation_log insert fails**
Solution: Ensure the knowledge graph schema is applied. The `consolidation_log` table is created by `schemas/knowledge-graph`. This is a non-fatal error — the thought updates still succeed.

**Issue: wiki-profile returns "Failed to upsert wiki page"**
Solution: The wiki-profile worker requires `schemas/wiki-pages` (it provides `wiki_upsert_page` and `wiki_write_section`). Apply that schema, then re-run. For the worker's own troubleshooting (pending sections, empty sections, CRM links), see [`wiki-profile/README.md`](wiki-profile/README.md).

## Architecture

```
consolidation-workers/
  _shared/           # Shared config and helpers (same as enhanced-mcp)
    config.ts        # Constants, models, prompt, patterns
    helpers.ts       # Type coercion, embedding, metadata extraction
    network.ts       # fetchWithTimeout, transient-error detection
  bio/
    index.ts         # Biographical profile synthesis worker
  metadata-norm/
    index.ts         # Metadata quality improvement worker
  wiki-profile/
    index.ts         # Sectioned User Profile wiki-page synthesis worker
    README.md        # wiki-profile worker guide
  deno.json          # Deno configuration
  metadata.json      # OB1 contribution metadata
  README.md          # This file
```

This is an optional enhancement — it is not required for the core Open Brain setup. Install it after the enhanced thoughts and knowledge graph schemas (and `schemas/wiki-pages` for the wiki-profile worker) if you want automated thought quality improvement and profile synthesis.
