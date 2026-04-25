# Typed Edge Classifier

> An Opus/Haiku hybrid LLM classifier that reads pairs of thoughts and writes typed reasoning edges (`supports`, `contradicts`, `evolved_into`, `supersedes`, `depends_on`, `related_to`) into the `thought_edges` table.

## What It Does

Walks candidate pairs of thoughts (pairs that share at least N entities via `thought_entities`), asks Haiku whether each pair is even worth looking at, then asks Opus to do the final classification on the pairs that pass. Inserts a row into `public.thought_edges` with the relation, direction, confidence, and (optionally) temporal bounds. Supports cost-capped batch runs.

## Prerequisites

- Working Open Brain setup ([guide](../../docs/01-getting-started.md))
- [`schemas/typed-reasoning-edges/`](../../schemas/typed-reasoning-edges/) applied (this recipe writes to `thought_edges`)
- [`entity-extraction` schema (PR #197)](https://github.com/NateBJones-Projects/OB1/pull/197) applied — this is where candidate pairs come from (thoughts that share entities via `thought_entities`). You can skip this if you only ever pass explicit `--pair UUID_A,UUID_B`.
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

> **Pricing disclaimer.** The `--max-cost-usd` cap uses a hand-maintained `PRICING` map in `classify-edges.mjs` that is updated manually. Check [Anthropic's pricing page](https://www.anthropic.com/pricing) before large runs. If you run with a model that is NOT in the PRICING map, the classifier will **refuse to run** when `--max-cost-usd` is set, and will log `WARNING: no pricing info for model "X"` otherwise. Pass `--no-cost-cap` to explicitly acknowledge an uncapped run; see "Pricing-unknown guard" below.

| Stage | Rough tokens / pair | Model | Approx cost / pair |
|---|---|---|---|
| Haiku filter | 300 in / 100 out | `claude-haiku-4-5-20251001` | $0.0005 |
| Opus classify | 800 in / 200 out | `claude-opus-4-7` | $0.018 |

Typical filter pass rate: 20-40%. On 500 candidate pairs with a 30% pass rate, expect roughly `500 * $0.0005 + 150 * $0.018 = $2.95`.

### Pricing-unknown guard

The classifier refuses to start when all of these are true:

1. `--max-cost-usd` is set (which is the default at $5.00).
2. At least one of the models actually going to be called (filter model, classify model, or `--model`) is not present in the `PRICING` map in `classify-edges.mjs`.

Error looks like:

```
Refusing to run: no pricing info for model(s) claude-some-new-model and --max-cost-usd is set.
Either add the model to PRICING in classify-edges.mjs or pass --no-cost-cap to acknowledge
that the cap cannot be enforced.
```

**Remediation (preferred):** add the model to the `PRICING` constant at the top of `classify-edges.mjs`, using the current Anthropic token rates.

**Escape hatch:** pass `--no-cost-cap` to acknowledge that you know the cap won't be enforced for this run.

The `--max-cost-usd` flag is a **hard cap** on estimated spend. The classifier tracks estimated token cost after every call and stops scheduling new pairs the moment the cap is reached. Always pass a cap on first runs.

**Hard-cap semantics under `--parallelism > 1`.** Before launching each chunk, the runner computes the remaining budget and clamps the chunk size so that `chunk_size * worst_case_per_pair <= remaining_budget`. As spend approaches the cap, parallelism drops to 1; once spend meets or exceeds the cap, no new pairs are scheduled. In hybrid mode `worst_case_per_pair` includes BOTH the Haiku filter leg AND the Opus classify leg (roughly `$0.0005 + $0.018 = $0.0185` on the default prompt), so a pair that spends on both legs is fully budgeted before any sibling task launches. Worst-case overshoot is bounded by the cost of the **single** in-flight task that discovers the cap has been hit, which is `worst_case_per_pair`. Previously, up to `parallelism - 1` extra pairs could spend past the cap because all in-flight tasks checked `costState.spent` before any of them had resolved, and the clamp only budgeted the classify leg. This is now fixed.

The proactive clamp requires every model that will actually be called (filter model in hybrid mode, classify model always) to be priced in `PRICING` (in `classify-edges.mjs`). An unknown model on either leg disables the clamp; the classifier will **refuse to run with `--max-cost-usd`** under an unknown model unless you explicitly pass `--no-cost-cap` (see pricing warning below).

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
--no-cost-cap            Acknowledge that the cap cannot be enforced when
                         pricing is unknown for the selected model(s)
--dry-run                Classify but do not INSERT
--min-confidence N       Skip inserts below this confidence (default 0.75)
--parallelism N          Concurrent API calls (default 3)
--mirror-supersedes      Also set thoughts.supersedes on the newer thought
                         (pointing at the older one) when a supersedes edge
                         is classified. OFF by default.
```

## Design Tensions (unresolved)

The companion schema README has the full tree of the two tensions; this section repeats them from the classifier's perspective because they affect flag defaults.

### Tension 1: separate `thought_edges` vs. polymorphic `edges`

This classifier writes to `thought_edges`. If the OB1 maintainer decision flips to a polymorphic `edges` table (thought FKs added to the existing entity `edges` table), this recipe's `insertTypedEdge` becomes the only thing that needs to change — the filter + classify + prompt logic stays the same. Most of the sophistication of this recipe is in the prompt and cost accounting, not the storage target.

### Tension 2: Overlap with `provenance-chains` `supersedes` column

When the classifier decides that thought A `supersedes` thought B, there are two places that fact could live:

1. **As an edge in `thought_edges`** — source of truth, carries evidence and temporal bounds.
2. **As `public.thoughts.supersedes` on the newer thought** — denormalized pointer for fast lookup, added by the sibling `provenance-chains` PR. Per that contract, the pointer lives on the **newer** thought and references the prior thought it replaces (`newer.supersedes = older`).

**Open question: should this classifier also update `public.thoughts.supersedes` when it inserts a supersedes edge?**

This recipe ships with a **`--mirror-supersedes`** flag that is **OFF by default**. When on, after inserting a `supersedes` edge from A -> B (A is newer, B is older), the classifier also issues `UPDATE thoughts SET supersedes = B WHERE id = A` — i.e. the NEWER thought's `supersedes` column points at the prior (older) thought it replaces, per the `provenance-chains` contract. When off, only the edge table is written.

**Atomicity caveat (NOT atomic in this version).** The edge INSERT and the `thoughts.supersedes` PATCH are two separate HTTP calls. There is no transaction across them.

- **Best-effort, no preflight.** Mirror is best-effort. If the column doesn't exist (e.g. `schemas/provenance-chains/` hasn't been applied), the edge still writes successfully and a `[warn] Mirror to thoughts.supersedes failed ...` line is logged. There is no startup preflight — PostgREST [does not expose `information_schema` over REST](https://docs.postgrest.org/en/latest/references/api/schemas.html), so a REST-based column probe is not available on standard Supabase deployments. Check logs for mirror warnings.
- **Failure mode:** if the PATCH fails mid-run (column missing, network, 5xx, RLS), the edge is written but `thoughts.supersedes` is NOT updated. The run logs the warning and continues. Downstream readers that hit the edge table will see the relation; readers that hit `thoughts.supersedes` directly will not.
- **Reconciliation (NOT automatic):** reruns will NOT retry a failed mirror PATCH. Once the `supersedes` edge exists in `thought_edges`, `processPair` short-circuits via `skip_already_classified` before reaching the mirror write, so `thought_edges_upsert` is never called and the PATCH is never re-issued. If the PATCH fails once, `thoughts.supersedes` stays stale until an operator runs the manual repair below. A one-off query to find all drifted rows:
  ```sql
  -- Supersedes edges whose mirror is missing or wrong.
  -- Contract: newer.supersedes = older (provenance-chains).
  -- Edge (from=newer, to=older, relation='supersedes') implies
  -- thoughts(id=from).supersedes = to.
  SELECT te.from_thought_id AS newer, te.to_thought_id AS older
  FROM public.thought_edges te
  LEFT JOIN public.thoughts t ON t.id = te.from_thought_id
  WHERE te.relation = 'supersedes' AND (t.supersedes IS DISTINCT FROM te.to_thought_id);
  ```

### Manual mirror repair

If the run log shows one or more `[warn] Mirror to thoughts.supersedes failed ...` lines, reconcile `thoughts.supersedes` against the `thought_edges` source of truth with the two-step SQL below. Run it as `service_role` in the Supabase SQL Editor (or via `psql` with the service-role connection string).

> **Important — pre-fix installs have backwards writes.** Earlier versions of this classifier (prior to the round-6 fix) wrote the mirror pointer **backwards**: they set `supersedes` on the TO (older) thought pointing at the FROM (newer) thought, inverting the provenance-chains contract (`newer.supersedes = older`). If you ran `--mirror-supersedes` with any pre-fix build, Step 1 below clears those backwards writes before Step 2 sets the correct direction. Running both steps is **safe on fresh installs** — Step 1 is a no-op when nothing is backwards.

```sql
-- Step 1: Clear backwards writes from pre-fix runs.
-- Earlier versions of this classifier set supersedes on the TO (older) thought
-- pointing at the FROM (newer) thought, which inverts the provenance-chains
-- contract. This UPDATE clears those backwards entries.
UPDATE public.thoughts t
SET supersedes = NULL
FROM public.thought_edges te
WHERE te.to_thought_id = t.id
  AND te.relation = 'supersedes'
  AND t.supersedes = te.from_thought_id;

-- Step 2: Set the correct direction — newer.supersedes = older.
-- Edge (from=newer, to=older, relation='supersedes') implies
-- thoughts(id=from).supersedes = to, per the provenance-chains contract.
UPDATE public.thoughts t
SET supersedes = te.to_thought_id
FROM public.thought_edges te
WHERE te.from_thought_id = t.id
  AND te.relation = 'supersedes'
  AND (t.supersedes IS NULL OR t.supersedes <> te.to_thought_id);
```

Safe to run anytime and idempotent: Step 1 only clears rows where `thoughts.supersedes` currently points the wrong way (TO-side holding a FROM-side pointer), and Step 2 only touches rows where the FROM-side's `supersedes` disagrees with the corresponding edge. If everything is already in sync, both steps update zero rows. Neither step deletes or invalidates any `supersedes` pointer that still matches the contract; they only fix drift in one direction (edge → mirror).

- **Future fix (tracked):** truly atomic mirroring requires a PostgreSQL RPC / stored procedure that wraps both writes in a single transaction. That lives in a follow-up PR; current users should treat `--mirror-supersedes` as best-effort and run the manual repair SQL above whenever the log shows a mirror warning.

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
Solution: The classifier now retries 429 and 5xx responses automatically with exponential backoff + jitter (base 1s, doubles each attempt, capped at 60s, up to 5 retries per call). You will see `[classify-edges] Anthropic ... 429: retry N/5 in Nms` lines on each retry. If retries still run out, drop `--parallelism` to 1 or 2; sustained 429s usually mean the account-level rate limit is saturated, not a transient burst.

**Issue: Duplicate-key errors on insert**
Solution: Should not occur in this recipe — the classifier calls the `thought_edges_upsert` RPC (from `schemas/typed-reasoning-edges/schema.sql`) which uses `INSERT ... ON CONFLICT DO UPDATE`. Repeat classifications of the same `(from, to, relation)` bump `support_count`, take the max confidence, and refresh the temporal bounds (GREATEST for `valid_until`, LEAST for `valid_from`, NULL-safe). If you see a duplicate-key error, the RPC is not installed — re-apply `schemas/typed-reasoning-edges/schema.sql`.

**Issue: Cost cap triggered before processing finished**
Solution: Working as designed. Raise `--max-cost-usd` if you want to continue. The next invocation will `skip_already_classified` any pairs already written.

**Issue: I want to re-classify everything with a new vocabulary version**
Solution: Bump `CLASSIFIER_VERSION` at the top of `classify-edges.mjs`, then `DELETE FROM thought_edges WHERE classifier_version = 'typed-edge-classifier-1.0.0'` before re-running. The version tag exists precisely for this scenario.
