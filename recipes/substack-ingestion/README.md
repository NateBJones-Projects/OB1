# Substack Ingestion

> Automated capture of Substack newsletter articles with full paywalled content extraction

## What It Does

This recipe automatically ingests articles from Substack newsletters, including paywalled content, and stores them in your Open Brain v2 instance. It extracts full article content from the _preloads JSON in Substack pages, supports backfilling from a specific date, and automatically captures linked GitHub repositories as prompts.

## Prerequisites

- Working Open Brain v2 setup ([guide](../../docs/01-getting-started.md))
- Python 3.7+
- pip (Python package manager)
- Target Substack domain access

## Credential Tracker

Copy this block into a text editor and fill it in as you go.

```text
SUBSTACK INGESTION -- CREDENTIAL TRACKER
--------------------------------------

FROM YOUR OPEN BRAIN SETUP
  Project URL:           ____________
  Supabase URL:           https://zpeedfgyuusscsrirzsg.supabase.co
  MCP Access Key:         c5061efb5c64a3e54aa4d340effd8f446d48d0921b683cef97c771dcf496a672

SUBSTACK CREDENTIALS
  Substack Domain:        natesnewsletter.substack.com (or your target domain)
  Substack Cookie:        substack.sid=s%3A... (obtained from browser)

--------------------------------------
```

## Steps

1. **Install dependencies**
   ```bash
   cd /home/ubuntu/open-brain-v2/recipes/substack-ingestion
   pip install -r requirements.txt
   ```

2. **Get your Substack session cookie**
   - Open your target Substack site in a browser
   - Open Developer Tools (F12) → Application → Cookies → https://your-domain.substack.com
   - Copy the value for "substack.sid" cookie
   - Update the COOKIE variable in `backfill.py`

3. **Run the backfill script**
   ```bash
   # Test run (dry run)
   python3 backfill.py --dry-run
   
   # Backfill all articles since Jan 1, 2026
   python3 backfill.py --start 2026-01-01
   
   # Backfill with custom delay
   python3 backfill.py --delay 5.0
   
   # Skip existing articles (default)
   python3 backfill.py --skip-existing
   ```

## Expected Outcome

- Articles from the target Substack will be captured in your Open Brain v2
- Each article includes: title, content, publication date, source URL, and tags
- Linked GitHub repositories are captured as separate prompts
- Articles can be queried via MCP tools (semantic search, recall, etc.)

## Troubleshooting

**Issue: HTTP 403 Forbidden errors**
- Make sure your Substack cookie is valid and not expired
- Check that you can access the Substack site in your browser

**Issue: Rate limiting (429 errors)**
- Increase the `--delay` parameter value
- The script automatically retries with exponential backoff

**Issue: Empty content extracted**
- Check if the Substack site uses a different content loading method
- Update the _preloads regex pattern if needed

**Issue: JSON-RPC errors**
- Verify your MCP_ACCESS_KEY is correct
- Ensure the Supabase Edge Function is running

**Issue: GitHub prompts not captured**
- Check if GitHub links are properly detected in article content
- Verify you can access the GitHub repositories directly