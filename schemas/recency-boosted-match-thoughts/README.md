# Recency-Boosted match_thoughts RPC

> Adds `match_thoughts_recency` — a variant of the core `match_thoughts` RPC that blends cosine similarity with an exponential recency decay, without replacing the original function.

## What It Does

Installs a new function, `match_thoughts_recency`, alongside the existing `match_thoughts` from the getting-started guide. It accepts the same arguments plus two new optional parameters, `recency_weight` and `half_life_days`, and returns the same columns. Ranking is computed as a blend of cosine similarity and an exponentially-decaying recency factor:

```
recency_factor = exp(-age_days / half_life_days)
final_score    = similarity * (1 - recency_weight)
               + recency_factor * recency_weight
```

With `recency_weight = 0` (the default), the function is identical in behavior to `match_thoughts`. The threshold is applied to the **raw** cosine similarity before the blend, so a high recency weight cannot surface completely irrelevant recent thoughts.

## Why It Matters

Pure cosine similarity returns ancient thoughts ranked high whenever they happen to be vector-nearest. For a personal knowledge base that is fine — old evergreen notes should surface. But for an active daily-context or task-tracking brain, a gentle recency preference produces visibly better results. This RPC makes that preference opt-in and tunable per query rather than baked into the schema.

## Prerequisites

- Working Open Brain setup (see [`docs/01-getting-started.md`](../../docs/01-getting-started.md))
- The core `match_thoughts` function and `thoughts` table already installed

## Credential Tracker

Copy this block into a text editor and fill it in as you go.

```text
RECENCY-BOOSTED match_thoughts -- CREDENTIAL TRACKER
--------------------------------------

SUPABASE (from your Open Brain setup)
  Project URL:           ____________
  Secret key:            ____________

--------------------------------------
```

## Steps

1. Open your Supabase dashboard and navigate to the **SQL Editor**
2. Create a new query and paste the full contents of `schema.sql`
3. Click **Run** to execute the migration
4. Navigate to **Database → Functions** and confirm `match_thoughts_recency` now appears alongside `match_thoughts`

## Expected Outcome

After running the migration:

- A new function, `match_thoughts_recency`, is callable from the Supabase client or REST API.
- The existing `match_thoughts` function is untouched — any client code that calls it continues to behave exactly as before.
- Calling `match_thoughts_recency` with default arguments (`recency_weight = 0`) returns the same ranking as `match_thoughts`.

## Example Usage

### Pure similarity (identical to `match_thoughts`)

```sql
select *
from match_thoughts_recency(
  query_embedding := '[...]'::vector(1536),
  match_threshold := 0.7,
  match_count     := 10
);
```

### Gentle recency nudge

```sql
select *
from match_thoughts_recency(
  query_embedding := '[...]'::vector(1536),
  match_threshold := 0.7,
  match_count     := 10,
  recency_weight  := 0.2,   -- 20% weight on recency
  half_life_days  := 90.0   -- thoughts 90 days old count half as "recent"
);
```

### Strong recency preference (e.g. "what did I capture this week about X?")

```sql
select *
from match_thoughts_recency(
  query_embedding := '[...]'::vector(1536),
  match_threshold := 0.6,
  match_count     := 10,
  recency_weight  := 0.7,
  half_life_days  := 14.0
);
```

### Tuning notes

- `recency_weight = 0.0` → pure similarity (default, backward-compatible).
- `recency_weight = 0.2` → gentle nudge toward recent thoughts.
- `recency_weight = 0.5` → even blend.
- `recency_weight = 1.0` → pure recency ranking (similarity still gates via threshold).
- Values outside `[0, 1]` are clamped.
- `half_life_days` must be positive; non-positive values fall back to 90.

## Troubleshooting

**Issue: "function match_thoughts_recency does not exist"**
Solution: Confirm `schema.sql` ran without errors in the SQL editor. The function installs into the `public` schema; check **Database → Functions** and filter by schema.

**Issue: results look identical to `match_thoughts`**
Solution: You probably left `recency_weight` at its default (`0.0`). That is by design — pass a non-zero value (try `0.2`) to see the recency blend take effect.

**Issue: very recent but irrelevant thoughts are appearing at the top**
Solution: Either raise `match_threshold` (the raw cosine floor) or lower `recency_weight`. The threshold gates on raw similarity before the blend, so a tighter threshold keeps noise out regardless of how strongly you weight recency.

**Issue: I want this to replace `match_thoughts` entirely**
Solution: This schema is deliberately additive. If you want recency-boosted ranking as the default for every caller, change your client code to call `match_thoughts_recency` (same return columns) instead of editing the core function — that keeps this contribution safe to install on any Open Brain and easy to roll back.
