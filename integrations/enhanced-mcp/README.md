# Enhanced MCP Server

> Production-grade remote MCP server expanding the Open Brain tool surface from 4 to 13 tools with enhanced search, CRUD, enrichment, sensitivity detection, and operational monitoring.

## What It Does

This integration deploys a second MCP server alongside the stock Open Brain server. It adds semantic and full-text search modes, content dedup via SHA-256 fingerprinting, automatic LLM-powered metadata classification, sensitivity detection (restricted content is blocked from cloud capture), and operational monitoring tools that light up when optional schemas are installed.

The original `server/` connector remains untouched and safe to leave connected: the four tools that would otherwise collide (`capture_thought`, `search_thoughts`, `list_thoughts`, `thought_stats`) are namespaced with a `brain_` prefix in this server, so both tool sets can coexist without the model seeing duplicate names.

## Prerequisites

- Working Open Brain setup ([guide](../../docs/01-getting-started.md))
- **Enhanced Thoughts schema applied** — install `schemas/enhanced-thoughts` first (adds type, importance, sensitivity columns and utility RPCs)
- OpenRouter API key (same one from the Getting Started guide)
- Supabase CLI installed for deployment
- Optional: `schemas/smart-ingest` (unlocks `ops_capture_status` tool)
- Optional: `schemas/knowledge-graph` (unlocks `graph_search`, `entity_detail`, `ops_source_monitor` tools)

## Credential Tracker

Copy this block into a text editor and fill it in as you go.

```text
ENHANCED MCP SERVER -- CREDENTIAL TRACKER
------------------------------------------

FROM YOUR OPEN BRAIN SETUP
  Project URL:           ____________
  Service role key:      ____________
  MCP access key:        ____________
  OpenRouter API key:    ____________

OPTIONAL (for multi-provider fallback)
  OpenAI API key:        ____________
  Anthropic API key:     ____________

------------------------------------------
```

## Steps

### 1. Deploy the Edge Function

Copy the `integrations/enhanced-mcp/` folder into your Supabase project's `supabase/functions/` directory, then deploy:

```bash
supabase functions deploy enhanced-mcp --no-verify-jwt
```

### 2. Set Environment Variables

Add your secrets to the deployed function:

```bash
supabase secrets set \
  MCP_ACCESS_KEY="your-access-key" \
  OPENROUTER_API_KEY="your-openrouter-key"
```

Optional multi-provider fallback (for metadata classification resilience):

```bash
supabase secrets set \
  OPENAI_API_KEY="your-openai-key" \
  ANTHROPIC_API_KEY="your-anthropic-key"
```

### 3. Add as a Remote MCP Connector

In Claude Desktop (or any MCP-compatible client), add a new remote connector:

- **Name:** `Open Brain Enhanced`
- **URL:** `https://<your-project-ref>.supabase.co/functions/v1/enhanced-mcp`
- **Header:** `x-brain-key: <your-mcp-access-key>` _(or `Authorization: Bearer <your-mcp-access-key>`)_

Header-only authentication — the access key is NOT accepted as a `?key=` URL query parameter. Query strings surface in Supabase, CDN, and proxy access logs, which leaks the credential into places that don't get rotated with the secret itself. Use the header (or `Authorization: Bearer …`) exclusively.

### 4. Test Core Tools

Verify the enhanced server is working by testing these tools in your AI client:

1. **`brain_capture_thought`** — Save a test thought: "Testing the enhanced MCP server setup"
2. **`brain_search_thoughts`** — Search for "testing" to find the thought you just captured
3. **`brain_thought_stats`** — View your brain's type and topic distribution
4. **`brain_list_thoughts`** — Browse recent thoughts with filters

> The four tools that overlap with the stock server are prefixed with `brain_` in this integration (`brain_capture_thought`, `brain_search_thoughts`, `brain_list_thoughts`, `brain_thought_stats`). That way you can run both servers side by side without the model seeing two tools under the same name. The stock `capture_thought` / `search_thoughts` / `list_thoughts` / `thought_stats` remain available on the original connector; this server adds `brain_*` variants with extended filters, enriched metadata, sensitivity detection, and content-fingerprint dedup.

### 5. Enable Schema-Backed Tools (Optional)

If you have installed optional schemas, these tools activate automatically:

| Tool | Required Schema | What It Does |
|------|----------------|--------------|
| `ops_capture_status` | `schemas/smart-ingest` | Ingestion job health monitoring |
| `graph_search` | `schemas/knowledge-graph` | Search entities by name or type |
| `entity_detail` | `schemas/knowledge-graph` | Full entity profile with connections |
| `ops_source_monitor` | Ops monitoring views | Per-source ingestion monitoring |

If a required schema is not installed, the tool returns a clear message explaining which schema to install.

## Expected Outcome

After completing the steps above, you should have 13 tools available in your AI client under the "Open Brain Enhanced" connector. Running `brain_capture_thought` should save a thought with automatic type classification, topic extraction, and sensitivity detection. Running `brain_search_thoughts` should return results with similarity scores. Running `brain_thought_stats` should show your brain's statistics using server-side aggregation.

If you also have the original `server/` connector active, you will see both tool sets. Thanks to the `brain_` prefix on the four overlapping tools, there are no duplicate tool names — the enhanced versions expose extended filters, sensitivity detection, and content-fingerprint dedup; the stock versions remain the minimal default. You can disable either connector at any time to reduce tool count.

## Tool Reference

| # | Tool | Description | Schema Required |
|---|------|-------------|-----------------|
| 1 | `brain_search_thoughts` | Semantic vector or full-text search with date and metadata filters | Enhanced Thoughts |
| 2 | `brain_list_thoughts` | Paginated browsing with type, source, date filters and sorting | Enhanced Thoughts |
| 3 | `get_thought` | Fetch a single thought by ID with full metadata | Enhanced Thoughts |
| 4 | `update_thought` | Update content with automatic re-embedding and re-classification | Enhanced Thoughts |
| 5 | `brain_capture_thought` | Capture with dedup, sensitivity detection, and LLM classification | Enhanced Thoughts |
| 6 | `brain_thought_stats` | Type and topic statistics via server-side aggregation | Enhanced Thoughts |
| 7 | `search_thoughts_text` | Direct full-text search (faster for exact phrase matching) | Enhanced Thoughts |
| 8 | `count_thoughts` | Fast filtered count without returning content | Enhanced Thoughts |
| 9 | `related_thoughts` | Find thoughts connected by shared topics or people | Enhanced Thoughts |
| 10 | `ops_capture_status` | Ingestion health: job status, error rates, recent failures | Smart Ingest |
| 11 | `graph_search` | Search knowledge graph entities with thought counts | Knowledge Graph |
| 12 | `entity_detail` | Full entity profile: aliases, linked thoughts, relationship edges | Knowledge Graph |
| 13 | `ops_source_monitor` | Per-source ingestion volume, errors, and failure samples | Ops Views |

### Intentionally Excluded From This Release

- **`delete_thought`** is intentionally not included in this initial PR. It requires a `deleted_at` shadow column and a restore workflow to align with the maintainer's "depreciate and version rather than delete" preference (see PR #127 closure). It will ship in a follow-up once that column lands in `schemas/enhanced-thoughts` and a sibling `restore_thought` tool can be published alongside it.

## Known Limitations

- **Semantic search + date filter on dense recent brains.** `brain_search_thoughts` in semantic mode calls the `match_thoughts` RPC, which returns the top-N matches by cosine similarity. Date filtering is applied client-side on top of those results. When the RPC supports pre-cutoff date filtering via its `filter` JSONB payload, the filter is pushed server-side and the behavior is precise; when it doesn't, this integration over-fetches 3× the requested limit (capped at 500) and filters client-side. On brains with very dense recent activity and a restrictive old date window, this may miss relevant old matches ranked below the over-fetch cutoff. Workaround: use `mode: "text"` (full-text search honours date filters at the SQL level) or narrow the query.

## Troubleshooting

**Issue: "Invalid or missing access key" error**
Solution: Ensure your `MCP_ACCESS_KEY` secret is set in Supabase and matches the key in your connector configuration. The key must be passed via the `x-brain-key` header or `Authorization: Bearer …`. Query-string auth (`?key=…`) is intentionally not supported — it would leak the credential into access logs.

**Issue: "No embedding API key configured" error**
Solution: At least one of `OPENROUTER_API_KEY` or `OPENAI_API_KEY` must be set. OpenRouter is the default and recommended provider for OB1.

**Issue: Schema-backed tools return "install required schema" messages**
Solution: This is expected behavior. These tools gracefully degrade when their backing tables are not present. Install the referenced schema contribution and the tools will activate automatically.

**Issue: "match_thoughts" or "brain_stats_aggregate" RPC not found**
Solution: The Enhanced Thoughts schema (`schemas/enhanced-thoughts`) must be applied before deploying this server. It adds the required RPCs and columns.

**Issue: Metadata classification returns fallback results**
Solution: Check that your LLM provider API key is valid and has sufficient quota. The server tries OpenRouter first, then falls back to OpenAI and Anthropic if configured. If all providers fail, it uses safe defaults.

## Tool Surface Area

This integration adds up to 13 tools to your AI's context. If you are managing multiple connectors, review the [MCP Tool Audit & Optimization Guide](../../docs/05-tool-audit.md) for strategies on keeping your tool count manageable as your Open Brain grows.
