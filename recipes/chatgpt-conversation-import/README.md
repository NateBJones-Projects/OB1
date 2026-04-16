# ChatGPT Conversation Import

> Import your ChatGPT history into Open Brain as curated, searchable thoughts — not raw transcripts.

## What It Does

Takes your ChatGPT data export, resolves conversation branches, dispatches across 14 content types (text, voice transcripts, web search results, code execution output, and more), filters out trivial conversations using signal-based scoring, and uses an LLM to extract 2-5 distinct, typed thoughts per conversation. Each thought is classified as one of 6 types — decision, preference, learning, context, brainstorm, or reference — and loaded into your Open Brain with vector embeddings and enriched metadata. The result is semantically searchable knowledge extracted from every meaningful ChatGPT conversation you've ever had.

## Prerequisites

- Working Open Brain setup ([guide](../../docs/01-getting-started.md))
- Your ChatGPT data export (Settings → Data Controls → Export Data in ChatGPT)
- Python 3.10+
- Your Supabase project URL and service role key (from your credential tracker)
- OpenRouter API key (for LLM extraction and embedding generation)

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

This parses, filters, and extracts knowledge from 10 conversations without writing anything to your database. Review the output to see what would be imported and how the LLM distills each conversation into typed thoughts.

### 6. Run the full import

```bash
python import-chatgpt.py path/to/chatgpt-export.zip
```

The script will:
1. Extract conversations from the zip (or directory), including sharded JSON files
2. Resolve conversation branches by walking the `current_node` path
3. Dispatch across 14 content types (extract text, skip model reasoning, strip code blocks)
4. Filter out trivial conversations using signal-based scoring
5. Detect session boundaries within long conversations (4h+ gaps)
6. Extract 2-5 typed thoughts per conversation via LLM knowledge extraction
7. Check for semantic duplicates against existing thoughts (0.92 similarity threshold)
8. Generate a vector embedding for each thought (from the thought content, not the prefix)
9. Insert each thought into your `thoughts` table with enriched metadata

Progress prints to the console with ETA as it runs. A sync log (`chatgpt-sync-log.json`) tracks which conversations have been imported, so you can safely re-run the script after future exports without duplicating data. Conversations with new messages since the last import are automatically re-processed.

On Windows, the importer reads export JSON files as UTF-8 explicitly, so conversations containing non-ASCII characters won't depend on your system code page. The sync log is written next to [`import-chatgpt.py`](./import-chatgpt.py), not into whatever directory you launched the command from.

### 7. Verify in your database

Open your Supabase dashboard → Table Editor → `thoughts`. You should see new rows with:
- `content`: prefixed with `[ChatGPT: title | date]`, followed by a self-contained thought statement
- `metadata`: includes `source: "chatgpt"`, thought `type`, `topics`, `people`, `confidence`, model, conversation URL, and more
- `embedding`: a 1536-dimension vector (generated from the thought content, not the prefix)

### 8. Test a search

In any MCP-connected AI (Claude Desktop, ChatGPT, etc.), ask:

```
Search my brain for topics I discussed with ChatGPT about [something you know you talked about]
```

## Expected Outcome

After a full import, your `thoughts` table contains distilled knowledge from every non-trivial ChatGPT conversation. Each thought is a standalone statement with type, topics, people, and confidence — not a raw transcript — that makes sense without the original conversation context.

Results depend on export size, filtering, and model. Example from a real 2,300-conversation export:

| Metric | gpt-4o-mini (default) | gpt-4o | With --focus |
|--------|----------------------|--------|-------------|
| Conversations scanned | 2,341 | 2,341 | 2,341 |
| Filtered (single-turn, short) | ~1,000 (43%) | ~1,000 (43%) | ~1,000 (43%) |
| Sent to LLM | ~1,300 | ~1,300 | ~300 |
| Thoughts generated | ~800-1,500 | ~800-1,500 | ~250-400 |
| Estimated API cost | ~$1.30 | ~$20 | ~$0.50-10 |

Using `--focus` reduces LLM calls significantly — conversations outside your focus areas return empty thoughts. Use `--model ollama` for $0.

Each thought includes structured metadata:

```json
{
  "content": "[ChatGPT: Database Migration Strategy | 2025-09-15] Chose PostgreSQL over DynamoDB for the new order service. Key factors: complex joins for reporting, strong consistency requirements, existing team expertise. DynamoDB considered for write throughput but rejected due to access pattern limitations.",
  "metadata": {
    "source": "chatgpt",
    "type": "decision",
    "topics": ["database", "architecture"],
    "people": [],
    "confidence": "firm",
    "chatgpt_model": "gpt-4o",
    "chatgpt_message_count": 34,
    "chatgpt_conversation_type": "technical_architecture",
    "chatgpt_conversation_url": "https://chatgpt.com/c/abc-123"
  }
}
```

## Thought Types

The LLM classifies each extracted thought into one of 6 types:

| Type | What it captures | Example |
|------|-----------------|---------|
| `decision` | A choice made with reasoning | "Chose PostgreSQL over DynamoDB for the order service. Needed complex joins for reporting." |
| `preference` | Values, criteria, tastes revealed | "For baby gear: prioritize stability on hardwood, easy cleaning, grows-with-child over brand." |
| `learning` | Facts, patterns, insights discovered | "Tungsten in X-ray machines: high atomic number produces X-rays efficiently when electrified." |
| `context` | People, projects, situations | "Platform team owns the API gateway and auth service. Infrastructure team handles deployments and monitoring." |
| `brainstorm` | Ideas explored, strategies considered | "For externalizing an internal product: start with design partner program, not public launch." |
| `reference` | How-tos, recipes, reusable procedures | "Carbon steel pan seasoning: scrub with steel wool, dry on stove, apply thin flaxseed oil layer." |

Each thought also carries a `confidence` level: `firm` (clear conclusion), `tentative` (leaning toward), or `exploring` (still open).

## How It Works

### Three-stage pipeline

**Stage 1: Parsing and Filtering** — Each conversation is parsed and scored before it reaches the LLM:

- **Branch resolution**: Walks from `current_node` to root via parent pointers, producing the canonical conversation path (no interleaved regenerations from abandoned branches)
- **Content type dispatch**: 14 content types are handled in three buckets — extract text from (text, multimodal_text, execution_output, web search, code), skip entirely (model reasoning/thoughts, reasoning_recap, system errors), and metadata only (tether_quote, custom instructions)
- **Voice conversations**: Audio transcriptions are extracted from `multimodal_text` parts. Voice conversations are more substantive on average and are never auto-filtered
- **Signal-based filtering**: Replaces regex title matching. Single-turn conversations are skipped. Conversations with 10+ messages are always processed. Borderline conversations (2-9 messages) are checked for word count and title presence, then the LLM decides

**Stage 2: Knowledge Extraction** — Surviving conversations go to an LLM (gpt-4o-mini by default via OpenRouter) with a structured extraction prompt. The LLM returns 0-5 typed thoughts per conversation as JSON, each with content, type, topics, people, and confidence. For multi-day conversations, session boundaries are detected at 4h+ gaps and each session is extracted separately.

The LLM is instructed to:
- Extract decisions with reasoning, including what was rejected and why
- Capture preferences, criteria, and values
- Record architectural and strategic choices (not code)
- Preserve personal context that looks ephemeral but encodes life situation
- Return empty for conversations that are just generic Q&A, creative tasks, or ephemeral lookups

**Stage 3: Ingestion** — Each thought gets a vector embedding (text-embedding-3-small, 1536 dimensions) generated from the thought content itself (not the `[ChatGPT: title]` prefix). Before insertion, semantic deduplication checks for near-duplicates using `match_thoughts` RPC at a 0.92 similarity threshold. Each thought is inserted into your `thoughts` table with enriched metadata including model, conversation type, voice, and confidence.

### Deduplication

Two layers of deduplication prevent redundant thoughts:

1. **Sync log** (`chatgpt-sync-log.json`): Tracks each processed conversation by hash and `update_time`. Re-running the script after a new export only processes new conversations or conversations with new messages since the last import.
2. **Semantic dedup**: Before inserting, each thought is checked against existing thoughts via `match_thoughts` at 0.92 similarity. This catches redundant thoughts when the same topic was discussed across multiple conversations.

## `--store-conversations`

The `--store-conversations` flag enables an optional conversation history table that stores conversation-level metadata and pyramid summaries alongside the extracted thoughts.

### What it does

When enabled, each processed conversation is also stored in a `chatgpt_conversations` table with:
- **Pyramid summaries** at 5 detail levels (8-word label, 16-word sentence, 32-word card, 64-word paragraph, 128-word full summary)
- **HNSW-indexed embedding** of the 128-word summary for conversation-level semantic search
- **Searchable arrays** for key topics and people mentioned
- **Export metadata** including model, voice, custom GPT identifier, and conversation URL

### What it enables

- **Temporal browsing**: "What was I working on in October?" via `create_time` queries
- **Source attribution**: Search thoughts, find a decision, follow `chatgpt_conversation_id` back to the full conversation summary and ChatGPT URL
- **Progressive disclosure**: Use the 8-word summary for timelines, 32-word for dashboard cards, 128-word for full context
- **Smarter re-imports**: Content hash detects conversations with changed content

### How to set it up

1. Open the Supabase SQL Editor in your project dashboard
2. Paste and run the contents of `schema.sql` from this recipe folder
3. Pass `--store-conversations` when running the import:

```bash
python import-chatgpt.py path/to/export.zip --store-conversations
```

The pyramid summaries are generated in the same LLM call as the thought extraction, adding only ~200 extra output tokens per conversation (~$0.05 total for 1,400 conversations).

## Options Reference

| Flag | Description | Default |
|------|-------------|---------|
| `--dry-run` | Parse, filter, extract — but don't write to database | Off |
| `--after YYYY-MM-DD` | Only process conversations created after this date | None |
| `--before YYYY-MM-DD` | Only process conversations created before this date | None |
| `--limit N` | Max conversations to process (0 = unlimited) | 0 |
| `--min-messages N` | Minimum messages for a conversation to be processed | 2 |
| `--min-words N` | Minimum word count for borderline conversations | 50 |
| `--focus TOPICS` | Focus extraction on specific topics (preset or custom text — see below) | All topics |
| `--store-conversations` | Also store conversation summaries with pyramid detail levels (requires `schema.sql`) | Off |
| `--model openrouter` | LLM backend for extraction: `openrouter` or `ollama` | `openrouter` |
| `--openrouter-model ID` | Which OpenRouter model to use | `openai/gpt-4o-mini` |
| `--ollama-model NAME` | Which Ollama model to use (requires `--model ollama`) | `qwen3` |
| `--raw` | Skip LLM extraction, ingest user messages as-is | Off |
| `--verbose` | Print full thought text during processing | Off |
| `--report FILE` | Write a markdown report of everything imported | None |
| `--ingest-endpoint` | Use custom `INGEST_URL`/`INGEST_KEY` instead of Supabase direct insert | Off |

### `--focus` — Topic Filtering

By default, the script extracts knowledge from all conversations. Use `--focus` to narrow extraction to specific domains, saving API cost and reducing noise from conversations you don't care about.

**Presets** (one word, easy to remember):

| Preset | Extracts | Skips |
|--------|----------|-------|
| `tech` | Architecture, engineering, system design, code patterns, infrastructure | Shopping, recipes, health, creative tasks |
| `strategy` | Business strategy, product decisions, career, leadership, hiring | Shopping, recipes, technical details, creative |
| `personal` | Family, health, relationships, values, home, personal finance | Work topics, technical details, shopping |
| `creative` | Writing, design, art, content strategy, storytelling | Technical, business, shopping, health |
| `all` | Everything (default behavior) | Only ephemeral lookups |

**Examples with presets:**

```bash
# Only tech and engineering knowledge
python import-chatgpt.py export.zip --focus tech

# Only business and career decisions
python import-chatgpt.py export.zip --focus strategy

# Combine with date filter for recent tech decisions
python import-chatgpt.py export.zip --focus tech --after 2025-01-01
```

**Custom focus** (any free-text description):

```bash
# Specific domains
python import-chatgpt.py export.zip --focus "AI/ML, prompt engineering, LLM architecture"

# Multiple interests
python import-chatgpt.py export.zip --focus "parenting, nutrition, home renovation"

# Very specific
python import-chatgpt.py export.zip --focus "AWS infrastructure, Kubernetes, CI/CD pipelines"
```

When `--focus` is set, conversations outside your focus areas will return `{"thoughts": [], "skip_reason": "off-topic"}` — you still pay for the LLM call, but no thoughts are created. Combine with `--min-messages` to skip short conversations before they reach the LLM.

### Using a local LLM (free, private)

If you don't want to send your conversations to OpenRouter, use Ollama for local extraction:

```bash
# Install Ollama and pull a model
ollama pull qwen3

# Run with local LLM
python import-chatgpt.py export.zip --model ollama --ollama-model qwen3
```

Note: embeddings still use OpenRouter (text-embedding-3-small) for Supabase direct insert mode. Only the extraction step runs locally.

## Cost Estimates

All costs are via OpenRouter at current pricing. The v2 pipeline sends full dialogue (user + assistant messages) to the LLM and requests structured JSON extraction, which uses more input tokens but captures significantly more knowledge.

| Component | Model | Cost |
|-----------|-------|------|
| Knowledge extraction | gpt-4o-mini | ~$0.15/1M input + $0.60/1M output |
| Embeddings | text-embedding-3-small | ~$0.02/1M tokens |

**Typical costs by export size (~$0.001/conversation):**

| Export size | Processed | Thoughts | Est. cost |
|-------------|-----------|----------|-----------|
| 100 conversations | ~60 | ~180 | ~$0.06 |
| 500 conversations | ~300 | ~900 | ~$0.30 |
| 1000 conversations | ~600 | ~1,800 | ~$0.60 |
| 5000 conversations | ~3,000 | ~9,000 | ~$3.00 |

These assume ~40% of conversations are filtered as trivial and ~3 thoughts per conversation. Add `--store-conversations` for ~$0.00004 extra per conversation (pyramid summaries in the same LLM call). Use `--model ollama` for $0 extraction cost (embeddings still use OpenRouter).

## Troubleshooting

**Issue: `conversations.json` not found in the export**
Solution: ChatGPT exports come as a zip file. Make sure you've either (a) pointed the script at the zip file directly (`python import-chatgpt.py export.zip`), or (b) unzipped it and pointed at the directory. The script handles both formats automatically, including the multi-file format (`conversations-000.json`, `conversations-001.json`, etc.) used in large exports.

**Issue: `OPENROUTER_API_KEY required` error**
Solution: Make sure you've exported the environment variable in your current terminal session: `export OPENROUTER_API_KEY=sk-or-v1-...`. Environment variables don't persist between terminal windows.

**Issue: Import is very slow**
Solution: Each conversation requires one LLM call (knowledge extraction) and 1-3 embedding calls (one per thought) plus a dedup check per thought. For 500+ conversations, expect 15-30 minutes. Use `--limit 10` to test first, then run the full import. Progress prints to the console with ETA so you can track it.

**Issue: Getting empty thoughts for most conversations**
Solution: This is expected for many conversations — the LLM only extracts knowledge worth retrieving months from now. If too many conversations are returning empty, try lowering `--min-messages` (default 5) to allow shorter conversations through, or lowering `--min-words` (default 50) to relax the word count threshold. Use `--raw` if you want to import everything without LLM extraction.

**Issue: JSON parse errors from LLM**
Solution: This is normal occasionally — the LLM sometimes returns malformed JSON despite being asked for structured output. The script falls back to empty extraction for that conversation and continues. If it happens frequently with Ollama, try a different model (`--ollama-model llama3.1`).

**Issue: Some conversations are missing after import**
Solution: Conversations with fewer than 2 messages (single-turn) are always filtered. Untitled conversations with 5 or fewer messages are also filtered. Conversations with 10+ messages are always processed regardless of content. Run with `--dry-run --verbose` to see what's being filtered and why.

**Issue: Want to re-import after a new ChatGPT export**
Solution: Just run the script again pointing at your new export. The sync log (`chatgpt-sync-log.json`) next to `import-chatgpt.py` tracks which conversations have been processed and their `update_time`. Only new conversations and conversations with new messages will be re-processed. If you want to start fresh, delete that file.

**Issue: `Failed to generate embedding` errors**
Solution: Check that your OpenRouter API key is valid and has credits. Go to openrouter.ai/credits to verify your balance. The embedding model (text-embedding-3-small) costs $0.02 per million tokens — even a large import costs pennies.

**Issue: How to use `--store-conversations`**
Solution: You need to create the `chatgpt_conversations` table first. Open the Supabase SQL Editor, paste the contents of `schema.sql` from this recipe folder, and run it. Then pass `--store-conversations` on your next import run. The table stores conversation-level summaries and metadata — it is optional and the core thought import works without it.
