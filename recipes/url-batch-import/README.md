# URL Batch Import

> Fetch a list of URLs (news articles, blog posts, web pages), extract and summarize content with an LLM, and import as searchable thoughts into Open Brain.

## What It Does

Reads a `.txt` or `.csv` file containing URLs, fetches each page, extracts readable text, generates LLM summaries and metadata via OpenRouter, and stores each as a thought in Open Brain with SHA-256 content fingerprint dedup. The script gracefully skips failed fetches (paywalls, timeouts, JS-heavy SPAs), logs them for later review, and uses sync-log deduplication so re-running the same file doesn't create duplicates.

**One article = one thought.** The thought's `content` is an LLM-generated summary with context (title, domain, date), and `metadata.raw_text` stores the full extracted article text for reference and search.

## Prerequisites

- Working Open Brain setup ([guide](../../docs/01-getting-started.md))
- Deno runtime installed (`deno --version` should work)
- OpenRouter API key (same one from your Open Brain setup)
- A `.txt` file (one URL per line) or `.csv` file (with `url`, `title`, `category` columns)

## Credential Tracker

Copy this block into a text editor and fill it in as you go.

```text
URL BATCH IMPORT -- CREDENTIAL TRACKER
--------------------------------------

FROM YOUR OPEN BRAIN SETUP
  Supabase Project URL:    ____________
  Supabase Service Key:    ____________
  OpenRouter API Key:      ____________

GENERATED DURING SETUP
  (none required)

--------------------------------------
```

## Setup

1. **Copy this recipe folder** into your project, or download it from the OB1 repo.

2. **Set environment variables** (one-time setup):

   ```bash
   # Create a .env file from the example
   cp .env.example .env
   
   # Edit .env and fill in your values
   vim .env  # or your editor of choice
   ```

   Your `.env` should contain:
   ```bash
   export SUPABASE_URL=https://YOUR_REF.supabase.co
   export SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
   export OPENROUTER_API_KEY=sk-or-v1-your-key
   ```

3. **Load environment variables** before running:

   ```bash
   source .env
   ```

4. **First run — dry run to preview:**

   ```bash
   deno run --allow-net --allow-read --allow-write --allow-env import-urls.ts --input=urls.txt --dry-run
   ```

   This fetches your URLs, extracts text, and shows previews — but doesn't write to Open Brain.

## Usage

### Basic: import all URLs from a file

```bash
deno run --allow-net --allow-read --allow-write --allow-env import-urls.ts --input=urls.txt
```

### Dry run: preview without writing

```bash
deno run --allow-net --allow-read --allow-write --allow-env import-urls.ts --input=urls.txt --dry-run
```

### Process a subset (first 10 URLs)

```bash
deno run --allow-net --allow-read --allow-write --allow-env import-urls.ts --input=urls.txt --limit=10
```

### Batch a large file: process URLs 100–200

```bash
deno run --allow-net --allow-read --allow-write --allow-env import-urls.ts --input=urls.txt --offset=100 --limit=100
```

Then run again with `--offset=200 --limit=100`, etc. Processed URLs are tracked in `sync-log.json`.

### List failed fetches

```bash
cat failures.log
```

Failed URLs are logged with timestamps and reasons (timeout, HTTP error, unsupported MIME type, etc.). You can manually retry these later, or investigate and skip them.

### Use a custom ingest endpoint

```bash
export INGEST_URL=https://YOUR_REF.supabase.co/functions/v1/ingest-thought
export INGEST_KEY=your-ingest-key
deno run --allow-net --allow-read --allow-write --allow-env import-urls.ts --input=urls.txt --ingest-endpoint
```

## Supported Input Formats

### Plain text (`.txt`)

One URL per line, blank lines and `#` comments ignored:

```
https://example.com/article-1
https://example.com/article-2

# This is a comment, the next line will be skipped
https://example.com/article-3
```

### CSV (`.csv`)

Required column: `url`. Optional: `title`, `category`, `note`.

```
url,title,category
https://example.com/a1,Article Title,Tech
https://example.com/a2,Another Article,Policy
```

When a `title` is provided, it's used as a hint for LLM title extraction and stored in metadata. When a `category` is provided, it's stored in the thought's metadata for filtering/tagging.

## How It Works

1. **Parse input** — reads `.txt` or `.csv` and extracts URL list
2. **Check sync log** — skips URLs already processed (stored in `sync-log.json`)
3. **Fetch** — GET each URL with a 15-second timeout
   - On error (timeout, 4xx, 5xx, unsupported MIME type): logs to `failures.log` and continues
4. **Extract** — strips HTML tags, scripts, styles to plain text
   - Filters out very short extractions (likely JS SPAs) to avoid junk
5. **Summarize** — calls OpenRouter LLM to:
   - Extract article title (or use CSV title hint)
   - Generate 2–4 sentence summary
   - Classify topics (2–4 tags)
   - Extract named entities (people, companies, products)
   - Determine article type (news, analysis, tutorial, etc.)
6. **Embed** — generates embedding via `text-embedding-3-small`
7. **Upsert** — inserts thought into Supabase with:
   - `content`: `[URL Import | Title | Domain | Date]\n\nLLM Summary`
   - `metadata`: url, domain, title, topics, entities, type, raw_text (truncated)
   - `content_fingerprint`: SHA-256 dedup key

## Handling Large / Growing Lists

**Sync log resumability:** The `sync-log.json` file tracks URLs already processed. Re-running the script on a file with new URLs automatically imports only the new ones — already-processed entries are skipped. This makes it safe to:

- Keep a `urls.txt` that grows over time (add new URLs, re-run the script weekly)
- Resume if the script crashes mid-run
- Avoid duplicate imports when sharing the file across machines

**Range batching for very large files:** If your `urls.txt` has 1000+ URLs, process it in chunks:

```bash
# Process URLs 0–100
deno run ... import-urls.ts --input=urls.txt --limit=100

# Process URLs 100–200
deno run ... import-urls.ts --input=urls.txt --offset=100 --limit=100

# etc.
```

Each chunk's progress is tracked in the sync-log, so resuming from a crash within a batch automatically continues from where it left off.

**Future enhancement:** A planned `--since=YYYY-MM-DD` flag will enable time-based resumability for even larger operations.

## Expected Outcome

Each imported article becomes one row in the `thoughts` table:

- `content`: Self-contained summary with context
  ```
  [URL Import | AI and the Future of Work | techcrunch.com | 2026-05-31]

  The article discusses how AI is reshaping workplace dynamics...
  ```

- `embedding`: 1536-dim vector for semantic search (from first 8000 chars of summary)

- `metadata`: Structured fields:
  ```json
  {
    "source": "url-import",
    "url": "https://techcrunch.com/...",
    "domain": "techcrunch.com",
    "title": "AI and the Future of Work",
    "type": "analysis",
    "topics": ["AI", "work", "future"],
    "entities": ["OpenAI", "Microsoft"],
    "category": "Tech",
    "raw_text": "Full extracted article text (up to 8000 chars)..."
  }
  ```

- `content_fingerprint`: SHA-256 hash for dedup (see [content fingerprint primitive](../../primitives/content-fingerprint-dedup/README.md))

Once imported, you can:

- **Search** for topics: `search_thoughts("AI workplace policy")` surfaces these articles
- **Browse** by domain or type: filter in your Open Brain UI by `metadata.domain` or `metadata.type`
- **Reference** full text: `metadata.raw_text` contains the complete extracted article for detailed review

## Troubleshooting

**Issue: `SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.`**
Solution: Make sure your `.env` file is set up and sourced before running. Run `source .env` and verify with `echo $SUPABASE_URL`.

**Issue: `Fetch FAILED` for most URLs**
Solution: Check `failures.log` for reasons. Common causes:
- **Timeout (15s exceeded)**: The server is slow or unreachable
- **HTTP 429**: Rate-limited by the host. Add a delay or spread requests across multiple runs
- **Unsupported content-type**: The URL is not HTML (e.g., PDF, JSON, binary)
- **Extracted text too short**: JavaScript-rendered SPA with minimal server-side content — `browser39` cannot handle these

For JS SPAs like Stuff.co.nz, consider:
- Using the site's RSS feed instead (if available)
- Manually copying text and using a different approach
- Skipping the site entirely

**Issue: No thoughts appear in Open Brain**
Solution: Check that `SUPABASE_SERVICE_ROLE_KEY` is your service role key (not the anon key). RLS blocks anon inserts.

**Issue: Re-running the script imports the same articles again**
Solution: Check that `sync-log.json` exists in the recipe folder. The sync log tracks processed URLs. If you delete it, all URLs are re-imported. This is intentional — use it to recover from dedup failures or re-process with different settings.

**Issue: LLM summary is generic or missing**
Solution: The script gracefully falls back to raw text if the LLM call fails. Check your `OPENROUTER_API_KEY` has credits. If failures persist, the article may be too short (< 100 chars of extractable text).

**Issue: `content_fingerprint column not found`**
Solution: Your Supabase setup doesn't have the `content_fingerprint` column on `thoughts`. Run the SQL from [primitives/content-fingerprint-dedup](../../primitives/content-fingerprint-dedup/README.md) to add dedup support. The script will continue without it, but duplicates won't be prevented.

**Issue: Processing is very slow**
Solution: The script includes 500ms pauses between API calls to avoid rate-limiting. For 1000+ URLs, this is normal (~8 min runtime). You can batch with `--offset` and `--limit` to parallelize across separate terminal sessions:
   ```bash
   # Terminal 1
   deno run ... import-urls.ts --input=urls.txt --offset=0 --limit=100
   
   # Terminal 2 (in parallel)
   deno run ... import-urls.ts --input=urls.txt --offset=100 --limit=100
   ```
   Sync-log prevents duplicates across parallel runs.
