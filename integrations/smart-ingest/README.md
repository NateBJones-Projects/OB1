# Smart Ingest

> LLM-powered document extraction that turns raw text into atomic thoughts with fingerprint and semantic deduplication, dry-run preview, and safe job execution.

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
| `SEMANTIC_SKIP_THRESHOLD` | 0.92 | Above this similarity, the thought is considered a duplicate and skipped |
| `SEMANTIC_MATCH_THRESHOLD` | 0.85 | Above this (but below skip), the engine compares content richness to decide between `append_evidence` and `create_revision` |

Below 0.85, the thought is treated as entirely new (`add`).

## Use Cases

- **Meeting notes** — Paste raw transcripts to extract decisions, action items, and key facts
- **Journal entries** — Import daily entries and let the LLM split them into atomic, searchable thoughts
- **Article ingestion** — Extract key insights, automatically deduped against what you already know
- **Email threads** — Turn long threads into discrete actionable items and reference facts
- **Bulk import** — Process large documents with dry-run preview to ensure quality before committing

## Prerequisites

- Working Open Brain setup ([guide](../../docs/01-getting-started.md))
- **Enhanced thoughts schema** applied — install `schemas/enhanced-thoughts` first (adds type, importance, sensitivity columns and utility RPCs)
- **Smart ingest tables** applied — install `schemas/smart-ingest-tables` to create the `ingestion_jobs` and `ingestion_items` tables plus the `append_thought_evidence` RPC
- At least one LLM API key for extraction: OpenRouter (recommended), OpenAI, or Anthropic
- An embedding API key: OpenRouter or OpenAI (required for semantic deduplication)
- Supabase CLI installed for deployment

### Required RPCs

This Edge Function depends on these database functions:

| RPC | Source | Purpose |
|-----|--------|---------|
| `upsert_thought(text, jsonb)` | Core OB1 schema (Step 2.6) | Creates or updates a thought with content and payload |
| `match_thoughts(vector, float, int)` | Core OB1 schema | Semantic similarity search for deduplication |
| `append_thought_evidence(bigint, jsonb)` | `schemas/smart-ingest-tables` | Appends corroborating evidence to an existing thought's metadata |

## Credential Tracker

Copy this block into a text editor and fill it in as you go.

```text
SMART INGEST -- CREDENTIAL TRACKER
------------------------------------

FROM YOUR OPEN BRAIN SETUP
  Project URL:           ____________
  Service role key:      ____________
  MCP access key:        ____________

LLM EXTRACTION (at least one required)
  OpenRouter API key:    ____________  (recommended)
  OpenAI API key:        ____________
  Anthropic API key:     ____________

EMBEDDING (at least one required)
  OpenRouter API key:    ____________  (same key as above works)
  OpenAI API key:        ____________

------------------------------------
```

## Steps

### 1. Deploy the Edge Function

Copy the `integrations/smart-ingest/` folder into your Supabase project's `supabase/functions/` directory, then deploy:

```bash
supabase functions deploy smart-ingest --no-verify-jwt
```

### 2. Set Environment Variables

Add your secrets to the deployed function:

```bash
supabase secrets set \
  MCP_ACCESS_KEY="your-access-key" \
  OPENROUTER_API_KEY="your-openrouter-key"
```

Optional multi-provider fallback:

```bash
supabase secrets set \
  OPENAI_API_KEY="your-openai-key" \
  ANTHROPIC_API_KEY="your-anthropic-key"
```

### 3. Test with a Dry Run

Send a test document with `dry_run: true` to preview what would be extracted without writing anything:

```bash
curl -X POST "https://<your-project-ref>.supabase.co/functions/v1/smart-ingest" \
  -H "Content-Type: application/json" \
  -H "x-brain-key: your-access-key" \
  -d '{
    "text": "Met with Sarah about the API redesign. She wants GraphQL instead of REST. We agreed to prototype both by Friday. I also learned that our current REST endpoints handle about 10k requests per minute, which is more than I expected.",
    "source_label": "test-meeting",
    "dry_run": true
  }'
```

You should get a response showing extracted thoughts and their reconciliation actions:

```json
{
  "status": "dry_run_complete",
  "job_id": 1,
  "extracted_count": 3,
  "added_count": 3,
  "skipped_count": 0,
  "message": "Dry run: 3 extracted. Would add 3, skip 0."
}
```

### 4. Execute a Dry-Run Job

Once you're satisfied with the dry-run results, commit them to the database:

```bash
curl -X POST "https://<your-project-ref>.supabase.co/functions/v1/smart-ingest/execute" \
  -H "Content-Type: application/json" \
  -H "x-brain-key: your-access-key" \
  -d '{ "job_id": 1 }'
```

### 5. Verify Results

Check that thoughts were created:

```sql
SELECT id, content, type, importance, source_type
FROM thoughts
WHERE source_type = 'smart_ingest'
ORDER BY created_at DESC
LIMIT 10;
```

Check the ingestion job status:

```sql
SELECT id, status, extracted_count, added_count, skipped_count
FROM ingestion_jobs
ORDER BY created_at DESC
LIMIT 5;
```

## API Reference

### `POST /smart-ingest`

Extract thoughts from raw text with optional dry-run preview.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `text` | string | (required) | Raw text to extract thoughts from |
| `source_label` | string | null | Human-readable label for this ingestion job |
| `source_type` | string | null | Source type tag (e.g., `meeting_notes`, `journal`) |
| `dry_run` | boolean | false | Preview results without writing to the database |
| `reprocess` | boolean | false | Force re-extraction even if identical input was processed before |
| `skip_classification` | boolean | false | Skip LLM metadata classification during execution (faster, less metadata) |
| `source_metadata` | object | null | Ambient provenance data (source_client, capture_mode, session_id, import_key, etc.) |

**Deduplication:** If `source_metadata.import_key` is provided, the function first checks for an existing job with that key. This prevents duplicate ingestion from the same session even if the text content differs slightly.

### `POST /smart-ingest/execute`

Execute a previously dry-run job.

| Parameter | Type | Description |
|-----------|------|-------------|
| `job_id` | number | ID of the dry-run job to execute |
| `skip_classification` | boolean | Override classification behavior for this execution |

## How It Connects to Other Components

The Enhanced MCP Server (`integrations/enhanced-mcp`) exposes `ingest_document` and `execute_ingestion_job` tools that call this Edge Function under the hood. If you only interact with your brain through MCP tools, you may not need to call this function directly — the MCP server handles it for you.

For teams building custom capture pipelines, webhooks, or batch import scripts, this Edge Function provides direct HTTP access to the same ingest pipeline.

For guidance on managing tool count and token overhead as you add more integrations, see the [tool audit guide](../../docs/05-tool-audit.md).

## Expected Outcome

After completing setup, you should be able to:

1. Send raw text to the `/smart-ingest` endpoint and receive extracted thoughts
2. Use dry-run mode to preview extractions before committing
3. Execute dry-run jobs to write thoughts to the database
4. See new thoughts in your brain with `source_type = 'smart_ingest'`
5. Observe deduplication in action — re-sending the same text returns the existing job instead of creating duplicates

## Troubleshooting

**"No LLM API key configured"**
You need at least one of `OPENROUTER_API_KEY`, `OPENAI_API_KEY`, or `ANTHROPIC_API_KEY` set as a Supabase secret. OpenRouter is recommended as the primary provider.

**"Input contains restricted content"**
The function runs a pre-flight sensitivity check and blocks content matching restricted patterns (SSN, credit card, API keys, passwords). This is a safety feature — process sensitive content locally instead.

**"upsert_thought failed" or "match_thoughts RPC failed"**
The smart ingest tables schema has not been applied, or the base OB1 RPCs are missing. Verify that `ingestion_jobs`, `ingestion_items`, and the `upsert_thought`/`match_thoughts` RPCs exist in your database.

**Embedding dimension mismatch**
The function expects `vector(1536)` embeddings (OpenAI text-embedding-3-small). If your database uses a different embedding model or dimension, update the embedding configuration in `_shared/config.ts`.

**Jobs stuck in "extracting" status**
If the LLM call fails mid-extraction, the job is marked as "failed" with an error message. Check the `error_message` column in `ingestion_jobs` for details. You can reprocess by sending the same text with `reprocess: true`.
