# Google Activity Import

> Import your Google Search, Gmail, Maps, YouTube, and Chrome history from Google Takeout into Open Brain as searchable thoughts.

## What It Does

Takes your Google Takeout data export, filters out noise (passive visits, trivial lookups, notifications), groups activity by day, uses an LLM to distill each day into 1-3 standalone thoughts, and loads them into your Open Brain with vector embeddings and metadata. The result is semantically searchable knowledge extracted from years of Google activity — your research patterns, decisions, habits, and interests.

## Prerequisites

- Working Open Brain setup ([guide](../../docs/01-getting-started.md))
- Your Google Takeout data export (see Step 1 below)
- Node.js 18+
- Your Supabase project URL and service role key (from your credential tracker)
- OpenRouter API key (for LLM summarization and embedding generation)

## Credential Tracker

Copy this block into a text editor and fill it in as you go.

```text
GOOGLE ACTIVITY IMPORT -- CREDENTIAL TRACKER
--------------------------------------

FROM YOUR OPEN BRAIN SETUP
  Supabase Project URL:  ____________
  Supabase Secret key:   ____________
  OpenRouter API key:    ____________

FILE LOCATION
  Path to Takeout folder:  ____________

--------------------------------------
```

## Steps

### 1. Request your data from Google Takeout

Go to [takeout.google.com](https://takeout.google.com):

1. Click **Deselect all** (top of the page)
2. Scroll down and check **My Activity**
3. Click **Multiple formats** and make sure it says **JSON** (not HTML)
4. Click **Next step** → **Create export**
5. Wait for the email (can take minutes to hours depending on size)
6. Download and extract the zip file

After extraction, you should have a folder structure like:

```
Takeout/
  My Activity/
    Search/
      MyActivity.json
    Gmail/
      MyActivity.json
    Maps/
      MyActivity.json
    YouTube/
      MyActivity.json
    Chrome/
      MyActivity.json
    ...
```

### 2. Navigate to this recipe folder

```bash
# From the OB1 repo root
cd recipes/google-activity-import
```

Or copy the files (`import-google-activity.mjs`, `package.json`) into any working directory.

### 3. Set your environment variables

```bash
export SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
export SUPABASE_SERVICE_ROLE_KEY=your-service-role-key-here
export OPENROUTER_API_KEY=sk-or-v1-your-key-here
```

All three values come from your credential tracker. You can also copy `.env.example` to `.env` and fill it in, then run `export $(cat .env | xargs)`.

### 4. Do a dry run first

```bash
node import-google-activity.mjs ./path/to/Takeout/My\ Activity --dry-run --limit 5
```

This parses, filters, and summarizes 5 activity-days without writing anything to your database. Review the output to see what would be imported.

### 5. Run the full import

```bash
node import-google-activity.mjs ./path/to/Takeout/My\ Activity
```

The script will:
1. Find all `MyActivity.json` files in the folder tree
2. Filter to high-value categories (Search, Gmail, Maps, YouTube, Chrome)
3. Remove noise entries (passive visits, notifications, trivial lookups)
4. Group remaining entries by day
5. Summarize each day's activity into 1-3 standalone thoughts via LLM
6. Generate a vector embedding for each thought
7. Insert each thought into your `thoughts` table

Progress prints to the console. A sync log (`google-activity-sync-log.json`) tracks which days have been imported, so you can safely re-run the script after future Takeout exports without duplicating data.

### 6. Verify in your database

Open your Supabase dashboard → Table Editor → `thoughts`. You should see new rows with:
- `content`: prefixed with `[Google Search: 2024-06-15]` (or Gmail, Maps, etc.)
- `metadata`: includes `source: "google_activity"`, category, date, entry count
- `embedding`: a 1536-dimension vector

### 7. Test a search

In any MCP-connected AI (Claude Desktop, ChatGPT, etc.), ask:

```
Search my brain for things I researched about [topic you know you searched for]
```

## Expected Outcome

After a full import, your `thoughts` table contains distilled knowledge from years of Google activity. Each thought is a standalone statement about your research patterns, decisions, or interests — not a raw list of searches.

From a real production run with ~4 years of Google history:

| Metric | Value |
|--------|-------|
| Total activity entries | 98,000+ |
| After noise filtering | 42,000 |
| Activity-days | 11,000+ |
| Thoughts generated | ~8,000 |
| Estimated API cost | ~$0.30 |

The filtering is aggressive by design — most Google activity is noise. The script keeps only entries with enough substance to reveal patterns worth remembering.

## How It Works

### Three-stage pipeline

**Stage 1: Noise filtering** — Each activity entry passes through category-specific filters:

| Category | Kept | Filtered |
|----------|------|----------|
| Search | All searches ≥10 chars | Notification counts |
| Gmail | Email subjects ≥10 chars | Notification counts |
| Maps | Searches, directions, navigation | Passive visits, views, opens |
| YouTube | Searches, substantive watching | Short clips, passive visits |
| Chrome | Page titles ≥15 chars | Very short titles |

**Stage 2: Day grouping & summarization** — Surviving entries are grouped by date. Each day goes to an LLM (gpt-4o-mini via OpenRouter) with a tuned prompt. The LLM extracts 1-3 standalone thoughts per day, focusing on research patterns, decisions, and interests. Days with only trivial activity get empty summaries.

**Stage 3: Ingestion** — Each thought gets a vector embedding (text-embedding-3-small, 1536 dimensions) and is inserted into your `thoughts` table with metadata linking back to the source category and date.

### Deduplication

The sync log (`google-activity-sync-log.json`) stores a hash of each processed day's content, keyed by `category:date`. Re-running the script after a new Takeout export only processes:
- New days that weren't in the previous export
- Days whose content has changed (new entries appended)

This means you can download a fresh Takeout export every few months and re-run — only new activity gets imported.

## Options Reference

| Flag | Description | Default |
|------|-------------|---------|
| `--dry-run` | Parse, filter, summarize — don't write to database | Off |
| `--limit N` | Max activity-days to process (0 = unlimited) | 0 |
| `--after YYYY-MM-DD` | Only process activity after this date | None |
| `--before YYYY-MM-DD` | Only process activity before this date | None |
| `--categories LIST` | Comma-separated categories to process | Search,Gmail,Maps,YouTube,Chrome |
| `--raw` | Skip LLM summarization, insert grouped entries as-is | Off |
| `--verbose` | Print full thought text during processing | Off |

### Processing specific categories

```bash
# Only import search history
node import-google-activity.mjs ./Takeout/My\ Activity --categories Search

# Only import search and Gmail
node import-google-activity.mjs ./Takeout/My\ Activity --categories Search,Gmail
```

### Importing without LLM (free, private)

If you don't want to send your activity data to OpenRouter for summarization, use `--raw` mode:

```bash
node import-google-activity.mjs ./Takeout/My\ Activity --raw
```

This inserts the grouped daily entries as-is (e.g., "Google Search activity for 2024-06-15: Searched for X, Searched for Y..."). Embeddings still use OpenRouter. The thoughts won't be as clean, but your raw activity data stays private.

## Cost Estimates

All costs are via OpenRouter at current pricing.

| Component | Model | Cost |
|-----------|-------|------|
| Summarization | gpt-4o-mini | ~$0.15/1M input + $0.60/1M output |
| Embeddings | text-embedding-3-small | ~$0.02/1M tokens |

**Typical costs by Takeout size:**

| Takeout period | Activity-days | Thoughts | Est. cost |
|----------------|---------------|----------|-----------|
| 1 year | ~365 | ~200 | ~$0.01 |
| 3 years | ~1,000 | ~600 | ~$0.04 |
| 5 years | ~1,800 | ~1,200 | ~$0.07 |
| All time (10yr+) | ~3,500 | ~2,500 | ~$0.15 |

These assume ~60% of days are filtered as trivial and ~1.5 thoughts per day on average.

## Troubleshooting

**Issue: "No MyActivity.json files found"**
Solution: Make sure you selected **JSON** format (not HTML) when creating your Google Takeout export. The script looks for `MyActivity.json` files inside category subdirectories. If you see `MyActivity.html` files instead, re-create your Takeout with JSON format selected.

**Issue: `OPENROUTER_API_KEY required` error**
Solution: Make sure you've exported the environment variable in your current terminal session: `export OPENROUTER_API_KEY=sk-or-v1-...`. Environment variables don't persist between terminal windows.

**Issue: Import is very slow**
Solution: Each activity-day requires one LLM call (summarization) and 1-3 embedding calls. For 1,000+ days, expect 30-60 minutes. Use `--limit 10` to test first, then `--after 2024-01-01` to process recent activity, and expand the date range in later runs.

**Issue: Most days return "No thoughts extracted"**
Solution: This is expected. The LLM is deliberately selective — days with only routine searches or a single trivial lookup get empty summaries. Use `--raw` if you want to import everything without filtering.

**Issue: Want to re-import after a new Takeout export**
Solution: Just run the script again pointing at your new export. The sync log tracks which days have been processed by content hash. Only new or changed days will be imported. If you want to start completely fresh, delete `google-activity-sync-log.json`.

**Issue: `Failed to generate embedding` errors**
Solution: Check that your OpenRouter API key is valid and has credits. Go to openrouter.ai/credits to verify your balance. The embedding model (text-embedding-3-small) costs $0.02 per million tokens — even a large import costs pennies.

**Issue: Want to import a category not in the default list**
Solution: Use `--categories` to specify any category that has a `MyActivity.json` file. For example: `--categories "Gemini Apps,Google Analytics"`. Run without `--categories` first using `--dry-run` to see all available categories.
