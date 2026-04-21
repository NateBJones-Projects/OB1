# Wiki Compiler

> The compiled view on demand layer for Open Brain: a recipe that turns structured thoughts and graph data into regenerable wiki artifacts you can run daily, weekly, or on demand.

## What This Is

This recipe is the composition layer Nate described in the video.

It does **not** replace the Open Brain database. It sits on top of it and produces a browsable synthesis layer:

- the SQL database stays the source of truth
- the graph and wiki pages are generated artifacts
- if a wiki page is wrong, you fix the underlying data and regenerate
- the wiki is never the canonical store

That gives you the Karpathy-style "readable compiled understanding" layer without turning markdown pages into the system of record.

## What It Does

`compile-wiki.mjs` orchestrates the graph/wiki stack that now exists on `main`:

1. Triggers the **entity extraction worker** so new thoughts become entities, links, and evidence rows.
2. Runs the **typed edge classifier** so the system can capture reasoning relations like `supports`, `contradicts`, and `supersedes`.
3. Batch-generates **entity wiki pages** from linked thoughts and graph edges.
4. Generates **topic wiki pages** from the core `thoughts` table.
5. Optionally backfills **Gmail thread wiki pages**.

The result is a compiled wiki directory plus a manifest of what ran.

## Why This Matches The Promise

This is the bridge between "Open Brain as durable structured memory" and "LLM wiki as compiled understanding."

It gives you:

- **compiled views on demand** via a single wrapper command
- **scheduled compilation** via cron, Claude Code scheduled tasks, or any job runner
- **graph-backed synthesis** because entity extraction + typed edges land before wiki generation
- **filterable synthesis** because the underlying source is SQL, not raw files
- **regenerable outputs** because the database remains authoritative

That is the architecture Nate described: structured capture first, compiled wiki second.

## Contributor Credit

This recipe is intentionally a **composition layer over contributor work by Alan Shurafa**. The underlying graph/wiki components it orchestrates were authored in the following merged contributions:

- [#197](https://github.com/NateBJones-Projects/OB1/pull/197) — entity extraction schema
- [#199](https://github.com/NateBJones-Projects/OB1/pull/199) — entity extraction worker
- [#208](https://github.com/NateBJones-Projects/OB1/pull/208) — typed reasoning edges + classifier
- [#213](https://github.com/NateBJones-Projects/OB1/pull/213) — entity wiki pages
- [#222](https://github.com/NateBJones-Projects/OB1/pull/222) — wiki synthesis

This wrapper recipe packages those pieces into one reproducible workflow. It is not a rewrite of Alan's work.

## Architecture

```text
Open Brain thoughts (SQL)
        |
        v
entity-extraction trigger + worker
        |
        v
entities / thought_entities / edges
        |
        +--------------------+
        |                    |
        v                    v
typed-edge-classifier   entity-wiki
        |                    |
        v                    v
thought_edges         per-entity wiki pages
        |
        +--------------------+
        |                    |
        v                    v
wiki-synthesis         Gmail thread wikis
        |
        v
compiled-wiki/ + compile-manifest.json
```

## Prerequisites

- A working Open Brain install
- The merged graph/wiki stack on `main`
- Node.js 18+
- A valid `.env.local` or shell env for the underlying recipes
- A deployed `entity-extraction-worker` Edge Function if you want the wrapper to trigger extraction automatically

### Required environment

At minimum, the downstream recipes expect:

```text
OPEN_BRAIN_URL
OPEN_BRAIN_SERVICE_KEY
LLM_API_KEY
```

Additional environment varies by phase:

- `LLM_MODEL`, `LLM_BASE_URL` for wiki synthesis
- `ANTHROPIC_API_KEY` for typed-edge classification
- `EMBEDDING_API_KEY` if you want semantic expansion or thought-mode entity dossiers
- `MCP_ACCESS_KEY` or `ENTITY_EXTRACTION_MCP_ACCESS_KEY` if you want this wrapper to trigger the entity extraction worker automatically
- `ENTITY_EXTRACTION_WORKER_URL` if you do not want the wrapper to derive it from `OPEN_BRAIN_URL`

## Install

Nothing extra to install. This recipe is a wrapper around merged in-repo scripts.

Run it from the Open Brain repo root so the downstream recipes can read your root `.env.local`:

```bash
node recipes/wiki-compiler/compile-wiki.mjs --help
```

Done when: the help text prints and the referenced component scripts exist.

## On-Demand Usage

### 1. Standard compile pass

This is the default "build the compiled understanding layer" run:

```bash
node recipes/wiki-compiler/compile-wiki.mjs
```

By default this:

- tries to trigger entity extraction
- runs typed-edge classification
- generates entity wiki pages
- generates the built-in `autobiography` topic wiki
- writes outputs under `./compiled-wiki/`

### 2. Dry run

Use this before your first real compile:

```bash
node recipes/wiki-compiler/compile-wiki.mjs --dry-run
```

### 3. Compile entity pages only

```bash
node recipes/wiki-compiler/compile-wiki.mjs \
  --skip-extraction \
  --skip-edges \
  --skip-topic-wiki
```

### 4. Compile topic pages only

```bash
node recipes/wiki-compiler/compile-wiki.mjs \
  --skip-extraction \
  --skip-edges \
  --skip-entity-wiki \
  --topic autobiography
```

### 5. Include Gmail thread wikis

```bash
node recipes/wiki-compiler/compile-wiki.mjs --gmail --gmail-limit 10
```

## Scheduling

This is designed to run on demand **or** on a schedule.

### Daily light compile

```bash
node recipes/wiki-compiler/compile-wiki.mjs \
  --edge-limit 25 \
  --entity-batch-limit 15 \
  --topic autobiography \
  --gmail \
  --gmail-limit 5
```

### Weekly deep compile

```bash
node recipes/wiki-compiler/compile-wiki.mjs \
  --edge-limit 150 \
  --entity-batch-limit 75 \
  --topic autobiography \
  --gmail \
  --re-evaluate
```

### Cron example

```cron
0 6 * * * cd /path/to/OB1 && /usr/bin/env node recipes/wiki-compiler/compile-wiki.mjs --edge-limit 25 --entity-batch-limit 15 --topic autobiography >> logs/wiki-compiler.log 2>&1
```

### Agent-driven schedule

If you prefer Claude Code / Codex style scheduled runs, point the agent at:

```bash
node recipes/wiki-compiler/compile-wiki.mjs --edge-limit 25 --entity-batch-limit 15 --topic autobiography
```

The important contract is the same regardless of scheduler:

- write new information into SQL first
- regenerate the compiled wiki from the source tables
- do not manually edit generated wiki pages

## Output

By default the wrapper writes to:

```text
compiled-wiki/
  entities/               # entity-wiki output when using file mode
  topics/                 # wiki-synthesis topic output
  compile-manifest.json   # run summary and phase statuses
```

Other outputs are owned by the underlying recipes:

- `data/wiki-synthesis-state.jsonl` for Gmail thread synthesis state
- `public.thought_edges` for typed reasoning links
- `public.entities`, `public.edges`, `public.thought_entities` for graph extraction

## Important Design Rule

Do **not** treat generated wiki pages as the source of truth.

This recipe is built around the opposite rule:

- capture raw facts and source material in Open Brain first
- compile the wiki from that source
- regenerate instead of manually patching summaries

That is what prevents wiki drift.

## Expected Outcome

After a successful run you should have:

- a refreshed entity graph fed by structured Open Brain data
- reasoning edges in `thought_edges`
- per-entity wiki pages
- topic synthesis pages
- optionally Gmail thread wiki artifacts
- a manifest recording which phases ran and whether they succeeded

At that point you can browse the compiled layer like a wiki while keeping SQL as the authority underneath it.

## Troubleshooting

**Issue: entity extraction phase skips itself**
Solution: set `ENTITY_EXTRACTION_WORKER_URL` plus `ENTITY_EXTRACTION_MCP_ACCESS_KEY`, or define `OPEN_BRAIN_URL` plus `MCP_ACCESS_KEY` so the wrapper can derive the worker endpoint.

**Issue: typed-edge classification fails**
Solution: confirm `ANTHROPIC_API_KEY` is available and that the `typed-reasoning-edges` schema is installed on the target brain.

**Issue: entity pages fail with missing relation/table errors**
Solution: confirm the entity extraction schema and worker have been applied and allowed to populate `entities`, `edges`, and `thought_entities`.

**Issue: Gmail wiki backfill fails**
Solution: confirm your email thoughts use the expected Gmail metadata shape and that `thought_edges` exists.

**Issue: topic synthesis writes the wrong pages**
Solution: pass explicit `--topic` and `--scope key=value` flags so the wrapper only runs the slice you want.
