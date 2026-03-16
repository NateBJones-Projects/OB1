# Email History Import

> Import your Gmail email history into Open Brain as searchable, embedded thoughts.

Your email is full of decisions, commitments, and context that your AI has never seen. This recipe connects to Gmail, pulls the emails that matter (filtering out receipts, auto-replies, and noise), and loads them into your Open Brain. Once imported, your AI can recall what you said to someone three months ago, find that pricing discussion from last quarter, or surface commitments you forgot about.

## What It Does

Pulls your Gmail history via the Gmail API and loads each email into Open Brain as a single thought. Long emails are stored in full — truncation for embedding happens server-side. Each thought includes a SHA-256 content fingerprint for dedup.

**One email = one thought.** No chunking, no parent/child relationships. This aligns with how the OB1 community handles long content (truncate for embedding, store full content).

## Prerequisites

- Working Open Brain setup ([guide](../../docs/01-getting-started.md))
- Deno runtime installed
- Google Cloud project with Gmail API enabled
- Gmail API OAuth credentials (Client ID + Client Secret)
- Your `ingest-thought` endpoint URL and key

## Credential Tracker

Copy this block into a text editor and fill it in as you go.

```text
EMAIL HISTORY IMPORT -- CREDENTIAL TRACKER
--------------------------------------

FROM YOUR OPEN BRAIN SETUP
  Supabase Project URL:  ____________
  Supabase Secret key:   ____________
  Ingest URL:            ____________/functions/v1/ingest-thought
  Ingest Key:            ____________

GENERATED DURING SETUP
  Google Cloud Project ID:     ____________
  Gmail OAuth Client ID:       ____________.apps.googleusercontent.com
  Gmail OAuth Client Secret:   ____________

--------------------------------------
```

## Setup

1. **Enable Gmail API** in your Google Cloud project
2. **Create OAuth 2.0 credentials** (Desktop app type) and download as `credentials.json` into this folder
3. **Set environment variables:**

   ```bash
   export INGEST_URL=https://YOUR_REF.supabase.co/functions/v1/ingest-thought
   export INGEST_KEY=your-service-role-key
   ```

4. **First run — authenticate:**

   ```bash
   deno run --allow-net --allow-read --allow-write --allow-env pull-gmail.ts --dry-run --limit=5
   ```

   This opens a browser window for OAuth consent. After authorizing, your token is cached in `token.json`.

## Usage

```bash
# Dry run — see what would be imported
deno run --allow-net --allow-read --allow-write --allow-env pull-gmail.ts --dry-run

# Import sent emails from the last 7 days
deno run --allow-net --allow-read --allow-write --allow-env pull-gmail.ts --window=7d

# Import starred emails
deno run --allow-net --allow-read --allow-write --allow-env pull-gmail.ts --labels=STARRED

# List all Gmail labels
deno run --allow-net --allow-read --allow-write --allow-env pull-gmail.ts --list-labels
```

### Options

| Flag | Default | Description |
|------|---------|-------------|
| `--window=` | `24h` | Time window: `24h`, `7d`, `30d`, `1y`, `all` |
| `--labels=` | `SENT` | Comma-separated Gmail labels |
| `--limit=` | `50` | Max emails to process |
| `--dry-run` | off | Preview without ingesting |
| `--list-labels` | off | List all Gmail labels and exit |

## How It Works

1. **Fetch** emails from Gmail API by label and time window
2. **Extract** body (base64 decode, HTML-to-text, strip quoted replies and signatures)
3. **Filter** out noise (no-reply senders, receipts, auto-generated, <10 words)
4. **Deduplicate** via sync-log (tracks Gmail message IDs already imported)
5. **Ingest** each email as one thought with SHA-256 content fingerprint and metadata

### What gets filtered out

- Auto-generated emails (receipts, confirmations, password resets)
- No-reply / notification senders
- Emails with <10 words after cleanup
- Quoted replies and email signatures are stripped before ingestion

## Expected Outcome

Each imported email becomes one row in the `thoughts` table:
- `content`: Email body with context prefix (`[Email from X | Subject: Y | Date: Z]`)
- `metadata`: LLM-extracted topics, type, people, etc. plus `source: "gmail"`, `gmail_id`, `gmail_labels`, `gmail_thread_id`
- `content_fingerprint`: SHA-256 hash for dedup (aligns with PR #54)
- `embedding`: Generated server-side from content (truncated to model limit)

## Troubleshooting

**OAuth flow fails:** Make sure your redirect URI in Google Cloud Console is `http://localhost:3847/callback`.

**No thoughts appear:** Check that `INGEST_KEY` is your service role key (not the anon key). RLS blocks anon inserts.

**Re-running imports the same emails:** The `sync-log.json` file tracks imported Gmail IDs. Delete it to re-import everything.
