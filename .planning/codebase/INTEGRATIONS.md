# External Integrations

**Analysis Date:** 2026-03-13

## APIs & External Services

**OpenRouter (LLM & Embeddings):**
- Service: OpenRouter universal AI gateway
  - Summarization & metadata extraction: `gpt-4o-mini` model
  - Vector embeddings: `text-embedding-3-small` (1536 dimensions)
  - Alternative local LLM: Ollama (supported for summarization in ChatGPT importer, not embeddings)
- SDK/Client: HTTP REST API via fetch
- Auth: Bearer token via `OPENROUTER_API_KEY` environment variable
- Cost: ~$0.15/million input tokens (gpt-4o-mini), ~$0.02/million tokens (embeddings)
- Usage locations:
  - `recipes/chatgpt-conversation-import/import-chatgpt.py` — LLM summarization and embeddings
  - `recipes/source-filtering/backfill-metadata.ts` — Metadata extraction via LLM
  - `integrations/slack-capture/` — Embedding and metadata extraction
  - All Edge Function extensions — metadata extraction during capture

**Slack Workspace Integration:**
- Service: Slack workspace for message capture
- Connection: Slack Bot OAuth with App integration
- Auth: Bot User OAuth Token (`xoxb-*`) via `SLACK_BOT_TOKEN` env var
- Scopes required: `channels:history`, `groups:history`, `chat:write`
- Webhook: Edge Function receives `message.channels` and `message.groups` events
- Callback: Function replies in thread with extracted metadata
- Location: `integrations/slack-capture/`

**Discord Server Integration:**
- Service: Discord server for message capture
- Status: Integration template exists, specific implementation not shown
- Location: `integrations/discord-capture/`

## Data Storage

**Databases:**
- PostgreSQL 14+ (Supabase managed)
  - Vector extension: pgvector (HNSW indexes for similarity search)
  - Primary table: `thoughts` — content, embedding (1536 dims), metadata (jsonb), timestamps
  - Extended tables: `household_items`, `household_vendors`, `contacts`, `contact_interactions`, `home_maintenance_logs`, etc.
- Connection: Supabase PostgreSQL service via `SUPABASE_URL`
- Client: `@supabase/supabase-js` SDK (replicated across all extensions)
- Auth: Service role key (`SUPABASE_SERVICE_ROLE_KEY`) for RLS bypass in Edge Functions

**File Storage:**
- ChatGPT data export: ZIP file upload (local filesystem, parsed into `conversations.json`)
- Gmail archive: OAuth-driven API access (no local storage)
- No cloud file storage service (S3, GCS, etc.) detected

**Caching:**
- None detected (queries hit Supabase every time)
- Embedding vectors stored in DB, not cached in-process

## Authentication & Identity

**Auth Provider:**
- Supabase Auth (PostgreSQL-backed)
  - User sessions managed by `auth.users` table
  - RLS policies enforce user_id-scoped data access
- Gmail OAuth 2.0 (external, for email import)
  - Client ID/Secret from Google Cloud project
  - Three-legged flow: user authorizes, receives token
- Slack Bot Auth: OAuth token issued by Slack workspace
- OpenRouter: API key-based authentication

**Access Control:**
- Row Level Security (RLS) on `thoughts` table and related tables
- Service role key used in Edge Functions to bypass RLS (intended — MCP server is trusted)
- Query parameter auth in MCP endpoint: `?key=` parameter with `MCP_ACCESS_KEY`
- No JWT-based verification on MCP endpoints (custom key auth instead)

## Monitoring & Observability

**Error Tracking:**
- None detected (no Sentry, Datadog, etc.)

**Logs:**
- Supabase Edge Function logs available in dashboard
- Console.error() calls in Edge Function code for debugging
- Sync logs: `chatgpt-sync-log.json` tracks which conversations have been imported

**Database Metrics:**
- Supabase dashboard provides query performance, connection stats
- Manually run SQL queries to inspect import progress (e.g., `SELECT COUNT(*) FROM thoughts`)

## CI/CD & Deployment

**Hosting:**
- Supabase (PostgreSQL database) — cloud-hosted, free tier available
- Supabase Edge Functions — serverless Deno runtime, auto-deploys via CLI

**CI Pipeline:**
- No GitHub Actions workflows detected for automated testing
- Manual deployment via `supabase functions deploy` CLI command
- GitHub PR template mentions automated review checks in `.github/workflows/ob1-review.yml` (OSS community contribution validation)

**Deployment Process:**
- Extensions: Deploy as Edge Functions to Supabase
  ```bash
  supabase functions deploy <function-name> --no-verify-jwt
  ```
- Recipes (Python import scripts): Run locally against remote Supabase database
- Integrations: Deploy Edge Function + configure webhook (e.g., Slack events → Edge Function URL)

## Environment Configuration

**Required env vars (Edge Functions):**
- `SUPABASE_URL` — Supabase project URL (auto-available in Edge Functions)
- `SUPABASE_SERVICE_ROLE_KEY` — Bypass RLS (auto-available in Edge Functions)
- `OPENROUTER_API_KEY` — LLM and embedding requests
- `MCP_ACCESS_KEY` — Authentication for MCP endpoint (query param or header)
- Integration-specific: `SLACK_BOT_TOKEN`, `SLACK_CAPTURE_CHANNEL`

**Required env vars (Local scripts):**
- Python ChatGPT importer: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `OPENROUTER_API_KEY`
- Source filtering backfill: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `OPENROUTER_API_KEY`
- Gmail importer: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, plus Google OAuth credentials

**Secrets location:**
- Supabase CLI stores secrets in `.env.local` (not committed)
- Deployed Edge Functions access via `Deno.env.get()`
- `.env.example` files document required variables for each recipe/integration

## Webhooks & Callbacks

**Incoming Webhooks:**
- Slack: Edge Function URL (`https://YOUR_PROJECT_REF.supabase.co/functions/v1/ingest-thought`)
  - Event types: `message.channels`, `message.groups`
  - Request validation: Slack includes timestamp and signature headers
  - Response requirement: Must respond with 200 OK within 3 seconds (or Slack retries)

**Outgoing Webhooks:**
- Slack bot replies via `chat.postMessage` API (threaded confirmation after capture)
- No outgoing webhooks to external services detected

## External Data Sources

**ChatGPT Data Export:**
- Format: ZIP file containing `conversations.json` (or sharded `conversations-000.json`, etc.)
- Source: User's ChatGPT account Settings → Data Controls → Export Data
- Processing: `recipes/chatgpt-conversation-import/import-chatgpt.py` filters, summarizes, embeds
- Metadata extracted: title, date, URL, conversation ID

**Gmail Archive:**
- Source: Gmail API (requires OAuth)
- Processing: `recipes/email-history-import/` (partially documented, marked TODO)
- Metadata extracted: sender, subject, date, labels

**Slack Message Feed:**
- Source: Slack workspace capture channel
- Processing: Real-time via webhook (message.channels/message.groups events)
- Metadata extracted: user, channel, thread timestamp, message text

## Rate Limiting & Quotas

**OpenRouter API:**
- Default rate limits: typically 60 req/min for embeddings, variable for LLM calls
- ChatGPT importer: Built-in batching to respect limits
- Source filtering backfill: Default batch size of 10 concurrent requests with 500ms pause between batches
- Slack capture: Per-message cost (5-10 seconds per capture due to OpenRouter latency)

**Supabase:**
- Free tier: 50,000 monthly active users, unlimited database, 2GB file storage, 50MB function deployment
- RLS policies enforce data isolation

**Slack:**
- Event delivery: Slack retries failed deliveries up to 3 times (edge case: duplicate inserts if function takes >3 seconds)
- Rate limits: Varies per API endpoint

**Gmail API:**
- User-specific rate limits; typically 250,000 queries/day for a single project

## Data Flow

**Capture Pipeline (Slack example):**
1. User posts message in Slack capture channel
2. Slack fires `message.channels` or `message.groups` event to Edge Function webhook
3. Edge Function receives event, extracts message text
4. Parallel calls:
   - OpenRouter: Generates embedding (text-embedding-3-small)
   - OpenRouter: Extracts metadata (gpt-4o-mini)
5. Both results inserted into `thoughts` table via Supabase client
6. Edge Function calls Slack API to post confirmation in thread
7. Result visible in Supabase dashboard and searchable via MCP

**Search Pipeline:**
1. AI client (Claude Desktop, ChatGPT, etc.) calls MCP endpoint with search query
2. MCP endpoint receives request, validates `MCP_ACCESS_KEY`
3. MCP tool generates embedding for query text via OpenRouter
4. Supabase `match_thoughts()` function runs vector similarity search (HNSW index)
5. Results returned to AI client with content, metadata, similarity scores

## Import Pipelines

**ChatGPT Importer:**
1. User exports ChatGPT data (ZIP file)
2. Script extracts `conversations.json` (or shards)
3. Three-stage pipeline:
   - **Filter:** Remove trivial conversations (<4 messages, title patterns, etc.)
   - **Summarize:** LLM distills each surviving conversation into 1-3 standalone thoughts
   - **Ingest:** Each thought gets embedding + metadata, inserted into Supabase
4. Deduplication via sync log (`chatgpt-sync-log.json`) — tracks conversation hashes

**Gmail Importer:**
1. User authenticates via Google OAuth
2. Script fetches emails via Gmail API
3. Each email: content + metadata (sender, subject, date, labels) embedded
4. Results inserted into `thoughts` table with `source: "gmail"` metadata

**Source Filtering Backfill:**
1. Script queries `thoughts` where `metadata->>'type' IS NULL`
2. For each thought: LLM extracts metadata (type, topics, people, sentiment, action_items)
3. Results batched and updated in place

---

*Integration audit: 2026-03-13*
