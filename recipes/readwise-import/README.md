# Readwise Import

## What It Does

One-shot backfill of your Readwise highlight history into Open Brain. The script pages through Readwise's `/api/v2/export/` endpoint, upserts each book into the `readwise_books` cache table, batch-embeds highlight text via OpenRouter, and inserts each highlight as a thought with `source_type = 'readwise'`.

Idempotent: re-running it after new highlights arrive will skip everything already present (dedup by `readwise_highlight_id`) and import only the delta.

Pair it with the [readwise-capture integration](../../integrations/readwise-capture/) to keep things live after the initial backfill — this recipe handles history, the webhook handles the future.

## What this captures and what it doesn't

**Captured:** every highlight across every Readwise-connected source — Kindle, Apple Books, Reader, Instapaper, Hypothesis, Airr/Snipd podcasts, Readwise OCR physical-book highlights, and anything else Readwise aggregates. All of them flow through the same export endpoint.

**Deliberately not captured:** Reader reading history itself — the list of articles, emails, and RSS items you've read but not highlighted. Reader's webhook and API support it, but "I read this article" is a low-signal data point that clutters search. If you cared enough about a passage to highlight it, it's here. Everything else stays in Reader where it belongs.

## Prerequisites

- Working Open Brain setup ([guide](../../docs/01-getting-started.md))
- The [readwise-books schema](../../schemas/readwise-books/) applied to your Supabase project
- Recommended: the [enhanced-thoughts schema](../../schemas/enhanced-thoughts/) applied, so the idempotency check on re-runs hits the `source_type` index
- A Readwise account with the access token endpoint enabled (any plan; no paid requirement for this recipe)
- Python 3.10 or newer

## Cost

At ~$0.02 per million embedding tokens and an average highlight of ~30 tokens, costs are trivial:

| Library size | Embedding cost | Wall-clock time |
|---|---|---|
| 1,000 highlights | ~$0.001 | <1 min |
| 10,000 highlights | ~$0.006 | ~5 min |
| 50,000 highlights | ~$0.03 | ~20 min |

No Readwise API cost; the export endpoint is throttled at 20 req/min, which is generous at `pageSize=1000`.

---

## Credential Tracker

Copy this block into a text editor and fill it in as you go.

```text
READWISE IMPORT -- CREDENTIAL TRACKER
--------------------------------------

FROM YOUR OPEN BRAIN SETUP
  Supabase project URL:  ____________
  Service role key:      ____________
  OpenRouter API key:    ____________

READWISE
  Access token:          ____________ (https://readwise.io/access_token)

--------------------------------------
```

---

## Step 1: Install Python Dependencies

From this folder:

```bash
pip install -r requirements.txt
```

This installs the `requests` and `supabase` Python clients. Use a virtualenv if you don't want them installed globally.

---

## Step 2: Check the Size of Your Library

A sanity check before running. Paste this, replacing the token:

```bash
TOKEN=your-readwise-access-token

echo "Highlights: $(curl -s 'https://readwise.io/api/v2/highlights/?page_size=1' \
  -H "Authorization: Token $TOKEN" | jq '.count')"
echo "Books:      $(curl -s 'https://readwise.io/api/v2/books/?page_size=1' \
  -H "Authorization: Token $TOKEN" | jq '.count')"
```

This tells you roughly how many rows the backfill will create. Useful to estimate runtime and spot-check the token works.

---

## Step 3: Export the Required Environment Variables

```bash
export READWISE_ACCESS_TOKEN=your-readwise-token
export SUPABASE_URL=https://YOUR_REF.supabase.co
export SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
export OPENROUTER_API_KEY=your-openrouter-key
```

> Use the **service role** key, not the anon key. The backfill writes directly to `thoughts` and `readwise_books`, which is only possible with a role that bypasses RLS.

---

## Step 4: Dry Run

Always do a dry run first to confirm your credentials and the expected book count:

```bash
python import-readwise.py --dry-run --limit 50 --verbose
```

Expected output is a list of books scanned and a summary line showing what would have been inserted. If you see authentication errors or zero books, fix those before the real run.

---

## Step 5: Full Import

```bash
python import-readwise.py --verbose
```

For large libraries this will take a few minutes. A progress heartbeat prints every 500 highlights so you can see it hasn't stalled:

```
  ... 500 highlights processed (48/s, 23 books)
  ... 1000 highlights processed (51/s, 47 books)
```

The script is safe to interrupt and resume — on re-run, already-imported highlights are skipped via `readwise_highlight_id`.

### Incremental re-runs

After the first import, you can run with `--updated-after` to pull only what's changed since a given date:

```bash
python import-readwise.py --updated-after 2026-01-01 --verbose
```

This belt-and-braces complement to the webhook is handy if you want periodic reconciliation (e.g., daily cron) even with the live integration installed.

---

## Expected Outcome

After a successful run:

- Every book you've ever highlighted in Readwise has a row in `readwise_books` with title, author, category, source, cover image URL, and `num_highlights`.
- Every highlight is a row in `thoughts` with:
  - `content` = the highlight text (plus your note, if any, after an em-dash)
  - `source_type = 'readwise'`
  - `type = 'reference'`
  - `metadata` containing `readwise_highlight_id`, `readwise_book_id`, `book_title`, `book_author`, `highlighted_at`, `location`, `location_type`, `color`, `url`, and `tags`
- Every highlight has a 1536-dim embedding, so semantic search in Open Brain immediately surfaces them alongside your other thoughts.

From any MCP-connected AI you can now ask things like:
- "What have I highlighted about stoicism?"
- "Show me the highlights from Antifragile in reading order" (uses the `get_book_highlights` RPC from [readwise-books](../../schemas/readwise-books/))
- "What books have I highlighted most in the last year?"

---

## Troubleshooting

### `KeyError: READWISE_ACCESS_TOKEN`

You didn't export one of the required env vars. All four are required. The script errors before any network call so you don't partially import with bad credentials.

### Readwise returns 401

Your access token is wrong or rotated. Visit [readwise.io/access_token](https://readwise.io/access_token) and copy the current value.

### Supabase insert fails with `relation "readwise_books" does not exist`

You haven't applied the [readwise-books schema](../../schemas/readwise-books/) yet. Run `schema.sql` from that folder in your Supabase SQL Editor, then retry.

### The script was interrupted partway through

Safe to re-run — idempotency is per-highlight, not per-book. Already-imported highlights are detected via `readwise_highlight_id` and skipped. Books get re-upserted which is harmless (same values).

### "Rate limited by Readwise; sleeping..."

The `/api/v2/export/` endpoint is capped at 20 req/min. The script respects the `Retry-After` header and sleeps automatically. For a library of ~10K highlights this shouldn't trigger, but very large libraries (100K+) may hit it once or twice.

### Some highlights have `location: null`

Normal — tweets, supplemental highlights, and some podcast snippets don't have a numeric location. The `get_book_highlights` RPC sorts `NULLS LAST` so these still appear, just at the bottom of the list.

### Highlights were imported but they don't appear in search

Check that your Open Brain MCP server is connected to the same Supabase project the backfill wrote to. A mismatch between the MCP's configured `SUPABASE_URL` and the one you exported above is the most common cause.

---

## What You Just Built

Your entire Readwise library is now embedded in Open Brain. Every passage you've ever marked as worth remembering — across every book, article, podcast, and tweet — is searchable by meaning alongside everything else you've captured. Pair with the [readwise-capture integration](../../integrations/readwise-capture/) to make this a permanent feed rather than a one-time import.

---

*Built by Mark Lavercombe — part of the [Open Brain project](https://github.com/NateBJones-Projects/OB1)*
