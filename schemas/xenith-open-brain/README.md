# Xenith Open Brain Schema

> A 2560-dimensional Open Brain base schema for Stephen's Xenith setup, with required program metadata indexes and a low-confidence triage queue.

## What It Does

This schema creates the core `thoughts` table for Qwen3-Embedding-4B embeddings (`vector(2560)`), keeps the standard Open Brain `match_thoughts` and `upsert_thought` RPCs, and adds Xenith-specific metadata indexes plus `thoughts_pending` for low-confidence captures. It intentionally skips the stock HNSW vector index because pgvector does not index `vector(2560)` with HNSW/IVFFlat; exact search is fine for the initial personal dataset.

## Prerequisites

- Supabase project from the getting-started guide.
- `pgvector` available in the Supabase project.
- Local Ollama running `qwen3-embedding:4b`, verified to return 2560-dimensional embeddings.
- The customized MCP server in `server/index.ts`.

## Credential Tracker

```text
XENITH OPEN BRAIN -- CREDENTIAL TRACKER
--------------------------------------

SUPABASE
  Project ref:           ____________
  Project URL:           ____________
  Secret key:            ____________

ANTHROPIC
  API key:               ____________

LOCAL EMBEDDINGS
  Ollama base URL:       http://localhost:11434
  Embedding model:       qwen3-embedding:4b
  Embedding dimension:   2560

MCP
  MCP access key:        ____________
--------------------------------------
```

## Steps

1. Open your Supabase SQL Editor.
2. Paste and run the full contents of `schema.sql`.
3. Apply `schemas/entity-extraction/schema.sql`.
4. Apply `schemas/typed-reasoning-edges/schema.sql`.
5. Review `schemas/enhanced-thoughts/schema.sql` and `schemas/workflow-status/migration.sql` before applying; their stock type vocabularies do not fully match Xenith's `decision`, `action_item`, `directive`, `kpi_data_point`, `risk`, `blocker`, `statement`, and `question` vocabulary.

## Expected Outcome

After running `schema.sql`, Supabase should contain:

- `public.thoughts` with `embedding vector(2560)`, `metadata`, `captured_at`, and `content_fingerprint`.
- `public.thoughts_pending` for low-confidence classifications.
- `public.match_thoughts(...)` accepting `vector(2560)`.
- `public.upsert_thought(...)` for deduplicated writes.
- Indexes for `program_id`, `workstream`, `attributed_to`, `type`, `needs_review`, dates, metadata, and vector search.
- Exact vector search through `match_thoughts`. No ANN vector index is created for 2560-dimensional Qwen embeddings.

## Troubleshooting

**Issue: embeddings fail with a dimension mismatch**  
Solution: Run a direct Ollama embedding test and confirm the returned array length. If it is not 2560, update `EMBEDDING_DIMENSION` and this schema before ingesting data.

**Issue: inserts fail because `program_id` is missing**  
Solution: Make sure the customized MCP server sets `DEFAULT_PROGRAM=xenith` and writes `metadata.program_id` on every thought.

**Issue: `entity-extraction` fails with a missing `content_fingerprint` column**  
Solution: Run this schema first. It includes the `content_fingerprint` column required by that migration.
