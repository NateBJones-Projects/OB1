# Recall quality eval harness

## What it does

This recipe provides a small Python harness for recall quality checks before and after changing a vector recall path. It captures a frozen baseline from `match_thoughts`, reruns the same query set later, and reports:

- `recall_at_10`
- `recall_at_50`
- whether the old top 10 is still contained in the new top 50
- per-query latency

The harness is intentionally simple and uses only the Python standard library plus the local `psql` command.

## Prerequisites

- Python 3.10 or newer
- `psql` available on `PATH`
- A local OB1-shaped Postgres database with `pgvector`
- `DATABASE_URL` set to that local database
- A query file shaped like `queries.example.json`

## Steps

1. Create a query set.

   ```bash
   cp queries.example.json queries.local.json
   ```

2. Edit `queries.local.json` so each query includes a `query_embedding` array and any expected ids you want to track.

3. Capture the baseline.

   ```bash
   DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:55432/ob1_fixture" \
     python3 recall_eval.py capture \
       --queries queries.local.json \
       --out baseline.json \
       --match-count 50
   ```

4. Change your recall path in your own local instance.

5. Compare the changed path against the frozen baseline.

   ```bash
   DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:55432/ob1_fixture" \
     python3 recall_eval.py compare \
       --queries queries.local.json \
       --baseline baseline.json \
       --out comparison.json \
       --match-count 50
   ```

## Expected outcome

The comparison JSON gives one row per query plus a summary. A safe recall optimization should preserve the old top 10 inside the new top 50 and should not lose expected ids.

## Troubleshooting

- If `DATABASE_URL is required` appears, set `DATABASE_URL` to your local database.
- If `psql` is missing, install PostgreSQL client tools.
- If `match_thoughts` is missing, run the local OB1 recall schema first.
- If embeddings have the wrong length, regenerate them with the same vector size used by your local `thoughts.embedding` column.
