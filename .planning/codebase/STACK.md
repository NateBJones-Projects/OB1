# Technology Stack

**Analysis Date:** 2026-03-13

## Languages

**Primary:**
- TypeScript — MCP server extensions, Edge Functions, utilities
- Python 3.10+ — Data import scripts (ChatGPT, Gmail)
- SQL/PostgreSQL — Database schema, migrations, functions, triggers

**Secondary:**
- JavaScript/Shell — Build scripts, CLI tools

## Runtime

**Environment:**
- Deno 1.40+ — Runtime for TypeScript/JavaScript Edge Functions and scripts
- Node.js 18+ — Alternative for some import scripts (referenced in email-history-import)

**Package Manager:**
- deno.json — Deno package configuration (implicit for Edge Functions)
- pip — Python package manager for import scripts
- No npm/yarn (Deno projects use import maps, not node_modules)

## Frameworks

**Core:**
- Hono — HTTP framework for Edge Functions (used in all MCP servers)
  - `@hono/mcp` — Supabase Edge Function MCP transport layer
- PostgreSQL 14+ — Vector database (pgvector extension enabled)
- Supabase — Backend-as-a-service platform (database, Edge Functions, REST API, Auth)

**API & MCP:**
- `@modelcontextprotocol/sdk` — MCP server implementation for AI tool integration
- StreamableHTTPTransport — Hono-based MCP transport protocol

**Testing:**
- No automated test framework detected (testing happens via manual curl/SQL verification)

**Build/Dev:**
- Supabase CLI — Local development, migrations, Edge Function deployment
- deno cli — Direct TypeScript execution without build step

## Key Dependencies

**Critical:**
- `@supabase/supabase-js` — Supabase client library (all TypeScript code)
- `@modelcontextprotocol/sdk` — MCP protocol implementation (all extensions)
- Zod — Schema validation for MCP tool parameters (all extensions)

**Infrastructure:**
- `hono` — Web framework for Edge Function routing and request handling
- `@hono/mcp` — MCP transport adapter for Hono
- pgvector — PostgreSQL vector similarity search extension
- requests (Python) — HTTP library for import scripts (ChatGPT importer)

**Data & Embedding:**
- No local embedding library (uses OpenRouter API for embeddings via HTTP)
- No in-process LLM (all LLM calls go through OpenRouter)

## Configuration

**Environment:**
- `.env.example` files in each recipe/integration (no actual `.env` files committed)
- Environment variables set via Supabase CLI secrets for Edge Functions
- Credentials managed through Deno.env.get() calls
- OpenRouter API key required globally
- Supabase service role key required (RLS bypass for MCP operations)

**Build:**
- No build step for Deno-based code (runs TypeScript directly)
- Supabase migrations: SQL files in `/migrations` (not present in this repo, assumed to be managed in main Open Brain project)
- Edge Function deployment via `supabase functions deploy`

## Platform Requirements

**Development:**
- Deno 1.40+ installed and in PATH
- Supabase CLI installed and configured
- Text editor or IDE (no specific IDE requirements)
- Terminal/command line access
- For Python imports: Python 3.10+ with pip

**Production:**
- Supabase project (cloud-hosted, free tier available)
- OpenRouter account with API key and credits
- Custom MCP connector URL for each AI client (Claude Desktop, ChatGPT, etc.)
- Slack workspace (for slack-capture integration only)
- Discord server (for discord-capture integration only)

## Architecture Patterns

**Serverless:**
- All code runs as Supabase Edge Functions (Deno runtime)
- No local servers or process management
- Auto-scaling, pay-per-invocation model
- Cold starts acceptable for document ingestion (no real-time requirements)

**Stateless:**
- Edge Functions are stateless
- All state stored in Supabase PostgreSQL
- No in-memory caches or session stores

**Protocol:**
- MCP (Model Context Protocol) for AI tool communication
- HTTP/HTTPS for Slack webhooks and API calls
- REST for Supabase queries (via SDK client)
- JSON-RPC 2.0 for MCP tool calls

## Dependencies Summary

| Category | Tool | Version | Purpose |
|----------|------|---------|---------|
| Runtime | Deno | 1.40+ | TypeScript/JS execution |
| Runtime | PostgreSQL | 14+ | Vector database |
| Framework | Hono | latest | HTTP routing in Edge Functions |
| Framework | Supabase | cloud | Backend infrastructure |
| SDK | @supabase/supabase-js | v2 | Database client |
| SDK | @modelcontextprotocol/sdk | latest | MCP implementation |
| SDK | @hono/mcp | latest | MCP transport |
| Validation | zod | latest | Schema validation |
| Extension | pgvector | latest | PostgreSQL vector search |
| Python | requests | >=2.28 | HTTP for import scripts |

---

*Stack analysis: 2026-03-13*
