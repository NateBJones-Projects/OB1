# Degrade-loud recall

## What it does

This recipe wraps `match_thoughts` so recall returns a source-health block with each response. It makes three states explicit:

- `OK`: recall returned rows
- `DEGRADED`: recall ran but returned no rows
- `UNAVAILABLE`: recall could not run

The goal is to prevent a recall failure from being mistaken for a confident empty result.

## Prerequisites

- A local OB1-shaped Postgres database
- `pgvector` installed
- Existing `thoughts` table
- Existing `match_thoughts(query_embedding vector(1536), match_threshold float, match_count int, filter jsonb)`

## Steps

1. Apply the wrapper locally.

   ```bash
   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f degrade_loud_recall.sql
   ```

2. Call recall through the wrapper.

   ```sql
   select public.match_thoughts_with_health(
     '[0.1,0.2,0.3]'::vector,
     0.0,
     10,
     '{}'::jsonb
   );
   ```

3. Add the assistant wording in `assistant-fail-loud-snippet.md` to any prompt that consumes this wrapper.

## Expected outcome

The caller gets both `results` and `source_health`. If recall returns no rows or errors, the assistant can say that memory was degraded or unavailable instead of implying that nothing relevant exists.

## Troubleshooting

- If `source_health.status` is `UNAVAILABLE`, inspect `source_health.reason`.
- If `source_health.status` is `DEGRADED`, lower the threshold or verify embeddings were generated against the same model.
- If the assistant still speaks confidently during degraded recall, check that the prompt snippet is actually included in the consuming prompt.
