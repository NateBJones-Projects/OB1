# Smart Ingest

> LLM-powered document extraction that turns raw text into atomic thoughts with semantic deduplication and dry-run preview.

## What It Does

Accepts raw text (meeting notes, articles, journal entries, email threads) and uses an LLM to extract atomic, self-contained thoughts. Each extracted thought is then deduplicated against your existing thoughts using both content fingerprinting and semantic similarity. The results can be previewed in dry-run mode before committing to the database.

The reconciliation engine makes four possible decisions per extracted thought:

- **add** — New thought, no match found
- **skip** — Duplicate (exact fingerprint match or >92% semantic similarity)
- **append_evidence** — Similar thought exists and is richer; add this as corroborating evidence
- **create_revision** — Similar thought exists but this version has more information; create a new revision

**Deduplication thresholds** (configurable in `index.ts`):

| Threshold | Value | Meaning |
|-----------|-------|---------|
| `SEMANTIC_SKIP_THRESHOLD` | 0.92 | Above this similarity, the thought is considered a duplicate and skipped. Set high to avoid false positives — only near-identical thoughts are auto-skipped. |
| `SEMANTIC_MATCH_THRESHOLD` | 0.85 | Above this (but below skip), the thought is considered related to an existing one. The engine then compares content richness to decide between `append_evidence` and `create_revision`. |

Below 0.85, the thought is treated as entirely new (`add`).

## Use Cases

- **Meeting notes** — Paste raw meeting transcripts to extract decisions, action items, and key facts as individual thoughts
- **Journal entries** — Import daily journal entries and let the LLM split them into atomic, searchable thoughts
- **Article/blog ingestion** — Extract key insights from articles you've read, automatically deduped against what you already know
- **Email thread processing** — Turn long email threads into discrete actionable items and reference facts
- **Bulk import** — Process large documents with dry-run preview to ensure quality before committing

## Prerequisites

- Working Open Brain setup ([guide](../../docs/01-getting-started.md))
- **Ingestion Jobs schema** (PR #98 / `schemas/ingestion-jobs`) applied to your database — this PR must be merged first
- At least one LLM API key for extraction: Anthropic, OpenAI, or OpenRouter
- An embedding API key: OpenAI or OpenRouter (Anthropic does not provide embeddings)
- Supabase CLI installed

### Required RPCs

This Edge Function depends on these database functions:

| RPC | Source | Purpose |
|-----|--------|---------|
| `append_thought_evidence(uuid, jsonb)` | `schemas/ingestion-jobs` (PR #98) | Appends corroborating evidence to an existing thought's metadata |
| `match_thoughts(vector, int, float, jsonb)` | Core OB1 schema | Semantic similarity search for deduplication |
| `upsert_thought(text, jsonb)` | Core OB1 schema | Creates or updates a thought with content and payload |

If any of these RPCs are missing, the Edge Function will return errors at runtime.

## Cost

Extraction uses a fast model (Haiku-class) — roughly $0.10-0.50 per document depending on length. Embedding uses OpenAI text-embedding-3-small at ~$0.02 per million tokens. A typical document costs $0.01-0.05 total.

## Credential Tracker

Copy this block into a text editor and fill it in as you go.

```text
SMART INGEST -- CREDENTIAL TRACKER
--------------------------------------

FROM YOUR OPEN BRAIN SETUP
  Supabase URL:            ____________
  Service role key:        ____________
  MCP access key:          ____________

LLM PROVIDER (at least one)
  Anthropic API key:       ____________
  OpenAI API key:          ____________
  OpenRouter API key:      ____________

--------------------------------------
```

## Step-by-step instructions

1. Apply the Ingestion Jobs schema (see `schemas/ingestion-jobs` contribution) if you haven't already. This creates the `ingestion_jobs` and `ingestion_items` tables that smart-ingest uses to track extraction jobs.

2. Create the Edge Function:

   ```bash
   supabase functions new smart-ingest
   ```

3. Copy the contents of [`index.ts`](./index.ts) into `supabase/functions/smart-ingest/index.ts`.

4. Set environment secrets:

   ```bash
   supabase secrets set MCP_ACCESS_KEY=<your-key>
   supabase secrets set ANTHROPIC_API_KEY=<your-key>
   # Or use OPENAI_API_KEY or OPENROUTER_API_KEY instead
   ```

5. Deploy:

   ```bash
   supabase functions deploy smart-ingest --no-verify-jwt
   ```

6. Test with a dry run:

   ```bash
   curl -X POST "https://<your-project>.supabase.co/functions/v1/smart-ingest" \
     -H "Content-Type: application/json" \
     -H "x-brain-key: <your-mcp-key>" \
     -d '{
       "text": "Met with Sarah about the API redesign. She wants GraphQL instead of REST. We agreed to prototype both by Friday. Also, I learned that our current rate limiter is dropping 3% of requests during peak hours — need to investigate.",
       "source_label": "meeting-notes-2026-03-22",
       "dry_run": true
     }'
   ```

7. Review the dry-run results. The response shows each extracted thought with its reconciliation action:

   ```json
   {
     "status": "dry_run_complete",
     "job_id": "abc123-...",
     "extracted_count": 3,
     "added_count": 2,
     "skipped_count": 1,
     "message": "Dry run: 3 extracted. Would add 2, skip 1."
   }
   ```

8. Execute the approved job:

   ```bash
   curl -X POST "https://<your-project>.supabase.co/functions/v1/smart-ingest/execute" \
     -H "Content-Type: application/json" \
     -H "x-brain-key: <your-mcp-key>" \
     -d '{"job_id": "abc123-..."}'
   ```

### One-Step Ingest (Skip Dry Run)

For trusted sources where you don't need to preview, omit `dry_run` or set it to `false`:

```bash
curl -X POST "https://<your-project>.supabase.co/functions/v1/smart-ingest" \
  -H "Content-Type: application/json" \
  -H "x-brain-key: <your-mcp-key>" \
  -d '{
    "text": "Your document text here...",
    "source_label": "daily-journal"
  }'
```

This extracts, reconciles, and writes in a single request.

## API Reference

### `POST /smart-ingest`

Extract thoughts from raw text.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `text` | string | yes | The raw text to extract thoughts from |
| `source_label` | string | no | Human-readable label (e.g. filename, "meeting notes") |
| `source_type` | string | no | Source categorization (e.g. "meeting", "journal") |
| `dry_run` | boolean | no | If true, extract and reconcile without writing (default: false) |
| `reprocess` | boolean | no | If true, process even if identical input was already ingested |

### `POST /smart-ingest/execute`

Execute a previously dry-run job.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `job_id` | string (uuid) | yes | The job ID from a dry-run response |

## Expected Outcome

After deploying and running a test:

- A new row in `ingestion_jobs` with status `complete` (or `dry_run_complete` for dry runs)
- Individual rows in `ingestion_items` showing each extracted thought and its reconciliation decision
- New rows in `thoughts` for items with action `add` (when executed, not dry-run)
- Evidence appended to existing thoughts for `append_evidence` items
- Skipped items logged but not written

Verify with:

```sql
select status, extracted_count, added_count, skipped_count
from ingestion_jobs
order by created_at desc
limit 5;
```

> **Tool hygiene:** This integration adds MCP tools to your AI's context window. As you add more integrations, the total tool count grows. See the [MCP Tool Audit & Optimization Guide](../../docs/05-tool-audit.md) for strategies on managing your tool surface area.

## Troubleshooting

**Issue: `No LLM API key configured`**
Solution: Set at least one of `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, or `OPENROUTER_API_KEY` via `supabase secrets set`. The function tries them in that order.

**Issue: `No embedding API key configured`**
Solution: Embeddings require `OPENAI_API_KEY` or `OPENROUTER_API_KEY`. Anthropic does not provide embeddings.

**Issue: Dry-run job returns `already processed`**
Solution: The same input text was already ingested. Set `"reprocess": true` in your request to force a new extraction. The new job gets a versioned hash (`-v2`, `-v3`, etc.).

**Issue: `relation "ingestion_jobs" does not exist`**
Solution: Apply the Ingestion Jobs schema (see `schemas/ingestion-jobs` contribution) first. The schema must be in place before deploying smart-ingest.

**Issue: All thoughts are being skipped**
Solution: Check your existing thoughts table. If many similar thoughts already exist, the semantic dedup (>0.85 threshold) will match them. Lower the threshold in the code if you want more permissive ingestion, or use `reprocess: true` for a fresh run.
