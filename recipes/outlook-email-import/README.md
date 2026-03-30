# Outlook Email Import

> Import your Outlook email history into Open Brain as searchable, embedded thoughts.

Your email is full of decisions, commitments, and context that your AI has never seen. This recipe connects to Outlook via the Microsoft Graph API, pulls the emails that matter (filtering out receipts, auto-replies, and noise), and loads them into your Open Brain. Once imported, your AI can recall what you said to someone three months ago, find that pricing discussion from last quarter, or surface commitments you forgot about.

## What It Does

Pulls your Outlook email history via the Microsoft Graph API and loads each email into Open Brain as a single thought. The script generates embeddings and extracts metadata (topics, people, action items) via OpenRouter, then inserts directly into Supabase with SHA-256 content fingerprint dedup.

**One email = one thought.** No chunking, no parent/child relationships. This aligns with how the OB1 community handles long content (truncate for embedding, store full content).

## Prerequisites

- Working Open Brain setup ([guide](../../docs/01-getting-started.md))
- Deno runtime installed
- Microsoft 365 account (personal, work, or school)
- Azure AD app registration with Mail.Read permission
- OpenRouter API key (same one from your Open Brain setup)

## Credential Tracker

Copy this block into a text editor and fill it in as you go.

```text
OUTLOOK EMAIL IMPORT -- CREDENTIAL TRACKER
--------------------------------------

FROM YOUR OPEN BRAIN SETUP
  Supabase Project URL:  ____________
  Supabase Service Key:  ____________
  OpenRouter API Key:    ____________

GENERATED DURING SETUP
  Azure AD Application (Client) ID:  ____________
  Azure AD Tenant ID:                ____________  (or "common" for any account)

--------------------------------------
```

## Setup

1. **Register an app in Azure AD:**
   - Go to [portal.azure.com](https://portal.azure.com) > **Azure Active Directory** > **App registrations** > **New registration**
   - Name: `Open Brain Outlook Import` (or whatever you like)
   - Supported account types: pick based on your account (personal, work, or both)
   - Redirect URI: leave blank (not needed for device code flow)
   - Click **Register**

2. **Add Mail.Read permission:**
   - In your app registration, go to **API permissions** > **Add a permission**
   - Select **Microsoft Graph** > **Delegated permissions**
   - Search for `Mail.Read` and add it
   - If using a work/school account, click **Grant admin consent** (or ask your admin)

3. **Enable public client flows:**
   - Go to **Authentication** > scroll to **Advanced settings**
   - Set **Allow public client flows** to **Yes**
   - Click **Save**

4. **Set environment variables:**

   ```bash
   export SUPABASE_URL=https://YOUR_REF.supabase.co
   export SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
   export OPENROUTER_API_KEY=sk-or-v1-your-key
   export MICROSOFT_CLIENT_ID=your-application-client-id
   export MICROSOFT_TENANT_ID=common
   ```

5. **First run — authenticate:**

   ```bash
   deno run --allow-net --allow-read --allow-write --allow-env pull-outlook.ts --dry-run --limit=5
   ```

   This prints a device code and URL. Open the URL in your browser, enter the code, and sign in. Your token is cached in `token.json`.

## Usage

```bash
# Dry run — see what would be imported
deno run --allow-net --allow-read --allow-write --allow-env pull-outlook.ts --dry-run

# Import sent emails from the last 90 days
deno run --allow-net --allow-read --allow-write --allow-env pull-outlook.ts --window=90d --limit=500

# Import only high-importance emails from Inbox
deno run --allow-net --allow-read --allow-write --allow-env pull-outlook.ts --folders=Inbox --importance=high

# Import from multiple folders
deno run --allow-net --allow-read --allow-write --allow-env pull-outlook.ts --folders=Inbox,SentItems --window=30d

# List all mail folders
deno run --allow-net --allow-read --allow-write --allow-env pull-outlook.ts --list-folders
```

### Options

| Flag | Default | Description |
|------|---------|-------------|
| `--window=` | `24h` | Time window: `24h`, `7d`, `30d`, `90d`, `1y`, `all` |
| `--folders=` | `SentItems` | Comma-separated folder names (e.g., `Inbox`, `SentItems`, `Drafts`) |
| `--importance=` | _(no filter)_ | Filter by importance: `high`, `normal`, `low` |
| `--limit=` | `50` | Max emails to process |
| `--dry-run` | off | Preview without ingesting |
| `--list-folders` | off | List all mail folders and exit |
| `--ingest-endpoint` | off | Use `INGEST_URL`/`INGEST_KEY` instead of Supabase direct insert |

### Well-known folder names

You can use these names directly with `--folders=`: `Inbox`, `SentItems`, `Drafts`, `DeletedItems`, `JunkEmail`, `Archive`, `Outbox`. Custom folder names (matching your Outlook display name) also work.

### Ingestion modes

**Default (Supabase direct insert)** — The script generates embeddings and extracts metadata via OpenRouter, then inserts directly into Supabase with content fingerprint dedup. Requires `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `OPENROUTER_API_KEY`. This matches the pattern used by the Gmail import and MCP server.

**`--ingest-endpoint`** — POSTs to a custom Edge Function endpoint that handles embedding and metadata server-side. Requires `INGEST_URL` and `INGEST_KEY`. Use this if you have a custom ingest-thought function deployed.

## How It Works

1. **Authenticate** via Azure AD device code flow (first run) or cached token (subsequent runs)
2. **Fetch** emails from Microsoft Graph API by folder, time window, and optional importance filter
3. **Extract** body (Graph returns HTML or text directly — no base64 decoding needed)
4. **Filter** out noise (no-reply senders, receipts, auto-generated, <10 words)
5. **Deduplicate** via sync-log (tracks Outlook message IDs already imported)
6. **Embed** content via OpenRouter (`text-embedding-3-small`)
7. **Classify** via LLM (topics, type, people, action items)
8. **Upsert** into Supabase with SHA-256 [content fingerprint](../../primitives/content-fingerprint-dedup/README.md) — re-running produces zero duplicates

### What gets filtered out

- Auto-generated emails (receipts, confirmations, password resets)
- No-reply / notification senders (including Microsoft system senders)
- Emails with <10 words after cleanup
- Quoted replies and email signatures are stripped before ingestion

## Expected Outcome

Each imported email becomes one row in the `thoughts` table:
- `content`: Email body with context prefix (`[Email from X | Subject: Y | Date: Z]`)
- `embedding`: 1536-dim vector for semantic search (truncated to 8K chars)
- `metadata`: LLM-extracted topics, type, people, action items, plus `source: "outlook"`, `outlook_id`, `outlook_folders`, `outlook_conversation_id`, `outlook_importance`
- `content_fingerprint`: Normalized SHA-256 hash for dedup (see [content fingerprint primitive](../../primitives/content-fingerprint-dedup/README.md))

## Troubleshooting

**Device code flow fails:** Make sure "Allow public client flows" is set to "Yes" in your app registration under Authentication > Advanced settings.

**403 Forbidden from Graph API:** The `Mail.Read` permission hasn't been granted. For work/school accounts, an admin may need to grant consent. Check API permissions in your app registration.

**No thoughts appear:** Check that `SUPABASE_SERVICE_ROLE_KEY` is your service role key (not the anon key). RLS blocks anon inserts.

**Re-running imports the same emails:** The `sync-log.json` file tracks imported Outlook message IDs. Delete it to re-import everything. Content fingerprints provide a second layer of dedup at the database level.

**Token refresh fails:** Delete `token.json` and re-run to trigger a fresh device code authentication.

**Embedding/metadata errors:** Verify your `OPENROUTER_API_KEY` has credits. The script calls OpenRouter for both embedding generation and metadata extraction.
