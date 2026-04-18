# Lint Sweep

> Bounded weekly audit that scans your brain for orphans, contradictions, stale facts, and low-signal noise — then writes a human-reviewable markdown report. Never mutates thoughts.

## What It Does

Lint Sweep is a read-only quality audit for your Open Brain. It runs the same way a code linter runs — scan the content, flag suspicious items, leave everything to a human to fix. Three cost tiers let you trade completeness for budget: Tier 1 runs entirely in SQL (free), Tier 2 walks the knowledge graph (free), and Tier 3 uses an LLM to sample a small batch of thoughts for contradictions and missing-links (capped LLM spend).

Inspired by Andrej Karpathy's "lint the wiki" pattern and the [CRATE CLI](https://github.com/GuiminChen/CRATE) compile/ask/lint/ingest loop.

## Tiers

| Tier | What it checks | Cost | Runs for |
| ---- | -------------- | ---- | -------- |
| **1 — SQL-only**   | Orphans by tag, exact fingerprint duplicates, missing fingerprints, low-signal noise, over-tagged thoughts, empty content, unchunked dumps | $0 (no LLM) | Any brain, any size |
| **2 — Graph-based** | High-importance thoughts with no entity links, entities with zero edges | $0 (no LLM) | Brains that have the `entity-extraction` schema applied (ships `entities`, `edges`, `thought_entities` tables) |
| **3 — LLM-assisted** | Semantic contradictions, stale facts, superseded decisions, missing-link suggestions, orphan content, low-signal despite high importance | ~$0.01–0.05 per 100 thoughts sampled (Claude Haiku via OpenRouter) | Brains with OpenRouter key configured |

Tier 1 and Tier 2 run against your Supabase project via PostgREST and complete in seconds against a 100K-thought brain. Tier 3 is the only tier that calls an external API — and it is hard-capped by `--max-llm-calls`.

## Prerequisites

- Working [Open Brain setup](../../docs/01-getting-started.md) with `public.thoughts` populated
- Node.js 18 or later
- (Optional, Tier 2) The `entity-extraction` schema applied (ships the `entities`, `edges`, and `thought_entities` tables Tier 2 walks). If your brain was set up before that schema landed, see the schema PRs [#197](https://github.com/NateBJones-Projects/OB1/pull/197) and [#199](https://github.com/NateBJones-Projects/OB1/pull/199). Tier 2 is skipped gracefully when these tables are absent — it does NOT use the `ob-graph` recipe's `graph_nodes` / `graph_edges` tables.
- (Optional, Tier 3) An OpenRouter API key with credit available

> [!IMPORTANT]
> Tier 2 depends on the `entity-extraction` schema (`entities`, `edges`, `thought_entities`), not the `ob-graph` recipe. `ob-graph` creates differently-named tables (`graph_nodes`, `graph_edges`) and is not compatible with Tier 2. If you only have `ob-graph` installed, Tier 2 will log the tables as missing and skip.

## Credential Tracker

Copy this block into a text editor and fill it in as you go.

```text
LINT SWEEP -- CREDENTIAL TRACKER
--------------------------------------

FROM YOUR OPEN BRAIN SETUP
  Supabase project URL:       ____________   (SUPABASE_URL)
  Supabase service role key:  ____________   (SUPABASE_SERVICE_ROLE_KEY)
  (Legacy OPEN_BRAIN_URL / OPEN_BRAIN_SERVICE_KEY are accepted as fallbacks.)

OPTIONAL (TIER 3 ONLY)
  OpenRouter API key:         ____________   (OPENROUTER_API_KEY)

--------------------------------------
```

## Installation

1. Copy the recipe into a working directory on the machine that will run the sweep (your laptop, a VPS, or a CI runner):

   ```bash
   cp -r recipes/lint-sweep ~/lint-sweep
   cd ~/lint-sweep
   ```

2. Create a `.env.local` file in that directory with your credentials:

   ```bash
   cat > .env.local <<'EOF'
   SUPABASE_URL=https://your-project.supabase.co
   SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
   # Optional: OPENROUTER_API_KEY=sk-or-v1-...
   EOF
   chmod 600 .env.local
   ```

   > [!NOTE]
   > This recipe now uses the standard `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` variable names used by every other OB1 recipe, so a shared `.env.local` works across the whole repo. The legacy `OPEN_BRAIN_URL` / `OPEN_BRAIN_SERVICE_KEY` names are still accepted (with a deprecation warning) for backward compatibility.

   > [!WARNING]
   > The service role key bypasses Row Level Security. Keep `.env.local` out of version control and restrict its file permissions.

3. (Optional) Apply the SQL views if you want to run Tier 1 checks directly in Supabase Studio without the Node script:

   Open Supabase → SQL Editor → paste the contents of [`views.sql`](./views.sql) → Run. This creates read-only views (`lint_orphans_by_tag`, `lint_exact_duplicates`, `lint_high_importance_isolated`, etc.) you can query any time.

4. Verify the script runs:

   ```bash
   node lint-sweep.js --tier=1
   ```

   You should see progress output and a `lint-report-YYYY-MM-DD.md` file in your working directory.

## Usage

Run every tier against the defaults:

```bash
node lint-sweep.js
```

Pick a single tier:

```bash
node lint-sweep.js --tier=1                            # SQL-only, free
node lint-sweep.js --tier=2                            # graph-based, free
node lint-sweep.js --tier=3 --max-llm-calls=5          # LLM, capped
```

Custom output path and sample size:

```bash
node lint-sweep.js \
  --tier=all \
  --sample-size=200 \
  --max-llm-calls=10 \
  --report=./reports/weekly-$(date +%F).md
```

All flags:

| Flag | Default | Meaning |
| ---- | ------- | ------- |
| `--tier=<1\|2\|3\|all>`   | `all`                            | Which tier(s) to run |
| `--sample-size=<N>`       | `100`                            | Tier 3 sample size (bounded by `--max-llm-calls × 20`) |
| `--max-llm-calls=<N>`     | `5`                              | Hard cap on Tier 3 LLM calls (each audits ~20 thoughts) |
| `--report=<path>`         | `./lint-report-YYYY-MM-DD.md`    | Where to write the markdown report |
| `--days=<N>`              | `365`                            | Tier 3 recency window |
| `--llm-model=<id>`        | `anthropic/claude-haiku-4-5`     | OpenRouter model for Tier 3 |
| `--verbose` / `-v`        | off                              | Print progress per LLM call |
| `--help` / `-h`           | —                                | Show usage |

## Report Format

The output is a self-contained markdown file ready for human review. Sample output from a small test brain:

```markdown
---
title: Lint Sweep — 2026-04-18
generated_at: 2026-04-18T14:22:11.031Z
tier: all
started_at: 2026-04-18T14:22:04.112Z
finished_at: 2026-04-18T14:22:11.031Z
---

# Open Brain Lint Sweep — 2026-04-18

*Read-only audit. This script never mutates thoughts.*

## Scan scope

This run inspects bounded samples, not your entire brain. Counts below are relative to these samples.

- **Tier 1** — most recent **2000 thoughts** (ordered by `id desc`) for orphan/over-tag/length checks; up to **5000 rows** with a populated `content_fingerprint` for duplicate detection; full-table exact row counts for `thoughts` and `content_fingerprint IS NULL` (no cap).
- **Tier 2** — first **500 high-importance thoughts** (`importance >= 4`), first **2000 entities**, first **5000 edges**.
- **Tier 3** — up to **100 thoughts** from the last **365 days**, batched ~20 per LLM call, hard-capped at **5 LLM calls**.

On brains larger than these caps, Tier 1/2 counts represent a **slice**, not the global total. Example: "Entities with zero edges: 12" under a 2000-entity cap means *12 isolated entities among the first 2000 returned*, not "12 total isolated entities." For whole-brain coverage, run the SQL views in [`views.sql`](./views.sql) directly.

## Summary

*Counts below reflect the bounded scan scope described above — not whole-brain totals.*

- Total thoughts in table (exact count, uncapped): 12847
- Orphans by tag (in recent 2000 sampled): 43
- Exact-duplicate fingerprint groups (in first 5000 fingerprinted rows): 2
- Rows missing content_fingerprint (exact count, uncapped): 0
- Low-signal noise candidates (in recent 2000 sampled): 18
- High-importance isolated — no entity links (in first 500 high-importance sampled): 7
- Entities with zero edges (among first 2000 entities ∩ first 5000 edges): 12
- LLM contradiction findings: 4 (over 100 thoughts, 5 LLM calls)

## Tier 1 — SQL-only lint (free)

- Orphans by tag (recent 2000 thoughts): **43** — thoughts with no topics, tags, or people.
- Over-tagged (>10 tags): **3** — typically import noise.
  - thought #48221 → 14 tags
  - thought #48219 → 12 tags
- Empty content: **0**
- Very long content (>20K chars): **2** — usually unchunked dumps.
- Low-signal noise (importance ≤2, content <40 chars): **18**
- Exact-duplicate fingerprint groups: **2**
  - fingerprint a1b2c3d4e5f6… → 2 copies (ids: 11032, 11418)
- Rows missing content_fingerprint: **0** — consider running the fingerprint-dedup-backfill recipe.

## Tier 2 — Graph-based lint (free)

*Scope: first 500 high-importance thoughts, first 2000 entities, first 5000 edges. Counts below are within that slice, not the whole brain.*

- High-importance (≥4) thoughts with no entity links (in first 500 high-importance sampled): **7**
  - #12033 (imp=5, 2026-01-14) — Moving biweekly 1:1 from Thursday to Tuesday starting next month…
- Entities with zero edges (among first 2000 entities ∩ first 5000 edges): **12**

## Tier 3 — LLM-assisted contradiction sampling (budgeted)

- Sample size: **100** thoughts
- LLM calls: **5** (cap: 5)
- Model: `anthropic/claude-haiku-4-5`

### Contradictions (2)

*Two thoughts state incompatible facts.*

- **#4821, #9102** — Both thoughts describe team size. #4821 says "5 engineers as of Jan 2025" and #9102 says "3 engineers" with no date.
  - *Action:* Annotate #9102 with a date or mark it superseded.

### Stale Facts (1)
...

---

**Safety:** `lint-sweep.js` is read-only. Every finding above is a suggestion for a human to review. Before acting on any item, verify the thought with `get_thought` or the web UI. Never delete or edit a thought based solely on this report.
```

## Expected Outcome

After a successful run you should see:

- A markdown report at the path you passed to `--report` (or `./lint-report-YYYY-MM-DD.md` by default).
- Console output showing progress per tier and final counts — something like `[tier 1] done — 12847 total thoughts, 43 orphans-by-tag, 2 dup groups, 0 missing-fingerprint`.
- No changes to your Open Brain. The result of the sweep is the report file — nothing else is written back to the database.

The report is designed to be triaged by hand: scan each section, follow up on anything that looks real, ignore anything that is a false positive. Over several weeks you should see Tier 1 and Tier 2 counts shrink as you clean up obvious hygiene issues, leaving Tier 3 findings as the main source of ongoing work.

## Cost Notes

Tier 1 and Tier 2 are free — they only touch your Supabase project via PostgREST.

Tier 3 is the only billed component. Using the default `anthropic/claude-haiku-4-5` model on OpenRouter, each call with ~20 thoughts (~6k input tokens + ~2k output tokens) runs about **$0.002 to $0.005** at current public pricing. The default cap of 5 calls covers 100 thoughts per sweep for **~$0.02**. Scaling up:

| `--sample-size` | `--max-llm-calls` | Approx. cost per run |
| --------------- | ----------------- | -------------------- |
| 100  | 5   | ~$0.02 |
| 200  | 10  | ~$0.04 |
| 500  | 25  | ~$0.10 |
| 1000 | 50  | ~$0.20 |

Pick a smaller, faster model (`anthropic/claude-haiku-4-5`) for cheap sweeps or a stronger one (`anthropic/claude-sonnet-4-5`) for weekly deep audits. The script does not retry on failure — a Tier 3 parse failure aborts the run before any report is written, so you get no file at all rather than silently burning credits on a flaky model. If you want Tier 1/2 output without any Tier 3 risk, run with `--max-llm-calls=0` (Tier 3 skips with a logged reason and the report is still written).

Set `--max-llm-calls=0` to disable Tier 3 explicitly without needing to edit the tier flag, and omit the `OPENROUTER_API_KEY` entirely to make Tier 3 skip with a logged reason.

## Safety

- **Read-only by design.** The script only uses `GET` against PostgREST and `POST /chat/completions` against OpenRouter. No `PATCH`, `POST`, `DELETE`, or RPC write calls to your brain.
- **No destructive defaults.** Nothing deletes, merges, updates importance, or edits thoughts. Every finding is a *suggestion* a human must act on via `update_thought`, `delete_thought`, or the web UI.
- **Budget caps are hard caps.** `--max-llm-calls` is enforced before the first LLM call — you cannot exceed it by any combination of other flags.
- **No secrets in the report.** The report contains thought IDs and content previews (first 200 chars). Treat it like the brain content itself — store it in a private repo or an `output/` directory ignored by git.
- **Fail-loud.** Any HTTP error (bad credentials, OpenRouter down, malformed JSON) aborts the run with a clear message rather than writing a partial, misleading report.

## Scheduling

Run the sweep weekly with cron (Linux/macOS):

```cron
# Every Sunday at 02:00 local — writes ~/lint-reports/lint-report-YYYY-MM-DD.md
0 2 * * 0  cd /home/you/lint-sweep && /usr/bin/node lint-sweep.js \
  --tier=all --max-llm-calls=5 \
  --report=/home/you/lint-reports/lint-report-$(date +\%F).md \
  >> /home/you/lint-reports/lint-sweep.log 2>&1
```

Or with Windows Task Scheduler (`schtasks /create`), systemd timers, a GitHub Actions scheduled workflow, or Supabase `pg_cron` calling a wrapper Edge Function.

After each run, open the latest `lint-report-YYYY-MM-DD.md`, triage the findings, and act on anything worth fixing via your normal Open Brain tooling.

## Troubleshooting

**Issue: `ERROR: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set`**
Solution: Create `.env.local` in the same directory as `lint-sweep.js` with both variables, or export them in your shell. Fall-through order is `process.env` → `.env.local` → `.env`. The legacy `OPEN_BRAIN_URL` / `OPEN_BRAIN_SERVICE_KEY` names are still accepted (with a one-line deprecation warning).

**Issue: Tier 1 shows `content_fingerprint column missing — see recipes/content-fingerprint-dedup`**
Solution: Your brain predates the [content-fingerprint-dedup](../content-fingerprint-dedup/) primitive. Apply that recipe (and the [fingerprint-dedup-backfill](../fingerprint-dedup-backfill/) recipe) to get duplicate detection.

**Issue: Tier 2 reports `Graph tables absent`**
Solution: Tier 2 requires the `entity-extraction` schema (`entities`, `edges`, `thought_entities`). If your brain predates that schema, see PRs [#197](https://github.com/NateBJones-Projects/OB1/pull/197) and [#199](https://github.com/NateBJones-Projects/OB1/pull/199), or skip Tier 2 entirely by running `--tier=1` and `--tier=3` separately. Note: the `ob-graph` recipe uses different table names (`graph_nodes`, `graph_edges`) and does NOT satisfy this dependency.

**Issue: Tier 3 fails with `OpenRouter HTTP 401`**
Solution: Your `OPENROUTER_API_KEY` is missing, wrong, or out of credit. Verify at https://openrouter.ai/keys. The sweep does not fall back to a different provider on its own.

**Issue: Report file is written but mostly empty**
Solution: Check the console output — one of the tiers likely short-circuited. Re-run with `--verbose` to see per-call progress. A small brain (<50 thoughts) will produce a short report, which is correct behavior.

**Issue: LLM call produces unparseable JSON**
Solution: Run with `--verbose` to see the raw response. Switch to a stronger model with `--llm-model=anthropic/claude-sonnet-4-5` if the default Haiku model struggles with your sample.

## Works Well With

- **[content-fingerprint-dedup](../content-fingerprint-dedup/)** — installs the `content_fingerprint` column Tier 1 needs for duplicate detection.
- **[fingerprint-dedup-backfill](../fingerprint-dedup-backfill/)** — backfills fingerprints on pre-existing rows so Tier 1 duplicate scanning is accurate.
- **`entity-extraction` schema** — installs the `entities`, `edges`, and `thought_entities` tables Tier 2 walks. See PRs [#197](https://github.com/NateBJones-Projects/OB1/pull/197) and [#199](https://github.com/NateBJones-Projects/OB1/pull/199). (The `ob-graph` recipe is a separate build with different table names and is NOT compatible with Tier 2.)
- **[thought-enrichment recipe (PR #192)](https://github.com/NateBJones-Projects/OB1/pull/192)** — populates `metadata.topics`, `metadata.tags`, and `metadata.people` so Tier 1 orphan-by-tag detection is meaningful.
