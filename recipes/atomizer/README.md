# Atomizer

> Split compound multi-topic thoughts into atomic single-topic thoughts, plus Gmail-specific repair tooling for email ingestion pipelines.

## What It Does

The atomizer takes long, multi-topic text and breaks it into small, self-contained thoughts using an LLM. Atomic thoughts embed better, retrieve more precisely, and compose into higher-signal context packs than whole-body blobs.

This recipe ships two workflows:

1. **Generic pack atomizer (`atomize-packs.mjs`)** — walks local JSON "pack" files of memories from any capture source (Instagram, ChatGPT, X/Twitter, journals, etc.), detects compound memories using lightweight heuristics (sentence count, enumeration, semicolon clauses, conjunction density), and splits each compound into atomic children. Supports three LLM providers: OpenRouter (default), Anthropic API, and Claude CLI.
2. **Gmail re-atomization + audit (`re-atomize-gmail-thought.mjs`, `audit-gmail-pipeline.mjs`, `backfill-gmail-correspondents.mjs`)** — heals an existing Gmail import where long messages were stored whole-body instead of atomized. Splits the body, inserts atoms via `upsert_thought`, redirects `replies_to` edges, re-links correspondents, and deletes the original row. Comes with an audit script that reports scale, metadata completeness, entity-graph integrity, and retrieval probes.

## Prerequisites

- Working Open Brain setup ([guide](../../docs/01-getting-started.md))
- Node.js 18+
- An extended `thoughts` schema — you need the following on top of the base table:
  - `thoughts.source_type text` column
  - `thoughts.metadata jsonb` column
  - `public.entities` table (at minimum: `id`, `entity_type`, `canonical_name`, `normalized_name`, `canonical_email`, `aliases jsonb`, `metadata jsonb`, `last_seen_at`)
  - `public.thought_entities` table (`thought_id`, `entity_id`, `mention_role`, `source`, `evidence jsonb`, unique key on `(thought_id, entity_id, mention_role, source)`)
  - `public.thought_edges` table with a `relation` column (the re-atomizer looks for `replies_to`)
  - A `public.upsert_thought(p_content text, p_payload jsonb)` function that inserts a new thought and returns `{thought_id}`
- For the Gmail workflow only: thoughts previously imported with [`recipes/email-history-import`](../email-history-import/) so rows carry `source_type = 'gmail_export'` and the `[Email from X to Y | Subject: ... | date]` content prefix
- An LLM provider — one of:
  - OpenRouter API key (same one from your Open Brain setup) **recommended, default**
  - Anthropic API key (direct)
  - Local `claude` CLI on PATH (must be run from a standalone terminal, not inside a Claude Code session)

> [!WARNING]
> The atomizer used to include a `codex` provider that ran `codex exec --dangerously-bypass-approvals-and-sandbox`. That path was **removed** before this PR. The atomizer feeds arbitrary user-controlled memory/email text into the LLM — running a sandbox-bypass agent on untrusted input is a prompt-injection → local-code-execution primitive. Use one of the three providers above; they only generate text. If you have an older checkout that still references `--provider=codex`, upgrade.

## Credentials You'll Need

Collect these once. **Keep them only inside `recipes/atomizer/.env.local`** (already gitignored via the repo root `.gitignore`). Do not paste service-role keys into notes, a second text editor, chat, or screenshots — they grant full database read/write/delete access and should be treated like a password.

| Variable | Source | Required? |
|----------|--------|-----------|
| `SUPABASE_URL` or `SUPABASE_PROJECT_REF` | Your Open Brain Supabase project | required |
| `SUPABASE_SERVICE_ROLE_KEY` | Same project, "service_role" key | required |
| `OPENROUTER_API_KEY` | Same one from your Open Brain setup | required for the default (openrouter) provider |
| `ANTHROPIC_API_KEY` | Anthropic Console | required only with `--provider=anthropic` |
| `SELF_EMAILS` | Optional, comma-separated list of your own addresses — skipped on edge pass | optional |

## Setup

### 1. Copy this recipe folder

```bash
# From the OB1 repo root:
cd recipes/atomizer
```

Or copy the files into any working directory.

### 2. Install zero dependencies

All scripts use the Node 18+ built-in `fetch` and `node:*` modules. There's no `npm install` step.

### 3. Create `.env.local`

Create `recipes/atomizer/.env.local` with your credentials:

```text
SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
OPENROUTER_API_KEY=sk-or-v1-your-key
# Optional: comma-separated list of addresses you want skipped on the edge pass
SELF_EMAILS=you@example.com
```

You can alternatively set `SUPABASE_PROJECT_REF` instead of `SUPABASE_URL`. If you prefer the direct Anthropic API, set `ANTHROPIC_API_KEY` and pass `--provider=anthropic` to the scripts. A `.env.example` template ships alongside this recipe; copy it to `.env.local` and fill in real values.

> [!IMPORTANT]
> `.env.local` is loaded script-relative (via `import.meta.url` → `fileURLToPath`), so you can run the scripts from any working directory — `node recipes/atomizer/test-atomize.mjs`, `node test-atomize.mjs` from the recipe folder, etc. Keys are UPPER_SNAKE_CASE and single-line values only; `process.env` takes precedence over file values.

### 4. Run the sanity test

```bash
node test-atomize.mjs --provider=openrouter
```

Expected: the script prints 2–3 atoms it extracted from a deliberately compound synthetic paragraph. If this fails, nothing else in the recipe will work.

## Workflow A — Generic pack atomizer

Use this when you have **pre-import JSON pack files** (arrays of memory objects) from a capture source and want to split compound memories before loading.

### 1. Lay out pack files

```text
data/atomic-memories/standard/
  instagram/
    pack-2025-08.json
    pack-2025-09.json
  chatgpt/
    pack-2025-10.json
```

Each pack is a JSON file whose memory array is either the top-level array or nested under `memories` / `safe_memories`. Each memory object must have `memoryId` and `text`; fields like `importance`, `type`, `tags`, `sensitivity`, `metadata` are preserved on the children.

### 2. Dry run (detect only)

```bash
node atomize-packs.mjs --source instagram --dry-run
```

Prints how many compound memories were detected and shows 3 samples. No files change.

### 3. Live run

```bash
node atomize-packs.mjs --source instagram --provider=openrouter --concurrency 4
```

Each compound memory becomes several children with `memoryId = <parent>-split-<index>` and `metadata.atomization = {parent_id, split_index, split_total, provider}`. Pack files are rewritten in place. A sidecar `atomization-report.json` is written next to each pack directory.

### 4. Process everything

```bash
node atomize-packs.mjs --all --provider=openrouter --concurrency 4
```

Iterates known sources: instagram, grok, x-twitter, claude, journals, gemini, google-activity, limitless, chatgpt.

### Flags

| Flag | Purpose |
|------|---------|
| `--source <name>` | Process one source |
| `--all` | Process all known sources |
| `--dry-run` | Detect compounds only; no writes |
| `--concurrency <N>` | Parallel LLM calls (default 1, clamps to 4 with a warning if higher) |
| `--data-dir <path>` | Override the pack root (default `./data/atomic-memories`) |
| `--provider <name>` | `openrouter` (default), `anthropic`, or `claude-cli` |

Re-running `atomize-packs.mjs` on the same data is safe: children whose `memoryId` ends in `-split-N` or whose `metadata.atomization.parent_id` is set are skipped on subsequent runs (they are already atomic). By default, `atomization-errors.json` captures only a 60-char preview + fingerprint per failure; set `ATOMIZE_DEBUG_ERRORS=1` to persist full memory text for debugging.

## Workflow B — Gmail re-atomization and audit

Use this when you already have Gmail thoughts in the database but some were stored whole-body (long emails were not split at import time).

### 1. Audit what you have

```bash
node audit-gmail-pipeline.mjs --md > audit.md
```

The markdown report tells you how many `gmail_export` thoughts exist, how many are atomized vs whole-body, metadata completeness, entity-graph coverage (author / recipient / cc edges), top correspondents, atom samples, and simple retrieval probes.

### 2. Dry-run re-atomization on one thought

```bash
node re-atomize-gmail-thought.mjs --id=<thought_id> --dry-run --provider=openrouter
```

Prints what the atomizer would produce without writing.

### 3. Live re-atomize one thought

```bash
node re-atomize-gmail-thought.mjs --id=<thought_id> --provider=openrouter
```

The script:

1. Parses `[Email from X to Y | Subject: ... | date]` prefix + body.
2. Atomizes the body via the selected provider.
3. Inserts each atom via `upsert_thought` with `metadata.gmail.atom_index` / `atom_count` set.
4. Redirects `replies_to` edges from the old thought id to `atom_0`.
5. Deletes the old whole-body thought. `thought_entities` edges cascade.
6. Re-links correspondents for each new atom.

### 4. Bulk re-atomize

```bash
# Every whole-body gmail thought with body >=150 words
node re-atomize-gmail-thought.mjs --all --provider=openrouter

# Limit the batch
node re-atomize-gmail-thought.mjs --all --limit=50 --provider=openrouter

# Tighter body cut-off
node re-atomize-gmail-thought.mjs --all --min-words=300 --provider=openrouter
```

> [!NOTE]
> Without `--limit`, `--all` processes up to 1000 rows in a single pass. If you have more whole-body gmail thoughts than that, the script prints a cap warning — just re-run until the warning stops.

> [!CAUTION]
> The re-atomize pipeline is **not wrapped in a single Postgres transaction**. A crash mid-run can leave partially migrated state (new atoms inserted, old row not yet deleted, edges not yet redirected). Recovery: new atoms carry `metadata.re_atomized_from = <old_id>`. Find half-migrated source rows with `select id from thoughts where id in (select (metadata->>'re_atomized_from')::int from thoughts where metadata ? 're_atomized_from')`, then re-run `--id=<old_id>` — the script is idempotent and will finish the migration. If you need strict transactionality, wrap `upsert_thought` + edge redirect + delete in a single RPC.

### 5. Backfill correspondents

Useful after a one-off resolver bug or when you add new `SELF_EMAILS` entries.

```bash
# Preview
node backfill-gmail-correspondents.mjs --dry-run

# Live
node backfill-gmail-correspondents.mjs

# Only thoughts created after a date
node backfill-gmail-correspondents.mjs --since=2026-04-20
```

The script walks `gmail_export` thoughts, pre-filters on **author-edge presence specifically** (a thought with only recipient/cc edges is still re-processed), and ensures every From / To / Cc address resolves to an `entities` row + `thought_entities` edge.

### 6. Re-audit

```bash
node audit-gmail-pipeline.mjs --md > audit-after.md
```

Diff against your first audit to confirm: atomized count went up, whole-body count went down, author edge coverage is at 100%, retrieval probes still match.

## Expected Outcome

After a successful `atomize-packs.mjs --all` run on a realistic pack corpus:

- A per-source `atomization-report.json` with fields like `{source, total_memories, compound_detected, splits_generated, net_change, errors, timestamp}`.
- Pack files rewritten so long multi-topic entries are replaced by 2–14 atomic children.
- Errors collected into `atomization-errors.json` per source; halt triggers if failure rate exceeds 2% across a 100-memory window.

After a Gmail re-atomization + audit cycle, an actual run over a 350-thought STARRED inbox produced:

- 94 of 350 Gmail thoughts atomized (~27%), the rest short enough to stay whole-body.
- 100% author-edge coverage after `backfill-gmail-correspondents.mjs`.
- 144 `replies_to` edges built (47 legitimately skipped because their parent thread root lives outside the imported corpus).
- Entity-keyed retrieval probe (all thoughts authored by the top correspondent) matched the edge count exactly.
- Marketing emails atomized cleanly into 9-atom sequences — coherent atoms, but probably wasted compute; see Troubleshooting.

## Troubleshooting

### `atomizeText: claude-cli cannot be invoked from inside a Claude Code session`

The Claude CLI refuses to run when it detects it's already inside a Claude Code session. Fix with one of:

- Run the script from a separate terminal window (not via Claude Code's tool interface).
- Use `--provider=openrouter` or `--provider=anthropic` — pure HTTP, no CLI at all. OpenRouter is the default.

> [!NOTE]
> Earlier versions of this recipe supported `--provider=codex` as the nested-Claude-Code workaround. That provider was removed after code review flagged it as a prompt-injection → local-code-execution primitive: the atomizer feeds arbitrary user-controlled email/memory text into a sandbox-bypassed agent. Use `openrouter` or `anthropic` instead.

### `no JSON array found in LLM response`

The model returned prose, markdown fences, or a refusal instead of a JSON array. Options:

- Retry (transient prompt-drift is the most common cause).
- Lower concurrency: `--concurrency 1` avoids rate-limit slicing.
- Pick a more instruction-obedient model — on OpenRouter, `anthropic/claude-sonnet-4.5` works reliably; lighter models may drift into commentary.

### Atomization fires on low-signal content (marketing emails)

`re-atomize-gmail-thought.mjs` splits any body ≥ `--min-words` words regardless of sender. A marketing email with 9 paragraphs becomes 9 atoms, each of which later gets embedded and stored. Mitigations:

- Raise `--min-words=300` (or higher) to skip shorter promo blasts.
- Pre-filter the target list in your own SQL (e.g., exclude thoughts whose From contains `noreply` / `no-reply` / known marketing senders) before passing individual IDs.
- Accept the churn and purge low-importance marketing atoms later using your normal `thoughts` cleanup pass.

### `upsert_thought` RPC not found

The re-atomization script requires a `public.upsert_thought(p_content text, p_payload jsonb)` Postgres function that inserts a new thought and returns a row containing `thought_id`. If your schema doesn't expose it yet, either create one (it can be a thin wrapper around an `insert into thoughts ... returning id as thought_id`) or rewrite `re-atomize-gmail-thought.mjs` to insert directly — the RPC is the only reason that script is not pure PostgREST.

### Failure rate halted the run

`atomize-packs.mjs` halts if more than 2% of the last 100 memories failed. Inspect `atomization-errors.json` in the affected source folder — typical causes are (a) your provider hit a rate cap, (b) the CLI binary path is wrong, or (c) the prompt is being blocked by a content filter on certain memory texts. Fix the root cause and rerun; the script is idempotent — memories whose `memoryId` already ends in `-split-N` or that carry `metadata.atomization.parent_id` are skipped on re-run, so re-splitting the same pack is safe.

### Error log / response-body contains sensitive content

Error-path logging now redacts sensitive payloads by default:

- `atomize-text.mjs` truncates raw model output in thrown errors to a length + provider string (raw text available via `ATOMIZE_DEBUG=1`).
- `atomization-errors.json` persists only a 60-char preview + fingerprint per failure (full memory text via `ATOMIZE_DEBUG_ERRORS=1`).
- `entity-resolver.mjs` logs email domain only by default, strips query-string filter values from PostgREST error messages (full output via `ENTITY_RESOLVER_DEBUG=1`).

Flip each flag on only when actively debugging, then clear it.
