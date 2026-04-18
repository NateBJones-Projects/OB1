# REST API Gateway

> Documented REST gateway for non-MCP clients, dashboards, webhooks, and custom integrations with CORS support and full CRUD plus search, ingest, and entity endpoints.

## What It Does

Provides a standard REST API alongside the MCP server for clients that cannot use the Model Context Protocol. This includes browser-based dashboards, ChatGPT Actions, Gemini extensions, webhook receivers, and any HTTP client.

All endpoints share the same authentication, sensitivity filtering, and enrichment pipeline as the MCP server. CORS is enabled for browser and Electron clients.

**Available endpoints:**

| Method | Path | Description |
|--------|------|-------------|
| POST | `/search` | Semantic or full-text search |
| POST | `/capture` | Create a new thought |
| GET | `/recent` | Recent thoughts (paginated) |
| GET | `/thoughts` | Browse with filters and pagination |
| GET | `/thought/:id` | Get a single thought |
| PUT | `/thought/:id` | Update thought content |
| PATCH | `/thought/:id/enrich` | Re-enrich a thought |
| DELETE | `/thought/:id` | Delete a thought |
| GET | `/thought/:id/connections` | Related thoughts |
| GET | `/count` | Count thoughts with filters |
| GET | `/stats` | Brain stats summary |
| POST | `/ingest` | Proxy to smart-ingest function |
| GET | `/ingestion-jobs` | List ingestion jobs |
| GET | `/ingestion-jobs/:id` | Get job detail with items |
| POST | `/ingestion-jobs/:id/execute` | Execute a dry-run job |
| GET | `/duplicates` | Find near-duplicate pairs |
| POST | `/duplicates/resolve` | Merge and resolve a duplicate pair |
| GET | `/entities` | Browse/search entities |
| GET | `/entities/:id` | Entity detail with thoughts and edges |
| GET | `/health` | Health check |

## Prerequisites

- Working Open Brain setup ([guide](../../docs/01-getting-started.md))
- **Enhanced thoughts schema** applied — install `schemas/enhanced-thoughts` (required for all endpoints)
- At least one LLM API key: OpenRouter (recommended), OpenAI, or Anthropic (for search embeddings and capture classification)
- Supabase CLI installed for deployment
- Optional: `schemas/smart-ingest-tables` (for `/ingest` and `/ingestion-jobs` endpoints)
- Optional: `schemas/knowledge-graph` (for `/entities` endpoints and `/duplicates/resolve` entity reattachment)

## Steps

### 1. Deploy the Edge Function

Copy the `integrations/rest-api/` folder into your Supabase project's `supabase/functions/` directory, then deploy:

```bash
supabase functions deploy rest-api --no-verify-jwt
```

### 2. Set Environment Variables

```bash
supabase secrets set \
  MCP_ACCESS_KEY="your-access-key" \
  OPENROUTER_API_KEY="your-openrouter-key"
```

### 3. Test the Health Endpoint

```bash
curl "https://<your-project-ref>.supabase.co/functions/v1/rest-api/health?key=your-access-key"
```

Expected response:

```json
{ "ok": true, "service": "open-brain-rest", "timestamp": "2026-04-06T..." }
```

### 4. Test Search

```bash
curl -X POST "https://<your-project-ref>.supabase.co/functions/v1/rest-api/search" \
  -H "Content-Type: application/json" \
  -H "x-brain-key: your-access-key" \
  -d '{ "query": "project decisions", "mode": "semantic", "limit": 5 }'
```

### 5. Test Capture

```bash
curl -X POST "https://<your-project-ref>.supabase.co/functions/v1/rest-api/capture" \
  -H "Content-Type: application/json" \
  -H "x-brain-key: your-access-key" \
  -d '{ "content": "Decided to use PostgreSQL for the new project because of pgvector support.", "source": "rest_test" }'
```

## Authentication

All requests require authentication via one of:
- Query parameter: `?key=your-access-key`
- Header: `x-brain-key: your-access-key`
- Header: `Authorization: Bearer your-access-key`

Key comparison uses constant-time byte-wise equality to prevent
timing-based key discovery.

## Security

This function is deployed with `--no-verify-jwt`, which means
`MCP_ACCESS_KEY` is the only authentication layer. Additional hardening
is controlled by two env vars:

### CORS

| Env var | Default | Notes |
|---------|---------|-------|
| `CORS_ALLOWED_ORIGINS` | unset (`*`) | Comma-separated origin allowlist. When unset the gateway responds with `Access-Control-Allow-Origin: *` for backward compatibility. |

**Warning:** `*` combined with write methods (`POST`, `PUT`, `PATCH`,
`DELETE`) is unsafe for production. Any webpage a victim visits can
attempt a cross-origin write if it can obtain the key from another
channel. Set `CORS_ALLOWED_ORIGINS` to your dashboard origin(s):

```bash
supabase secrets set CORS_ALLOWED_ORIGINS="https://brain.example.com,https://dashboard.example.com"
```

### Rate Limiting

| Env var | Default | Notes |
|---------|---------|-------|
| `RATE_LIMIT_PER_MIN` | `100` | Per-key request cap per rolling 60-second window. Returns `429` with `Retry-After` when exceeded. |

State is kept in-memory per Edge Function instance, so the limit resets
on cold start. This is sufficient to block naive burn attacks against a
leaked key; it is not a replacement for a durable token-bucket. If you
expect high volume or need durability across cold starts, swap the
in-memory Map in `index.ts` for `Deno.KV` or a Postgres-backed bucket.

Keys are SHA-256-hashed before being used as bucket identifiers so raw
keys never touch log output.

## How It Connects to Other Components

The REST API uses the same `_shared/` helpers as the Enhanced MCP Server (`integrations/enhanced-mcp`), ensuring consistent behavior for search, capture, and enrichment. The `/ingest` endpoints proxy to the Smart Ingest Edge Function (`integrations/smart-ingest`).

For guidance on managing tool count and token overhead when running multiple integrations, see the [tool audit guide](../../docs/05-tool-audit.md).

## Expected Outcome

After completing setup, you should be able to:

1. Query the `/health` endpoint and receive a success response
2. Search thoughts via `/search` (both semantic and text modes)
3. Capture new thoughts via `/capture` with automatic enrichment
4. Browse and filter thoughts via `/thoughts` with pagination
5. Get, update, and delete individual thoughts
6. View brain statistics via `/stats`

## Troubleshooting

**"Service misconfigured: auth key not set"**
`MCP_ACCESS_KEY` is not set in Supabase secrets. Run `supabase secrets set MCP_ACCESS_KEY="your-key"`.

**"search failed" on semantic search**
No embedding API key configured. The search endpoint needs `OPENROUTER_API_KEY` or `OPENAI_API_KEY` to generate query embeddings.

**"/ingest" returns connection errors**
The smart-ingest Edge Function (`integrations/smart-ingest`) must be deployed separately. The REST API proxies to it via internal HTTP call.

**"/entities" returns empty or errors**
The knowledge graph schema (`schemas/knowledge-graph`) must be applied first. Without it, entity endpoints will fail with table-not-found errors.

**CORS errors from browser**
If `CORS_ALLOWED_ORIGINS` is unset, the gateway responds with `*` for backward
compatibility. If it is set, confirm your browser's `Origin` header matches
one of the allowlisted origins exactly (scheme + host + port). Also check
that your Supabase project allows Edge Function CORS headers.

**429 rate_limited**
Requests from a single key exceeded `RATE_LIMIT_PER_MIN` (default 100) in a
rolling 60-second window. Honor the `Retry-After` response header or raise
the limit via `supabase secrets set RATE_LIMIT_PER_MIN="300"`.
