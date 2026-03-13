# ChatGPT Conversation Import

> Import your ChatGPT history into Open Brain as curated, searchable thoughts — not raw transcripts.

## What It Does

Takes your ChatGPT data export, filters out trivial conversations (poems, one-liners, image requests), uses an LLM to distill each remaining conversation into 1-3 standalone thoughts, and loads them into your Open Brain with vector embeddings and metadata. The result is semantically searchable knowledge extracted from every meaningful ChatGPT conversation you've ever had.

## Prerequisites

- Working Open Brain setup ([guide](../../docs/01-getting-started.md))
- Your ChatGPT data export (Settings → Data Controls → Export Data in ChatGPT)
- Python 3.10+
- Your Supabase project URL and service role key (from your credential tracker)
- OpenRouter API key (for LLM summarization and embedding generation)

## Credential Tracker

Copy this block into a text editor and fill it in as you go.

```text
CHATGPT CONVERSATION IMPORT -- CREDENTIAL TRACKER
--------------------------------------

FROM YOUR OPEN BRAIN SETUP
  Supabase Project URL:  ____________
  Supabase Secret key:   ____________
  OpenRouter API key:    ____________

FILE LOCATION
  Path to ChatGPT export:  ____________

--------------------------------------
```

## Steps

### 1. Export your data from ChatGPT

Go to ChatGPT → Settings → Data Controls → Export Data. You'll receive an email with a download link within a few minutes. Download the zip file.

### 2. Clone this recipe folder

```bash
# From the OB1 repo root
cd recipes/chatgpt-conversation-import
```

Or copy the files (`import-chatgpt.py`, `requirements.txt`) into any working directory.

### 3. Install dependencies

```bash
pip install -r requirements.txt
```

This installs `requests` — the only external dependency.

### 4. Set your environment variables

```bash
export SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
export SUPABASE_SERVICE_ROLE_KEY=your-service-role-key-here
export OPENROUTER_API_KEY=sk-or-v1-your-key-here
```

All three values come from your credential tracker. You can also copy `.env.example` to `.env` and fill it in, then run `export $(cat .env | xargs)`.

### 5. Do a dry run first

```bash
python import-chatgpt.py path/to/chatgpt-export.zip --dry-run --limit 10
```

This parses, filters, and summarizes 10 conversations without writing anything to your database. Review the output to see what would be imported and how the LLM distills each conversation.

### 6. Run the full import

```bash
python import-chatgpt.py path/to/chatgpt-export.zip
```

The script will:
1. Extract conversations from the zip (or directory)
2. Filter out trivial conversations (see How It Works below)
3. Summarize each remaining conversation into 1-3 standalone thoughts via LLM
4. Generate a vector embedding for each thought
5. Insert each thought into your `thoughts` table in Supabase

Progress prints to the console as it runs. A sync log (`chatgpt-sync-log.json`) tracks which conversations have been imported, so you can safely re-run the script after future exports without duplicating data.

### 7. Verify in your database

Open your Supabase dashboard → Table Editor → `thoughts`. You should see new rows with:
- `content`: prefixed with `[ChatGPT: title | date]`
- `metadata`: includes `source: "chatgpt"`, conversation title, date, and URL
- `embedding`: a 1536-dimension vector

### 8. Test a search

In any MCP-connected AI (Claude Desktop, ChatGPT, etc.), ask:

```
Search my brain for topics I discussed with ChatGPT about [something you know you talked about]
```

## Expected Outcome

After a full import, your `thoughts` table contains distilled knowledge from every non-trivial ChatGPT conversation. Each thought is a standalone statement (not a raw transcript) that makes sense without the original conversation context.

From a real production run with ~2 years of ChatGPT history:

| Metric | Value |
|--------|-------|
| Conversations scanned | 741 |
| Filtered as trivial | 437 (59%) |
| Processed | 304 |
| Thoughts generated | 589 |
| Estimated API cost | $0.08 |

The filtering is aggressive by design — most ChatGPT conversations are throwaway Q&A. The script keeps only conversations with enough substance to produce lasting knowledge.

## How It Works

### Three-stage pipeline

**Stage 1: Filtering** — Each conversation passes through 6 filters before it reaches the LLM:

| Filter | What it catches |
|--------|----------------|
| Already imported | Conversations processed in a previous run (sync log) |
| Too few messages | < 4 messages total (not enough substance) |
| Too little text | < 20 words of user text |
| Title patterns | Poems, jokes, image generation, translations, bedtime stories |
| Do-not-remember | Conversations you marked as "don't remember" in ChatGPT |
| Date range | Outside your `--after` / `--before` window |

**Stage 2: Summarization** — Surviving conversations go to an LLM (gpt-4o-mini by default via OpenRouter) with a carefully tuned prompt. The LLM extracts 1-3 standalone thoughts per conversation, focusing on:
- Decisions and reasoning
- People and relationships
- Strategies and architectural choices
- Lessons learned and preferences

The LLM is instructed to return empty for conversations that are just generic Q&A, coding help without decisions, or creative tasks.

**Stage 3: Ingestion** — Each thought gets a vector embedding (text-embedding-3-small, 1536 dimensions) and is inserted into your `thoughts` table with metadata linking back to the original ChatGPT conversation.

### Deduplication

The sync log (`chatgpt-sync-log.json`) stores a hash of each processed conversation. Re-running the script after a new ChatGPT export only processes new conversations. The hash is based on conversation title + creation timestamp.

## Options Reference

| Flag | Description | Default |
|------|-------------|---------|
| `--dry-run` | Parse, filter, summarize — but don't write to database | Off |
| `--after YYYY-MM-DD` | Only process conversations created after this date | None |
| `--before YYYY-MM-DD` | Only process conversations created before this date | None |
| `--limit N` | Max conversations to process (0 = unlimited) | 0 |
| `--model openrouter` | LLM backend for summarization: `openrouter` or `ollama` | `openrouter` |
| `--ollama-model NAME` | Which Ollama model to use (requires `--model ollama`) | `qwen3` |
| `--raw` | Skip LLM summarization, ingest user messages as-is | Off |
| `--verbose` | Print full thought text during processing | Off |
| `--report FILE` | Write a markdown report of everything imported | None |
| `--ingest-endpoint` | Use custom `INGEST_URL`/`INGEST_KEY` instead of Supabase direct insert | Off |

### Using a local LLM (free, private)

If you don't want to send your conversations to OpenRouter, use Ollama for local summarization:

```bash
# Install Ollama and pull a model
ollama pull qwen3

# Run with local LLM
python import-chatgpt.py export.zip --model ollama --ollama-model qwen3
```

Note: embeddings still use OpenRouter (text-embedding-3-small) for Supabase direct insert mode. Only the summarization step runs locally.

## Cost Estimates

All costs are via OpenRouter at current pricing.

| Component | Model | Cost |
|-----------|-------|------|
| Summarization | gpt-4o-mini | ~$0.15/1M input + $0.60/1M output |
| Embeddings | text-embedding-3-small | ~$0.02/1M tokens |

**Typical costs by export size:**

| Export size | Processed | Thoughts | Est. cost |
|-------------|-----------|----------|-----------|
| 100 conversations | ~40 | ~80 | ~$0.01 |
| 500 conversations | ~200 | ~400 | ~$0.05 |
| 1000 conversations | ~400 | ~800 | ~$0.10 |
| 5000 conversations | ~2000 | ~4000 | ~$0.50 |

These assume ~60% of conversations are filtered as trivial and ~2 thoughts per conversation.

## Troubleshooting

**Issue: `conversations.json` not found in the export**
Solution: ChatGPT exports come as a zip file. Make sure you've either (a) pointed the script at the zip file directly (`python import-chatgpt.py export.zip`), or (b) unzipped it and pointed at the directory. The script handles both formats automatically, including the multi-file format (`conversations-000.json`, `conversations-001.json`, etc.) used in large exports.

**Issue: `OPENROUTER_API_KEY required` error**
Solution: Make sure you've exported the environment variable in your current terminal session: `export OPENROUTER_API_KEY=sk-or-v1-...`. Environment variables don't persist between terminal windows.

**Issue: Import is very slow**
Solution: Each conversation requires one LLM call (summarization) and 1-3 embedding calls (one per thought). For 500+ conversations, expect 15-30 minutes. Use `--limit 10` to test first, then run the full import. Progress prints to the console so you can see it working.

**Issue: Most conversations return "No thoughts extracted"**
Solution: This is expected behavior. The LLM is deliberately selective — it only extracts knowledge worth retrieving months from now. Generic Q&A, coding help, and creative tasks get empty summaries. Use `--raw` if you want to import everything without filtering.

**Issue: Some conversations are missing after import**
Solution: Conversations with fewer than 4 messages or fewer than 20 words of user text are filtered automatically. Title patterns like "poem", "joke", "image of" are also filtered. Run with `--dry-run --verbose` to see what's being filtered and why.

**Issue: Want to re-import after a new ChatGPT export**
Solution: Just run the script again pointing at your new export. The sync log (`chatgpt-sync-log.json`) tracks which conversations have been processed. Only new conversations will be imported. If you want to start fresh, delete `chatgpt-sync-log.json`.

**Issue: `Failed to generate embedding` errors**
Solution: Check that your OpenRouter API key is valid and has credits. Go to openrouter.ai/credits to verify your balance. The embedding model (text-embedding-3-small) costs $0.02 per million tokens — even a large import costs pennies.
