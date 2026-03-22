# Smart Ingest

> LLM-powered document extraction that turns raw text into atomic thoughts with semantic deduplication and dry-run preview.

## What It Does

Accepts raw text (meeting notes, articles, journal entries, email threads) and uses an LLM to extract atomic, self-contained thoughts. Each extracted thought is then deduplicated against your existing thoughts using both content fingerprinting and semantic similarity. The results can be previewed in dry-run mode before committing to the database.

The reconciliation engine makes four possible decisions per extracted thought:

- **add** — New thought, no match found
- **skip** — Duplicate (exact fingerprint match or >92% semantic similarity)
- **append_evidence** — Similar thought exists and is richer; add this as corroborating evidence
- **create_revision** — Similar thought exists but this version has more information; create a new revision

## Prerequisites

- Working Open Brain setup ([guide](../../docs/01-getting-started.md))
- Ingestion Jobs schema (see `schemas/ingestion-jobs` contribution) applied to your database
- At least one LLM API key: Anthropic, OpenAI, or OpenRouter
- Supabase CLI installed

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

**1. Apply the ingestion jobs schema**

If you haven't already, apply the Ingestion Jobs schema (see `schemas/ingestion-jobs` contribution). This creates the `ingestion_jobs` and `ingestion_items` tables that smart-ingest uses to track extraction jobs.

**2. Create the Edge Function**

```bash
supabase functions new smart-ingest
```

**3. Add the function code**

Copy the contents of [`index.ts`](./index.ts) into `supabase/functions/smart-ingest/index.ts`.

**4. Set environment secrets**

```bash
supabase secrets set MCP_ACCESS_KEY=<your-key>
supabase secrets set ANTHROPIC_API_KEY=<your-key>
# Or use OPENAI_API_KEY or OPENROUTER_API_KEY instead
```

**5. Deploy**

```bash
supabase functions deploy smart-ingest --no-verify-jwt
```

**6. Test with a dry run**

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

**7. Review the dry-run results**

The response shows each extracted thought with its reconciliation action:

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

**8. Execute the approved job**

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
