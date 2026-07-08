---
name: wiki-compiler
description: |
  Triggerable operator for the Wiki Compiler recipe. Use for prompts like
  "compile my wiki", "regenerate the entity wiki", "run wiki-compiler",
  "rebuild the compiled understanding layer", or "turn my Open Brain into
  browsable wiki pages". It bootstraps credentials, verifies the required
  schemas, runs the compile pipeline (entity extraction -> typed edges ->
  entity wiki -> topic wiki), drains the extraction queue, and recovers
  from the known failure modes. This skill does not replace the recipe's
  own scripts — it drives them reliably.
author: Ezana Azene
version: 1.0.0
---

# Wiki Compiler

## Problem

The Wiki Compiler recipe (`recipes/wiki-compiler/compile-wiki.mjs`) is a solid
wrapper, but a first run reliably stalls on the same operational walls: no root
`.env.local`, a missing `typed-reasoning-edges` schema, an OpenRouter model-id
that 400s, extraction that only processes one batch at a time, and no obvious
verification step. Each wall is silent — the run "succeeds" while producing
nothing. This skill encodes the fixes so the compile actually completes.

## Trigger Conditions

- "compile my wiki", "run wiki-compiler", "regenerate the entity wiki pages"
- "rebuild the compiled understanding layer", "make my brain browsable"
- Any request to run `recipes/wiki-compiler/compile-wiki.mjs`
- Symptoms that map to this recipe: `filter_error: N` from the edge classifier,
  `thought_edges` empty after a compile, extraction queue not draining.

## Required Context

Confirm before running:

- Which Open Brain (Supabase) project is the target, and that it is ACTIVE.
- That the Supabase CLI is authenticated and the project is linked
  (`supabase projects list` shows `linked: true`).
- Whether an LLM key (OpenRouter preferred) is available. Every LLM phase needs
  it; the run spends real tokens (edge classifier is cost-capped, default $2).

## Process

Run from the OB1 repo root. Do each gate in order; a phase that "succeeds" with
zero output is a failure — verify, don't assume.

1. **Bootstrap credentials.** If no `.env.local` exists at the repo root, build a
   gitignored one from an existing sibling recipe `.env`
   (`recipes/provenance-chains/.env`, `recipes/brain-smoke-test/.env.local`,
   etc.). Remap the names the wiki-compiler scripts expect — **never print secret
   values**:
   - `SUPABASE_URL` → `OPEN_BRAIN_URL`
   - `SUPABASE_SERVICE_ROLE_KEY` → `OPEN_BRAIN_SERVICE_KEY`
   - `OPENROUTER_API_KEY` → also set `LLM_API_KEY` to the **same** value
     (entity-wiki and wiki-synthesis read `LLM_API_KEY`; the classifier reads
     `OPENROUTER_API_KEY` — they are the same key)
   - `MCP_ACCESS_KEY` → keep as-is (used to trigger the extraction worker)
   - defaults: `LLM_BASE_URL=https://openrouter.ai/api/v1`,
     `LLM_MODEL=anthropic/claude-haiku-4-5`

2. **Schema preflight (Supabase CLI).** Confirm the graph tables exist:
   ```bash
   supabase db query --linked "select table_name from information_schema.tables
     where table_schema='public'
       and table_name in ('thoughts','entities','edges','thought_entities','thought_edges');"
   ```
   `entity-extraction` ships `entities/edges/thought_entities`. If `thought_edges`
   is missing, install the typed-edges schema. **Pass an absolute path** — the CLI
   resolves `-f` relative to the Supabase workdir (the OB1 *parent* dir), not cwd:
   ```bash
   supabase db query --linked -f "$(pwd)/schemas/typed-reasoning-edges/schema.sql"
   ```
   The schema is idempotent and additive (no destructive statements).

3. **Dry run.** `node recipes/wiki-compiler/compile-wiki.mjs --dry-run`. This
   validates credentials and connectivity. Note: `--dry-run` is not uniformly
   free — topic-wiki honors it, but entity-wiki still calls the LLM to preview.

4. **Compile.** `node recipes/wiki-compiler/compile-wiki.mjs`. Outputs land in
   `compiled-wiki/` (entity pages, topic pages, `compile-manifest.json`).

5. **Verify each phase actually did work** (the manifest says `ok` even when a
   phase produced nothing):
   ```bash
   supabase db query --linked "select relation, count(*) from public.thought_edges group by relation;"
   ls compiled-wiki/entities/ compiled-wiki/topics/
   ```
   If `thought_edges` is still empty, apply the edge-phase fix in the next section.

6. **Drain the extraction queue (optional, for full coverage).** One compile
   processes only `--extract-limit` items (default 25). To fold every thought
   into the graph, loop extraction-only passes until pending hits zero, then do
   one final compile so the wiki reflects every entity:
   ```bash
   # pending: select count(*) from entity_extraction_queue where processed_at is null;
   while [ "$(pending)" != "0" ]; do
     node recipes/wiki-compiler/compile-wiki.mjs \
       --skip-edges --skip-entity-wiki --skip-topic-wiki --extract-limit 50
   done
   ```
   A large `--extract-limit` can 502 (edge-function timeout); the worker still
   makes progress, so the loop absorbs it — keep looping until pending is 0.

## Known Failure Modes

- **`status counts: { filter_error: N }`, `$0.00 spent`, `thought_edges` empty.**
  The classifier's default filter model is a *dated* Anthropic id
  (`claude-haiku-4-5-20251001`); OpenRouter rejects dated ids with HTTP 400.
  Fix: if your tree has the `resolveModel` date-stripping fix, defaults work.
  Otherwise run the edge phase standalone with an undated slug (the wrapper does
  not expose `--filter-model`), then `--skip-edges` for the rest:
  ```bash
  node recipes/typed-edge-classifier/classify-edges.mjs \
    --filter-model claude-haiku-4-5 --classify-model claude-opus-4-7
  ```
- **502 on extraction.** Edge-function timeout on a large batch. Lower
  `--extract-limit` and keep looping.
- **`supabase db query -f` "file not found".** The path is resolved from the
  Supabase workdir (repo parent). Always pass an absolute path.

## Design Rule (do not violate)

SQL is the source of truth; `compiled-wiki/` pages are regenerable artifacts.
Never hand-edit generated pages — fix the underlying thought/entity data and
recompile. This is what prevents wiki drift. Keep `compiled-wiki/` gitignored:
it is personal brain data.

## Output

- a populated `compiled-wiki/` (per-entity pages, topic pages, manifest)
- `public.thought_edges` populated with typed reasoning relations
- an entity graph fed by every processed thought (when the queue is drained)
- verification query results confirming each phase produced real rows/files

## Works Well With

- The [Wiki Compiler recipe](../../recipes/wiki-compiler/) — the build this skill
  drives, and the source of truth for flags and architecture.
- The component recipes it orchestrates: `typed-edge-classifier`, `entity-wiki`,
  `wiki-synthesis`, and the `entity-extraction` / `typed-reasoning-edges` schemas.

## Notes

- This skill holds no synthesis logic — the recipe scripts own all behavior. It
  only bootstraps, verifies, and recovers.
- The model-id workaround in "Known Failure Modes" is temporary: once the
  `resolveModel` fix lands upstream, the wrapper's default models work and the
  standalone override is unnecessary. Prefer updating over overriding.
- Adapt for non–Claude Code clients: the Supabase CLI + Node steps are portable;
  only the credential-file bootstrap assumes a local filesystem.
