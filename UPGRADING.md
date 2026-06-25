# Upgrading an existing Open Brain

This guide is for people who already have a working Open Brain and want to bring it up to date with the current repo. It exists because setup is a one-time flow (pasted SQL plus an Edge Function deploy), so there is no update button. The good news: your data and the app code live in separate places, which makes upgrading much safer than it feels.

## The one idea that makes upgrades safe

Your brain is the `thoughts` table (rows plus embeddings). Everything else is replaceable code around it:

- SQL **functions** (`match_thoughts`, dedup helpers) can be re-applied at any time. They are defined with `create or replace`, so re-running the current version swaps the logic without touching rows.
- The **Edge Function** (`open-brain-mcp`) is deployed code. Redeploying replaces the code, never the data.
- **Dashboards** are separate apps reading the same database. Updating them is a normal app redeploy.

Upgrading is therefore: back up, re-apply the changed SQL, redeploy the Edge Function, verify.

## Step 0 - Back up first

Take a backup before changing anything. Either:

- Supabase Dashboard -> Database -> Backups (confirm a recent backup exists or trigger one), or
- a manual dump from your machine:

```bash
pg_dump "$DATABASE_URL" --table public.thoughts --data-only -f thoughts-backup.sql
```

A backup turns every step below into something you can undo.

## Step 1 - See what changed

- Check the repo's Releases page and recent commit history for `docs/01-getting-started.md`, the Edge Function source, and any recipes or schemas you have applied.
- If you set up a while ago and are not sure what you applied, that is fine: the steps below are safe to re-run as-is.

## Step 2 - Re-apply the current SQL

Open the current `docs/01-getting-started.md` and re-run the SQL blocks in the Supabase SQL Editor, in order, skipping nothing:

- `create extension if not exists ...`, `create table if not exists ...`, and `create index if not exists ...` blocks are no-ops where things already exist.
- `create or replace function ...` blocks update the function logic in place. This is the main payload of most upgrades.
- Re-run the row level security and grant blocks too; they are idempotent and keep your permission posture current.

Read any SQL before running it, here and anywhere else. Nothing in the setup flow drops or rewrites your `thoughts` rows, and any future block that did would deserve a hard look first.

## Step 3 - Redeploy the Edge Function

Repeat the deploy steps from the getting-started guide with the current source:

1. Download the current Edge Function files from the repo (same `curl` step as setup).
2. From your linked project folder:

```bash
supabase functions deploy open-brain-mcp --no-verify-jwt
```

This replaces the running code. Your API keys and secrets stay where they are (they live in the project's secrets, not in the code). If you customized the function (for example a different model string), re-apply that edit to the new source before deploying.

## Step 4 - Re-apply recipes and schemas you use

If you installed packages from `recipes/` or `schemas/`, check whether the ones you use changed, and re-run their SQL or scripts per each package's README. They are designed to be additive.

## Step 5 - Verify

A two-minute smoke test:

- Run a search from your connected AI tool (or call `match_thoughts` in the SQL Editor) and confirm familiar thoughts come back.
- Confirm the MCP endpoint responds: your tool should list the Open Brain tools without errors.
- Spot-check that your row count looks right: `select count(*) from public.thoughts;`

If something is off, your backup from Step 0 is the rollback, and the Supabase dashboard keeps prior Edge Function versions so you can redeploy the previous code.

## Upgrading from the original Open Brain (pre-OB1)

If your install predates this repo's current layout, the schema may have drifted enough that patching in place is not worth it. The cleaner path:

1. Stand up a fresh OB1 next to your existing project, following the current `docs/01-getting-started.md`.
2. Export your `thoughts` rows from the old project and import them into the new one.
3. If the embedding model or dimensions changed between your versions, re-embed after import; if they match, embeddings can come along as-is.

When in doubt about whether your old schema maps cleanly, ask in the community before doing surgery on a live brain.

## The easy path: let your AI do the diff

The approach in `docs/04-ai-assisted-setup.md` works just as well for upgrades. Point your AI coding tool at the current repo plus your Supabase project and ask it to compare your live setup against the current getting-started guide and apply what changed, one step at a time, with the backup from Step 0 in place first.
