# Typed Edge Classifier

> An Opus/Haiku hybrid LLM classifier that reads pairs of thoughts and writes typed reasoning edges (`supports`, `contradicts`, `evolved_into`, `supersedes`, `depends_on`, `related_to`) into the `thought_edges` table.

## What It Does

Walks candidate pairs of thoughts (pairs that share at least N entities via `thought_entities`), asks Haiku whether each pair is even worth looking at, then asks Opus to do the final classification on the pairs that pass. Inserts a row into `public.thought_edges` with the relation, direction, confidence, and (optionally) temporal bounds. Supports cost-capped batch runs.

## Prerequisites

- Working Open Brain setup ([guide](../../docs/01-getting-started.md))
- [`schemas/typed-reasoning-edges/`](../../schemas/typed-reasoning-edges/) applied (this recipe writes to `thought_edges`)
- [`schemas/entity-extraction/`](../../schemas/entity-extraction/) applied — this is where candidate pairs come from (thoughts that share entities via `thought_entities`). You can skip this if you only ever pass explicit `--pair UUID_A,UUID_B`.
- Node.js 18+
- Anthropic API key

## Credential Tracker

Copy this block into a text editor and fill it in as you go.

```text
TYPED EDGE CLASSIFIER -- CREDENTIAL TRACKER
--------------------------------------

FROM YOUR OPEN BRAIN SETUP
  Project URL:           ____________   -> OPEN_BRAIN_URL
  Service-role secret:   ____________   -> OPEN_BRAIN_SERVICE_KEY

ANTHROPIC
  API key:               ____________   -> ANTHROPIC_API_KEY

COST CAP FOR FIRST RUN
  Max USD:               ____________   (recommend $1-2 for a dry run first)

--------------------------------------
```

## Steps

1. Copy `classify-edges.mjs` into a local directory you control (or clone this recipe's folder)
2. Set the three required environment variables:

   ```bash
   export OPEN_BRAIN_URL="https://YOUR-PROJECT.supabase.co"
   export OPEN_BRAIN_SERVICE_KEY="..."   # service_role key — server-side only
   export ANTHROPIC_API_KEY="sk-ant-..."
   ```

3. Run a **dry run** first with a small limit and a low cost cap:

   ```bash
   node classify-edges.mjs --limit 10 --dry-run --max-cost-usd 0.50
   ```

   This prints what it *would* insert without writing anything, and stops once estimated spend reaches the cap.

4. Review the output. Look for:
   - Pairs with `[dry] would_insert` lines — these are the inserts you'd be approving
   - Pairs with `[low] below_confidence` — the classifier was unsure; tune `--min-confidence` if needed
   - `filter_rejected` — Haiku said "nothing interesting here"; this is usually correct
5. Once you're happy with the output, run without `--dry-run`:

   ```bash
   node classify-edges.mjs --limit 100 --max-cost-usd 3.00
   ```

6. Inspect the table:

   ```sql
   SELECT relation, count(*), round(avg(confidence)::numeric, 2) as avg_conf
   FROM thought_edges
   GROUP BY relation
   ORDER BY count(*) DESC;
   ```

## How the hybrid tiering works

The default pipeline is two-stage:

1. **Stage 1 — Haiku filter.** For each candidate pair, Haiku reads the two thoughts and answers a single strict-JSON question: "is there any meaningful relation here, yes or no?" This is ~10-20x cheaper than asking Opus to classify everything up front.
2. **Stage 2 — Opus classify.** For pairs that pass the filter, Opus does the full classification with the six-label vocabulary + direction + confidence + optional temporal bounds.

You can disable the hybrid and run a single model end-to-end with `--model <model>` (e.g., `--model claude-haiku-4-5-20251001` for a cheap pass).

## Cost bound

| Stage | Rough tokens / pair | Model | Approx cost / pair |
|---|---|---|---|
| Haiku filter | 300 in / 100 out | `claude-haiku-4-5-20251001` | $0.0005 |
| Opus classify | 800 in / 200 out | `claude-opus-4-7` | $0.018 |

Typical filter pass rate: 20-40%. On 500 candidate pairs with a 30% pass rate, expect roughly `500 * $0.0005 + 150 * $0.018 = $2.95`.

The `--max-cost-usd` flag is a **hard cap** on estimated spend. The classifier tracks estimated token cost after every call and stops scheduling new pairs the moment the cap is reached. Always pass a cap on first runs.

**Hard-cap semantics under `--parallelism > 1`.** Before launching each chunk, the runner computes the remaining budget and clamps the chunk size so that `chunk_size * worst_case_per_pair <= remaining_budget`. As spend approaches the cap, parallelism drops to 1; once spend meets or exceeds the cap, no new pairs are scheduled. Worst-case overshoot is bounded by the cost of the **single** in-flight task that discovers the cap has been hit, which is `worst_case_per_pair` (roughly $0.018 for Opus 4.7 on the default prompt). Previously, up to `parallelism - 1` extra pairs could spend past the cap because all in-flight tasks checked `costState.spent` before any of them had resolved. This is now fixed.

The proactive clamp requires the classify model to be priced in `PRICING` (in `classify-edges.mjs`). Unknown models disable the clamp; the classifier will **refuse to run with `--max-cost-usd`** under an unknown model unless you explicitly pass `--no-cost-cap` (see pricing warning below).

## Expected Outcome

After a full non-dry run:

- New rows in `public.thought_edges`, one per classified pair.
- Each row has `classifier_version = 'typed-edge-classifier-1.0.0'` so future vocabulary changes are distinguishable from older runs.
- `metadata.rationale` on each row explains why the classifier picked the label — useful for spot-checking.
- `confidence` is in [0, 1]; only rows `>= --min-confidence` (default 0.75) were inserted.
- Pairs with existing non-`related_to` edges in either direction were skipped (`skip_already_classified`).
- Self-loops and missing-thought pairs were silently skipped.

## CLI flags

```
--limit N                Max candidate pairs (default 20)
--min-support N          Min shared entities per pair (default 2)
--pair UUID_A,UUID_B     Classify one explicit pair; skips sampling
--model MODEL            Use one model end-to-end; disables hybrid
--filter-model MODEL     Haiku model for candidate filter
--classify-model MODEL   Opus model for final classification
--no-hybrid              Skip Haiku filter entirely
--max-cost-usd N         Hard cap on estimated spend (default 5.00)
--dry-run                Classify but do not INSERT
--min-confidence N       Skip inserts below this confidence (default 0.75)
--parallelism N          Concurrent API calls (default 3)
--mirror-supersedes      Also set thoughts.supersedes on the older thought
                         when a supersedes edge is classified. OFF by default.
```

## Design Tensions (unresolved)

The companion schema README has the full tree of the two tensions; this section repeats them from the classifier's perspective because they affect flag defaults.

### Tension 1: separate `thought_edges` vs. polymorphic `edges`

This classifier writes to `thought_edges`. If the OB1 maintainer decision flips to a polymorphic `edges` table (thought FKs added to the existing entity `edges` table), this recipe's `insertTypedEdge` becomes the only thing that needs to change — the filter + classify + prompt logic stays the same. Most of the sophistication of this recipe is in the prompt and cost accounting, not the storage target.

### Tension 2: Overlap with `provenance-chains` `supersedes` column

When the classifier decides that thought A `supersedes` thought B, there are two places that fact could live:

1. **As an edge in `thought_edges`** — source of truth, carries evidence and temporal bounds.
2. **As `public.thoughts.supersedes` on the older thought** — denormalized pointer for fast lookup, added by the sibling `provenance-chains` PR.

**Open question: should this classifier also update `public.thoughts.supersedes` when it inserts a supersedes edge?**

This recipe ships with a **`--mirror-supersedes`** flag that is **OFF by default**. When on, after inserting a `supersedes` edge from A -> B, the classifier also issues `UPDATE thoughts SET supersedes = A WHERE id = B`. When off, only the edge table is written.

**Atomicity caveat (NOT atomic in this version).** The edge INSERT and the `thoughts.supersedes` PATCH are two separate HTTP calls. There is no transaction across them.

- **Preflight:** when `--mirror-supersedes` is passed, the classifier queries `information_schema.columns` at startup and fails fast if `public.thoughts.supersedes` does not exist (i.e. `schemas/provenance-chains/` is not applied). This catches the common "column missing -> silent half-write" class of failure before any LLM spend.
- **Failure mode:** if the PATCH fails mid-run (network, 5xx, RLS), the edge is written but `thoughts.supersedes` is NOT updated. The run logs `[warn] mirror supersedes failed ...` and continues. Downstream readers that hit the edge table will see the relation; readers that hit `thoughts.supersedes` directly will not.
- **Reconciliation:** the mirror is idempotent. Re-running the classifier on the affected pair will hit the unique constraint on the edge (no-op) and retry the PATCH. A one-off reconciliation query for all drifted rows:
  ```sql
  -- Supersedes edges whose mirror is missing
  SELECT te.from_thought_id AS newer, te.to_thought_id AS older
  FROM public.thought_edges te
  LEFT JOIN public.thoughts t ON t.id = te.to_thought_id
  WHERE te.relation = 'supersedes' AND (t.supersedes IS DISTINCT FROM te.from_thought_id);
  ```
- **Future fix (tracked):** truly atomic mirroring requires a PostgreSQL RPC / stored procedure that wraps both writes in a single transaction. That lives in a follow-up PR; current users should treat `--mirror-supersedes` as best-effort with the reconciliation path above.

**Recommendation (TBD, pending review).** The classifier **should** mirror once `provenance-chains` lands, because:

- Downstream features like `trace_provenance(thought_id)` are likely to hit `thoughts.supersedes` directly rather than joining through `thought_edges`.
- Keeping the denormalized column in sync at classification time is cheaper than a separate periodic reconciliation job.
- If the mirror fails (column doesn't exist), the classifier logs a warning and continues — the edge is still the source of truth.

**Counter-argument.** Two write paths for the same fact is two places to get wrong. If the classifier runs when `provenance-chains` isn't installed, or a user manually edits one side, the two views drift. A periodic sync job is arguably cleaner than tight coupling.

For now: flag off by default, behavior documented, decision deferred to dev-review.

## Troubleshooting

**Issue: `Missing env vars: OPEN_BRAIN_URL, OPEN_BRAIN_SERVICE_KEY, ANTHROPIC_API_KEY`**
Solution: Export all three before running. The service-role key is required because the classifier writes to `thought_edges` directly via PostgREST; the anon key won't have permission. Never commit this key or paste it into any browser-facing app.

**Issue: `Candidate sampling requires thought_entities (from schemas/entity-extraction/)`**
Solution: Either apply the `entity-extraction` schema (so this recipe has a pool to sample from), or skip sampling entirely by passing `--pair UUID_A,UUID_B` for each pair you want classified.

**Issue: Classifier returns `filter_rejected` for most pairs**
Solution: That's usually correct — most co-mentioning pairs don't have a reasoning relation. If you're sure there are real relations being missed, try `--no-hybrid` to send every pair to Opus directly. Be warned: cost goes up roughly 15-20x.

**Issue: `Anthropic claude-opus-4-7: 429` (rate limit)**
Solution: Drop `--parallelism` to 1 or 2 and retry. The classifier does not back off automatically — that's a TODO.

**Issue: Duplicate-key errors on insert**
Solution: Expected. When two concurrent runs try to classify the same pair, one wins and the other sees `duplicate` and skips. The classifier treats duplicates as a no-op, not a failure.

**Issue: Cost cap triggered before processing finished**
Solution: Working as designed. Raise `--max-cost-usd` if you want to continue. The next invocation will `skip_already_classified` any pairs already written.

**Issue: I want to re-classify everything with a new vocabulary version**
Solution: Bump `CLASSIFIER_VERSION` at the top of `classify-edges.mjs`, then `DELETE FROM thought_edges WHERE classifier_version = 'typed-edge-classifier-1.0.0'` before re-running. The version tag exists precisely for this scenario.
