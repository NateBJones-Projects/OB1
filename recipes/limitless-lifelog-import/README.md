# Limitless Lifelog Import

> Import Limitless AI lifelog transcripts into Open Brain as searchable thoughts.

## What It Does

Parses [Limitless AI](https://limitless.ai) lifelog markdown transcripts — ambient conversations recorded via a wearable pendant — cleans them, generates embeddings, and stores them as searchable thoughts in your Open Brain.

## Prerequisites

- Working Open Brain setup ([guide](../../docs/01-getting-started.md))
- **Limitless data export** — your lifelogs as markdown files, typically structured as:
  ```
  2026/
  ├── 01/
  │   ├── 2026-01-15_09h30m00s_Morning-Standup.md
  │   └── 2026-01-15_14h00m00s_Client-Call.md
  └── 02/
      └── ...
  ```
- **Node.js 18+** installed
- **OpenRouter API key** for embedding generation
- **Content fingerprint dedup** — The `upsert_thought` RPC and `content_fingerprint` column must exist on your thoughts table. See [Content Fingerprint Dedup](../../primitives/content-fingerprint-dedup/README.md).

## Credential Tracker

```text
LIMITLESS LIFELOG IMPORT -- CREDENTIAL TRACKER
--------------------------------------

FROM YOUR OPEN BRAIN SETUP
  Supabase URL:          ____________
  Service Role Key:      ____________

FROM OPENROUTER
  API Key:               ____________

--------------------------------------
```

## Steps

1. **Copy this recipe folder** to your local machine:
   ```bash
   cd limitless-lifelog-import
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Create `.env`** with your credentials (see `.env.example`):
   ```env
   SUPABASE_URL=https://your-project.supabase.co
   SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
   OPENROUTER_API_KEY=sk-or-v1-your-key
   ```

4. **Preview what will be imported** (dry run):
   ```bash
   node import-limitless.mjs /path/to/your/limitless/lifelogs --dry-run
   ```

5. **Run the import:**
   ```bash
   node import-limitless.mjs /path/to/your/limitless/lifelogs
   ```

6. **For large exports**, use skip/limit to process in batches:
   ```bash
   node import-limitless.mjs /path/to/lifelogs --skip 0 --limit 500
   node import-limitless.mjs /path/to/lifelogs --skip 500 --limit 500
   ```

## How It Works

1. **Discovery:** Recursively walks your lifelog directory for `.md` files
2. **Parsing:** Extracts title from H1 header, timestamp from filename pattern (`YYYY-MM-DD_HHhMMmSSs`)
3. **Cleaning:** Removes blockquote markers and speaker attribution timestamps
4. **Filtering:** Skips files under 100 characters (noise/empty recordings)
5. **Deduplication:** SHA256 content fingerprint prevents duplicate imports
6. **Embedding:** Generates vector embedding via OpenRouter (text-embedding-3-small)
7. **Storage:** Upserts into `thoughts` table via `upsert_thought` RPC

## Expected Outcome

After running the import:
- Each lifelog becomes a thought in your Open Brain's `thoughts` table
- Running `search_thoughts` with a topic from your lifelogs should return relevant results
- The dry run should show output like: `[1/150] Would import: "Morning Standup" (2340 chars)`
- A live import shows: `[1/150] inserted: #12345 "Morning Standup"`

**Scale reference:** Tested with 6.9 GB of Limitless lifelogs → 20,000+ thoughts imported in ~2 hours.

## Troubleshooting

**Issue: "File too short, skipping"**
Normal for empty or failed recordings. Threshold is 100 characters.

**Issue: Rate limits from OpenRouter**
The script processes files sequentially by default. If you hit rate limits, wait a few minutes and resume with `--skip N` where N is the last successfully imported index.

**Issue: Duplicate thoughts after re-running**
This shouldn't happen — content fingerprints prevent duplicates. If you see duplicates, check that the `content_fingerprint` column and unique index exist on your `thoughts` table.

**Issue: Timestamps are offset by several hours**
Limitless filenames use your local timezone, but the script parses them as UTC. If your timezone is UTC-5, timestamps will appear 5 hours early. This is a known limitation — a `--timezone` flag is not yet implemented.
