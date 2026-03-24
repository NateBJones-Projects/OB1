# Perplexity Conversation Import

<div align="center">

![Community Contribution](https://img.shields.io/badge/OB1_COMMUNITY-Approved_Contribution-2ea44f?style=for-the-badge&logo=github)

**Created by [@demarant](https://github.com/demarant)**

*Reviewed and merged by the Open Brain maintainer team — thank you for building the future of AI memory!*

</div>

Import your Perplexity AI search history and memory entries into Open Brain as searchable thoughts.

## What It Does

Takes a Perplexity data export (.xlsx), processes two data streams:

- **Conversations** — Each search query + answer is summarized by an LLM into 1-3 standalone thoughts, then loaded into your `thoughts` table with embeddings and metadata.
- **Memory** — Perplexity's curated memory entries are ingested directly (already concise summaries). JSON profile rows are flattened into per-section thoughts (demographics, interests, technology, etc.).

Deduplication via a sync log ensures safe re-runs without duplicates.

## Prerequisites

- Working Open Brain setup ([getting started guide](../../docs/01-getting-started.md))
- Perplexity data export (`.xlsx` file)
- Python 3.10+
- OpenRouter API key (for embeddings + conversation summarization)

## Step-by-Step

### 1. Request Your Perplexity Data Export

Perplexity does not currently offer a self-service data export via the UI. You must request your data directly from their privacy team:

1. **Submit a data request** at [perplexity.typeform.com/datarequest](https://perplexity.typeform.com/datarequest) (recommended — fastest)
2. **Or email** [privacy@perplexity.ai](mailto:privacy@perplexity.ai) with a subject like "GDPR Data Export Request"

You'll receive your data via email (typically within a few days). The export is an `.xlsx` file. Save it somewhere accessible.

> [!TIP]
> Under GDPR (Article 15/20) you have the right to request a copy of your personal data (including inferred memories about you). Mention this if you want to speed things up.

### 2. Clone This Recipe

Copy the `perplexity-conversation-import` folder to your working directory.

### 3. Install Dependencies

```bash
pip install -r requirements.txt
```

### 4. Set Environment Variables

Get your Supabase Secret Key from the dashboard: **Settings → API → Secret key** (click reveal). It starts with `sb_secret_`. This is the key formerly known as "service_role key."

```bash
export SUPABASE_URL="https://your-project.supabase.co"
export SUPABASE_SERVICE_ROLE_KEY="sb_secret_..."  # Your Secret Key
export OPENROUTER_API_KEY="sk-or-v1-your-key"
```

Or copy `.env.example` to `.env` and fill in the values, then:

```bash
source .env
```

### 5. Dry Run

Preview what will be imported without touching your database:

```bash
python import-perplexity.py path/to/export.xlsx --dry-run --limit 5
```

You should see each conversation and memory entry listed with extracted thoughts.

### 6. Run the Full Import

```bash
python import-perplexity.py path/to/export.xlsx
```

Or import only conversations or only memory:

```bash
python import-perplexity.py path/to/export.xlsx --type conversations
python import-perplexity.py path/to/export.xlsx --type memory
```

### 7. Verify in Supabase

Check your Supabase dashboard → Table Editor → `thoughts` table. You should see new rows with:
- `content` starting with `[Perplexity:` or `[Perplexity Memory:`
- `created_at` matching the original Perplexity date (not today's date)
- `metadata.source` set to `perplexity` or `perplexity_memory`
- `embedding` vectors populated

### 8. Test Search

In any MCP-connected AI, search for something from your Perplexity history:

```
Search my brain for "Malmö pubs"
```

## Expected Outcome

Stats table at the end of the run:

```
Summary:
  Conversations:
    Found:              150
    Processed:          142
    Thoughts:           280
    Ingested:           278
    Errors:             2

  Memory:
    Found:              45
    Processed:          43
    Thoughts:           55
    Ingested:           55
    Errors:             0

  Est. API cost:          $0.0045
```

## How It Works

### Three-Stage Pipeline

**Stage 1: Parse & Filter**
- Reads the `.xlsx` file using openpyxl (no CSV conversion needed)
- Skips conversations with no answer text
- Skips memory entries marked as deleted or forgotten
- Deduplicates against `perplexity-sync-log.json` (safe to re-run)
- Optional date range filtering (`--after`, `--before`)

**Stage 2: Summarize (conversations only)**
- Sends each query + answer to an LLM (gpt-4o-mini via OpenRouter by default)
- Prompt is tuned for Perplexity's Q&A format — focuses on decisions, lessons, and lasting context
- Extracts 1-3 standalone thoughts per conversation
- Memory entries skip this stage — they're already concise summaries from Perplexity

**Stage 3: Ingest**
- Generates a 1536-dim embedding per thought (text-embedding-3-small via OpenRouter)
- Inserts into the `thoughts` table via Supabase REST API
- Attaches metadata: source, title/date/UUID (conversations), memory key/confidence (memory)
- Preserves original timestamps — the `created_at` column is set to the Perplexity export's `CREATED` or `FIRST_CREATED_AT`, not "now"

### Timestamp Preservation

Imported thoughts retain their original dates from Perplexity, not the import date. This means a search from December 2023 will appear in your timeline as December 2023, not today.

| Source | Column used | Perplexity export column |
|--------|------------|------------------------|
| Conversations | `created_at` | `CREATED` |
| Memory | `created_at` | `FIRST_CREATED_AT` |

The `updated_at` column defaults to `now()` on insert (overwritten by Supabase trigger on any subsequent update), but `created_at` reflects the original date.

### JSON Profile Rows

Some memory exports contain a special row where `MEMORY_KEY` is empty and `MEMORY_VALUE` holds a JSON object with the user's persona (demographics, interests, technology preferences, etc.).

These are automatically detected and flattened into separate thoughts:

| Profile Section | Thought Prefix |
|----------------|---------------|
| Summary | `[Perplexity Memory: Profile — Summary]` |
| Demographics | `[Perplexity Memory: Profile — Demographics]` |
| Interests | `[Perplexity Memory: Profile — Interests]` |
| Technology | `[Perplexity Memory: Profile — Technology]` |
| Knowledge | `[Perplexity Memory: Profile — Knowledge]` |
| Lifestyle | `[Perplexity Memory: Profile — Lifestyle]` |
| Work and Education | `[Perplexity Memory: Profile — Work And Education]` |
| Personal Traits | `[Perplexity Memory: Profile — Personal Traits]` |

### Deduplication

- **Conversations**: SHA256 hash of the UUID
- **Memory**: SHA256 hash of `MEMORY_KEY | FIRST_CREATED_AT`
- **JSON profiles**: SHA256 hash of the first 200 chars of `MEMORY_VALUE`
- Stored in `perplexity-sync-log.json` (gitignored)

## Options Reference

| Flag | Default | Description |
|------|---------|-------------|
| `--dry-run` | `false` | Preview mode — parse, filter, summarize, but don't ingest |
| `--after YYYY-MM-DD` | — | Only import conversations created after this date |
| `--before YYYY-MM-DD` | — | Only import conversations created before this date |
| `--limit N` | `0` (unlimited) | Max items to process per type |
| `--type` | `both` | `conversations`, `memory`, or `both` |
| `--model` | `openrouter` | LLM backend: `openrouter` or `ollama` |
| `--ollama-model` | `qwen3` | Ollama model name (when using `--model ollama`) |
| `--verbose` | `false` | Show full thought content during processing |
| `--report FILE` | — | Write a markdown report of everything imported |

## Local LLM Option

Use Ollama for free, private summarization (embeddings still require OpenRouter):

```bash
python import-perplexity.py export.xlsx --model ollama --ollama-model qwen3
```

## Cost Estimates

| Component | Cost per item | Notes |
|-----------|--------------|-------|
| Summarization | ~$0.0003 | gpt-4o-mini via OpenRouter, conversations only |
| Embeddings | ~$0.000002 | text-embedding-3-small, all thoughts |

For a typical export with 100 conversations and 50 memory entries, total cost is under $0.04.

## Troubleshooting

**"No module named 'openpyxl'"**
```bash
pip install openpyxl>=3.1
```

**"No 'Conversations' sheet found"**
Your export may use different sheet names. Open the file in a spreadsheet app and check the sheet tabs. The script looks for exact names "Conversations" and "Memory".

**"OPENROUTER_API_KEY environment variable required"**
```bash
export OPENROUTER_API_KEY="sk-or-v1-your-key"
```
Or use `--model ollama` for local summarization (embeddings still need OpenRouter).

**Summarization returns empty thoughts**
Some Q&A pairs are too simple (e.g., "what time is it?"). This is expected — the LLM is designed to be selective. Try `--verbose` to see what's being skipped.

**"Failed to generate embedding"**
Check your OpenRouter API key has credits and access to `text-embedding-3-small`. Test with:
```bash
curl https://openrouter.ai/api/v1/embeddings \
  -H "Authorization: Bearer $OPENROUTER_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model":"openai/text-embedding-3-small","input":"test"}'
```

**Re-running imports**
The sync log (`perplexity-sync-log.json`) prevents duplicates. Delete it to re-import everything, or edit it to remove specific entries.

**Large exports**
If you have hundreds of conversations, the run may take a while due to rate limiting (0.2s between ingests). This is intentional — Supabase REST has rate limits. Grab a coffee.
