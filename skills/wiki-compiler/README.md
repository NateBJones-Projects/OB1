# Wiki Compiler (Skill)

> A triggerable operator that makes the [Wiki Compiler recipe](../../recipes/wiki-compiler/)
> run reliably from a natural-language request — bootstrapping credentials,
> verifying schemas, driving the compile, draining the queue, and recovering from
> the failure modes that silently produce nothing on a first run.

## What This Is

The Wiki Compiler *recipe* is a Node wrapper that turns Open Brain thoughts and
graph data into regenerable wiki pages. This *skill* is the thin operational
layer on top: it tells an AI client **when** to reach for the recipe and **how**
to run it end to end without stalling on setup.

It holds no synthesis logic. The recipe scripts and schemas remain the source of
truth; the skill only bootstraps, verifies, and recovers.

## Why It Exists

A first compile reliably hits five silent walls, each of which lets the run
"succeed" while producing nothing:

1. **No root `.env.local`** — the scripts want `OPEN_BRAIN_URL` /
   `OPEN_BRAIN_SERVICE_KEY` / `LLM_API_KEY`, but existing recipe `.env` files use
   `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` / `OPENROUTER_API_KEY`.
2. **Missing `typed-reasoning-edges` schema** — `thought_edges` does not exist,
   so the edge phase has nowhere to write.
3. **OpenRouter dated model-id** — the classifier's default filter model is a
   dated Anthropic snapshot id that OpenRouter rejects with HTTP 400, so every
   pair returns `filter_error` and no edges are inserted.
4. **Batched extraction** — one compile processes only `--extract-limit` queued
   thoughts (default 25); the rest sit unprocessed.
5. **No verification** — the manifest reports `ok` per phase even when a phase
   produced zero rows or files.

The skill encodes the fix for each. See `SKILL.md` for the exact protocol.

## When to Use

- "Compile my wiki", "regenerate the entity wiki", "run wiki-compiler".
- After importing/capturing a batch of new thoughts, to fold them into the graph
  and refresh the compiled pages.
- When a compile ran but `thought_edges` is empty or the queue didn't drain.

## When Not to Use

- You only need the raw SQL/graph data — query Open Brain directly.
- You want to change *what* the wiki says — fix the underlying thoughts, then
  recompile. Never hand-edit generated pages (that is the recipe's core rule).

## Prerequisites

- A working Open Brain install with the `entity-extraction` schema applied.
- Supabase CLI, authenticated, with the target project linked
  (`supabase projects list` → `linked: true`).
- Node.js 18+ and an OpenRouter (or Anthropic) API key.

## Files

- `SKILL.md` — the trigger conditions and step-by-step operational protocol.
- `metadata.json` — contribution metadata.
- `README.md` — this file.

## Works Well With

- [Wiki Compiler recipe](../../recipes/wiki-compiler/) — the build this skill drives.
- [`typed-edge-classifier`](../../recipes/typed-edge-classifier/),
  [`entity-wiki`](../../recipes/entity-wiki/),
  [`wiki-synthesis`](../../recipes/wiki-synthesis/) — the component recipes.
- [`schemas/entity-extraction`](../../schemas/entity-extraction/) and
  [`schemas/typed-reasoning-edges`](../../schemas/typed-reasoning-edges/) — the
  graph tables the compile reads and writes.

## Design Rule

SQL is authoritative; `compiled-wiki/` is a regenerable artifact and stays
gitignored (personal brain data). Fix data, then recompile — do not patch
generated pages.
