# Email History Import

> Import your Gmail email history into Open Brain as searchable thoughts — with RAG chunking for long emails.

## What It Does

Pulls your Gmail history via the Gmail API, strips quoted replies and signatures, filters transactional noise, chunks long emails into segments for better semantic search, and loads everything into your Open Brain with vector embeddings and metadata. The result: every meaningful email you've sent (and optionally starred) becomes searchable alongside your other thoughts.

## Why Email?

Your Open Brain captures what you *decide to capture*. Your email is different — it's thinking you already did. Every email you send is a decision, a position, a relationship update, or a problem you solved. You wrote it, sent it, and it immediately became invisible to your AI tools.

30 days of sent mail from a real production run: 170 messages fetched → 47 filtered as noise → 123 processed → 153 thoughts ingested, including 13 long emails chunked into smaller segments. Total API cost: $0.02.

## Prerequisites

- Working Open Brain setup ([guide](../../docs/01-getting-started.md))
- [Deno](https://deno.com) installed — `brew install deno` on Mac, `winget install DenoLand.Deno` on Windows
- A Google account with Gmail
- Google Cloud project with Gmail API enabled and OAuth credentials
- Your Supabase project URL and service role key
- OpenRouter API key (for embedding generation)
- About 45 minutes for first-time setup (most of it is Google Cloud OAuth)

## Credential Tracker

Copy this block into a text editor and fill it in as you go.

```text
EMAIL HISTORY IMPORT -- CREDENTIAL TRACKER
--------------------------------------

FROM YOUR OPEN BRAIN SETUP
  Supabase Project URL:  ____________
  Supabase Secret key:   ____________
  OpenRouter API key:    ____________

GENERATED DURING SETUP
  Google Cloud Project:       ____________
  Gmail OAuth Client ID:      ____________.apps.googleusercontent.com
  Gmail OAuth Client Secret:  ____________

--------------------------------------
```

## Steps

### 1. Set up Google Cloud OAuth credentials

This is the most involved step. Take it slowly.

**1a. Create a Google Cloud Project**

1. Go to [console.cloud.google.com](https://console.cloud.google.com)
2. Click the project selector at the top → **New Project**
3. Name it "Open Brain" → click **Create**
4. Make sure your new project is selected

**1b. Enable the Gmail API**

1. Go to [APIs & Services → Library](https://console.cloud.google.com/apis/library)
2. Search for "Gmail API" → click it → click **Enable**

**1c. Configure the OAuth Consent Screen**

1. Go to [APIs & Services → OAuth consent screen](https://console.cloud.google.com/apis/credentials/consent)
2. Choose **External** → click **Create**
3. Fill in: App name: `Open Brain`, User support email: your Gmail, Developer contact: your Gmail
4. Click **Save and Continue**
5. On Scopes: click **Add or Remove Scopes** → search `gmail.readonly` → check it → **Update** → **Save and Continue**
6. On Test Users: click **Add Users** → enter your Gmail address → **Save and Continue**
7. Click **Back to Dashboard**

**1d. Create the OAuth Client ID**

1. Go to [APIs & Services → Credentials](https://console.cloud.google.com/apis/credentials)
2. Click **Create Credentials** → **OAuth client ID**
3. Application type: **Desktop app**, Name: `Open Brain`
4. Click **Create**
5. Click **Download JSON** on the confirmation dialog
6. Save the downloaded file as `credentials.json` in the same directory as `pull-gmail.ts`

### 2. Run the database migration

Your Open Brain database needs two new columns to support email chunking. These are nullable — existing thoughts are unaffected.

Open your Supabase dashboard → **SQL Editor** → paste the contents of `chunking-migration.sql` and click **Run**.

You should see "Success. No rows returned."

**What this adds:**
- `parent_id` column — links chunks to their parent email
- `chunk_index` column — orders chunks within a parent
- `insert_thought` RPC function — handles inserts with the new columns

### 3. Copy the recipe files

Copy `pull-gmail.ts` into a working directory (or work from the repo directly). Make sure `credentials.json` from Step 1 is in the same directory.

### 4. Set your environment variables

```bash
export SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
export SUPABASE_SERVICE_ROLE_KEY=your-service-role-key-here
export OPENROUTER_API_KEY=sk-or-v1-your-key-here
```

All three values come from your credential tracker. You can also copy `.env.example` to `.env` and fill it in, then run `export $(cat .env | xargs)`.

### 5. First run — dry run

```bash
deno run --allow-net --allow-read --allow-write --allow-env pull-gmail.ts --dry-run --window=24h
```

**What happens:**
1. The script prints an authorization URL — open it in your browser
2. Authorize with your Google account
3. The browser redirects to `localhost:3847` — the script catches it automatically
4. Your token is saved to `token.json` for future runs (no re-auth needed)
5. The script shows what the last 24 hours of sent mail would look like if ingested

**Check the output:**
- Are obviously junk emails showing up?
- Does the content preview look right (not full of HTML)?
- Are long emails showing `[N chunks]`?

### 6. First live run

```bash
deno run --allow-net --allow-read --allow-write --allow-env pull-gmail.ts --window=24h
```

Each email prints as it's ingested. At the end you'll see a summary with total thoughts and estimated cost.

### 7. Scale up

```bash
# Last 7 days of sent mail
deno run --allow-net --allow-read --allow-write --allow-env pull-gmail.ts --window=7d

# Last 30 days of sent + starred emails
deno run --allow-net --allow-read --allow-write --allow-env pull-gmail.ts --window=30d --labels=SENT,STARRED

# See all your Gmail labels
deno run --allow-net --allow-read --allow-write --allow-env pull-gmail.ts --list-labels
```

**Re-running is safe.** The script tracks ingested emails in `gmail-sync-log.json`. Running the same window twice only processes new emails.

### 8. Verify in your database

Open Supabase dashboard → Table Editor → `thoughts`. You should see new rows with:
- `content`: prefixed with `[Email from X | Subject: Y | Date: Z]`
- `metadata`: includes `source: "gmail"`, Gmail labels, message ID
- `embedding`: a 1536-dimension vector
- For chunked emails: `parent_id` linking chunks to their parent, `chunk_index` for ordering

## Expected Outcome

After a full import, your `thoughts` table contains every non-trivial email you've sent (and optionally starred). Short emails are stored as single thoughts. Long emails (500+ words) are split into 200-500 word chunks, each with its own focused embedding for better search recall.

From a real production run:

| Metric | Value |
|--------|-------|
| Window | 30 days, SENT + STARRED |
| Messages fetched | 170 |
| Filtered as noise | 47 (28%) |
| Processed | 123 |
| Chunked emails | 13 (produced 43 thoughts incl. parents) |
| Total thoughts | 153 |
| Estimated API cost | $0.02 |

Searching for topics you discussed in email now returns results through your Open Brain MCP server.

## How It Works

### Five hard problems we solved

This script was built iteratively. Each of these problems was discovered in production and required a specific fix. If you're curious about the engineering decisions or want to modify the script, this is the context.

**1. Gmail's line-wrapping breaks quote detection**

When you reply to an email, Gmail includes the original message prefixed with "On Mon, Mar 2, 2026 at 8:56 AM Someone wrote:" — but that text wraps across 2-3 lines in plain text format. A naive quote stripper only matches the whole thing on one line. Result: one reply contained 700 words of the original newsletter that looked like original writing. Fix: look ahead across multiple lines to detect the split "On ... wrote:" pattern.

**2. Supabase's PostgREST cache doesn't update instantly**

When you add new columns to a table (`parent_id`, `chunk_index`), the REST API that Edge Functions use doesn't always see them immediately. The fix: an `insert_thought` RPC function that bypasses PostgREST entirely and writes directly via PL/pgSQL. This is why the migration includes the RPC function, not just the columns.

**3. Booking confirmations produce chunks of CSS**

When we added the STARRED label, the first starred email was a travel booking confirmation — 8,874 words, almost entirely CSS and HTML boilerplate, chunked into 23 meaningless fragments. Fix: detect CSS density (more than 10 `{...}` blocks) and skip the email, plus filter sender patterns like `no-reply`, `noreply`, `automated@`, and subject patterns like "booking confirmation", "payment due", "your receipt."

**4. The Gmail label API is AND, not OR**

If you pass `labelIds=SENT&labelIds=STARRED` to the Gmail API, it returns messages with *both* labels, not *either*. Fix: query each label independently and deduplicate by message ID before processing.

**5. A 1,900-word email wouldn't chunk**

The chunking logic splits on paragraph breaks (double newlines). One 1,900-word email had no paragraph breaks — just one continuous wall of text. Fix: detect when paragraph splitting produces only one oversized segment and fall back to sentence-boundary splitting.

### Chunking explained

Embedding a 1,500-word email as a single vector produces a blurry average of a dozen topics — matching poorly with any specific query. Splitting into 300-word segments gives each chunk a focused embedding. When you search, you get the relevant *section* of the email, not a low-confidence match on the whole thing.

The chunking thresholds:
- **Trigger**: emails over 500 words get chunked
- **Target chunk size**: 200-500 words
- **Split strategy**: paragraph boundaries first, sentence boundaries as fallback
- **Overlap**: 50 words between chunks (for context continuity)
- **Parent document**: the full email is also stored, linked to its chunks via `parent_id`

**Note on search results:** Chunks from the same long email may appear as separate search results. This is expected — each chunk contains different relevant information. A future upstream improvement to the MCP server's search deduplication could consolidate these.

## Options Reference

| Flag | Default | Description |
|------|---------|-------------|
| `--window=` | `24h` | Time window: `24h`, `7d`, `30d`, `1y`, `all` |
| `--labels=` | `SENT` | Comma-separated Gmail labels (OR logic) |
| `--dry-run` | off | Show what would be ingested without writing to database |
| `--limit=` | `50` | Max emails to process per run |
| `--list-labels` | off | Print all Gmail labels and exit |
| `--ingest-endpoint` | off | Use custom `INGEST_URL`/`INGEST_KEY` instead of Supabase direct insert |

### Label strategy

| Label | Signal | Recommendation |
|-------|--------|----------------|
| `SENT` | Highest — you wrote it | Always include |
| `STARRED` | High — you explicitly marked it | Good for important inbound |
| `IMPORTANT` | Medium — Gmail auto-marks | More noise than SENT |
| `INBOX` | Low — everything | Not recommended |
| Custom labels | Varies — your own organization | Great if you use them |

**Best starting point:** `--labels=SENT,STARRED`

## Cost Estimates

| Window | Typical volume | Estimated cost |
|--------|---------------|----------------|
| 24 hours | 5-20 emails | ~$0.002 |
| 7 days | 30-80 emails | ~$0.01 |
| 30 days | 100-200 emails | ~$0.02 |
| 1 year | 1,000-2,000 emails | ~$0.20 |

Costs are for embedding generation via OpenRouter (text-embedding-3-small at $0.02/1M tokens). Long emails that get chunked count as multiple thoughts.

## Security Note

When you ingest email, you're pulling in text written by other people. Some of that text could contain prompt injection — instructions crafted to manipulate AI models when retrieved later.

**Mitigations:**
- Stick to `SENT` as your primary label — you wrote those emails, you control the content
- Be more cautious with `STARRED` or `INBOX` labels (content from untrusted senders)
- The Gmail OAuth scope is read-only (`gmail.readonly`) — the script can never send email on your behalf
- Embeddings are purely mathematical — no model reads the text at ingestion time

This isn't a reason not to use the system. It's a reason to be thoughtful about which labels you ingest.

## Troubleshooting

**Issue: OAuth flow fails or "access_denied"**
Solution: Make sure you added your Gmail address as a test user in the Google Cloud Console (Step 1c, item 6). Apps in "testing" mode only allow explicitly listed test users.

**Issue: "Token refresh failed: Token has been expired or revoked"**
Solution: Apps in Google Cloud "testing" mode have tokens that expire after 7 days. Delete `token.json` and re-run the script to re-authorize. To avoid this, publish your app to production mode in Google Cloud Console (requires Google review).

**Issue: `credentials.json` not found**
Solution: Make sure the OAuth credentials JSON from Step 1d is saved as `credentials.json` in the same directory as `pull-gmail.ts`. The file should contain an `"installed"` key with `client_id` and `client_secret`.

**Issue: "SUPABASE_URL environment variable required"**
Solution: Export your environment variables in the current terminal session: `export SUPABASE_URL=https://...`. Environment variables don't persist between terminal windows.

**Issue: Most emails showing up as "skipped"**
Solution: This is expected. The script filters transactional emails (receipts, auto-generated messages, no-reply senders) and emails with fewer than 10 words of content. Run with `--dry-run` to see what's being filtered.

**Issue: Found 0 messages**
Solution: Check your labels — `--labels=SENT` is case-sensitive. Run `--list-labels` to see exactly what labels your account has. Also check your `--window` — `24h` only looks at the last day.

**Issue: Want to re-import after some time passes**
Solution: Just run the script again. The sync log (`gmail-sync-log.json`) tracks which emails have been processed. Only new emails will be imported. To start fresh, delete the sync log file.

**Issue: Long email wasn't chunked**
Solution: Emails under 500 words aren't chunked. If a long email came through as one thought, it may lack paragraph breaks (the chunker splits on double newlines first). The fallback to sentence-boundary splitting should handle most cases, but very dense prose with no punctuation boundaries may resist chunking.

## Keeping Your Brain Up to Date

The script doesn't run automatically — you run it when you want to sync. Patterns that work well:

**Weekly sync** (simplest):

```bash
deno run --allow-net --allow-read --allow-write --allow-env \
  pull-gmail.ts --window=7d --labels=SENT,STARRED
```

**Monthly deep sync** (for catching up):

```bash
deno run --allow-net --allow-read --allow-write --allow-env \
  pull-gmail.ts --window=30d --labels=SENT,STARRED --limit=200
```

**Scheduled via cron** (Mac, runs every Monday at 9am):

```bash
# Add to crontab: crontab -e
0 9 * * 1 cd /path/to/your/recipe/folder && \
  SUPABASE_URL="..." SUPABASE_SERVICE_ROLE_KEY="..." OPENROUTER_API_KEY="..." \
  deno run --allow-net --allow-read --allow-write --allow-env \
  pull-gmail.ts --window=7d --labels=SENT,STARRED
```

The sync log handles deduplication — running the same window twice doesn't create duplicates.
