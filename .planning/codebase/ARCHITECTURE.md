# Architecture

**Analysis Date:** 2026-03-13

## Pattern Overview

**Overall:** Extensible, modular knowledge system built on a core Supabase database with specialized MCP servers and community-driven addons.

**Key Characteristics:**
- Core single-source-of-truth: `thoughts` table in Supabase with pgvector embeddings
- Remote MCP servers deployed as Supabase Edge Functions (no local Node.js servers)
- Modular extensions that add domain-specific tables and MCP tools
- Progressive learning path: 6 extensions building on each other
- Community contributions follow strict templates and automated review
- Query param-based auth (`?key=MCP_ACCESS_KEY`) for MCP endpoints

## Layers

**Core (Not in this repo):**
- Purpose: Foundational Open Brain system with `thoughts` table, vector search, metadata extraction
- Location: Upstream Supabase project (`piigyjxxzrivwvupefsc`)
- Contains: Base MCP tools (`capture_thought`, `search_thoughts`, `list_thoughts`, `thought_stats`), pgvector setup, RLS policies
- Depends on: Supabase with PostgreSQL + pgvector extension
- Used by: All extensions, recipes, schemas, and integrations

**Extensions Layer:**
- Purpose: Curated, progressive 6-step learning path that teaches concepts through practical builds
- Location: `extensions/` directory (e.g., `extensions/household-knowledge/`, `extensions/meal-planning/`)
- Contains: Database schemas (`schema.sql`), TypeScript MCP servers (`index.ts`), shared servers (`shared-server.ts`), README with step-by-step instructions
- Depends on: Core Open Brain setup, Supabase CLI, sometimes primitives (RLS, shared MCP)
- Used by: Learners building their first Open Brain features; subsequent extensions reference earlier ones

**Primitives Layer:**
- Purpose: Reusable concept guides extracted from multiple extensions (teach once, link many times)
- Location: `primitives/` directory (e.g., `primitives/rls/`, `primitives/shared-mcp/`)
- Contains: Detailed README guides explaining a pattern, prerequisites, step-by-step walkthrough, troubleshooting
- Depends on: PostgreSQL / Supabase knowledge base
- Used by: Extensions and recipes that need the same pattern (RLS, deployment, troubleshooting)

**Recipes Layer:**
- Purpose: Standalone capability adds (not part of learning path, no ordering)
- Location: `recipes/` directory (e.g., `recipes/email-history-import/`, `recipes/source-filtering/`)
- Contains: Implementation code (TypeScript, Python, SQL), README with instructions, `metadata.json`
- Depends on: Working Open Brain setup, possibly external APIs (Gmail, ChatGPT, etc.)
- Used by: Users adding specific capabilities (import data, filter sources, etc.)

**Schemas Layer:**
- Purpose: Database table extensions and metadata schemas (new tables, not modifications to existing ones)
- Location: `schemas/` directory (e.g., `schemas/crm-contacts/`)
- Contains: SQL migration files, README with setup steps, `metadata.json`
- Depends on: Supabase SQL Editor access
- Used by: Users extending the database with domain-specific tables (contacts, interactions, etc.)

**Dashboards Layer:**
- Purpose: Frontend templates for visualizing and interacting with Open Brain data
- Location: `dashboards/` directory
- Contains: React/Next.js code, `package.json`, environment configuration, deployment instructions, README
- Depends on: Supabase anon key (public-facing frontend), Vercel/Netlify hosting
- Used by: Users who want a web UI for their Open Brain

**Integrations Layer:**
- Purpose: Capture sources and external service connections (MCP extensions, webhooks, bots)
- Location: `integrations/` directory (e.g., `integrations/discord-capture/`, `integrations/slack-capture/`)
- Contains: Edge Function code, bot code, webhook handlers, README, `metadata.json`
- Depends on: External service credentials (Discord token, Slack token, etc.)
- Used by: Users connecting new capture sources or building API bridges

**Documentation Layer:**
- Purpose: Setup guides, FAQ, companion prompts, and AI-assisted setup
- Location: `docs/` directory (e.g., `docs/01-getting-started.md`, `docs/03-faq.md`)
- Contains: Markdown guides, tutorial walkthroughs, troubleshooting, decision trees
- Depends on: None (pure documentation)
- Used by: Onboarding users, answering common questions, guiding first-time setup

**Companion Resources:**
- Purpose: Pre-built Claude Skills, ChatGPT Custom GPTs, Gemini GEMs for AI tool integration
- Location: `resources/` directory
- Contains: Skill files, prompts, configuration
- Depends on: None (pre-built and hosted externally)
- Used by: Users adding Open Brain to their existing AI workflows

## Data Flow

**Capture Flow (Thoughts written):**

1. User captures content (via MCP tool, Slack integration, email import, ChatGPT export)
2. Content arrives at Supabase with `capture_thought` MCP tool or webhook endpoint
3. Raw text is embedded via OpenRouter (`text-embedding-3-small`, 1536 dimensions)
4. Metadata is extracted via OpenRouter LLM (`gpt-4o-mini`)
5. Thought record created in `thoughts` table with vector embedding, metadata JSONB
6. RLS policy ensures user isolation
7. Thought is now searchable and accessible to all connected MCP clients

**Search Flow (Thoughts read):**

1. AI client calls `search_thoughts` MCP tool with query text
2. Query is embedded via OpenRouter API
3. HNSW vector search finds similar thoughts (default similarity threshold 0.1)
4. Results include thought text, metadata, embedding distance
5. Metadata can be filtered by source, timestamp, people, sentiment, etc.
6. Caller optionally applies further filters on returned results

**Extension Add Flow (New domain tables):**

1. User runs `schema.sql` migration in Supabase SQL Editor
2. New tables created with RLS policies matching `thoughts` pattern
3. User deploys extension's MCP server as Supabase Edge Function
4. Extension MCP server initialized with Supabase credentials via environment variables
5. Auth happens via query param (`?key=MCP_ACCESS_KEY`) checked against `Deno.env.get("MCP_ACCESS_KEY")`
6. Extension MCP server connects to both core `thoughts` table and new domain tables
7. Tools in extension can cross-reference `thoughts` (e.g., CRM contacts linked to captured interactions)

**Metadata (JSONB) in thoughts table:**

```
{
  "source": "mcp" | "gmail" | "chatgpt" | "obsidian" | etc,
  "type": string (e.g., "fact", "conversation", "idea", "reference"),
  "topics": [string],  // Auto-extracted topics
  "people": [string],   // People mentioned
  "sentiment": "positive" | "neutral" | "negative",
  "created_by": string,  // Tool or source that created it
  "original_url": string (optional),
  "tags": [string] (user-supplied)
}
```

**State Management:**

- Single Supabase project holds all state (thoughts, extension tables, metadata)
- Vector embeddings are immutable (recomputing them is expensive)
- RLS policies enforce user isolation at database level
- Shared MCP servers create scoped credentials with restricted table/operation access (separate from core)
- No client-side state persistence across sessions (everything is database-backed)

## Key Abstractions

**MCP Server:**
- Purpose: Standardized interface for AI tools to interact with Open Brain
- Examples: `extensions/household-knowledge/index.ts`, `extensions/meal-planning/index.ts`, `integrations/discord-capture/` (webhook-based)
- Pattern: Hono web framework + `@modelcontextprotocol/sdk` + `@hono/mcp` StreamableHTTPTransport
- Transport: HTTPS with query param auth (`?key=...`)
- Deployed as: Supabase Edge Function (no local Node.js servers)

**Schema:**
- Purpose: Define domain-specific tables and relationships
- Examples: `extensions/household-knowledge/schema.sql`, `schemas/crm-contacts/001_create_contacts.sql`
- Pattern: PostgreSQL DDL with RLS policies, foreign keys to `auth.users`, JSONB metadata columns, appropriate indexes
- Versioning: Multiple migration files per schema (e.g., `001_create_contacts.sql`, `002_create_interactions.sql`)
- Deployment: User manually runs in Supabase SQL Editor

**Tool:**
- Purpose: Individual RPC-style function exposed by an MCP server
- Examples: `add_household_item`, `search_recipes`, `add_professional_contact`, `search_thoughts`
- Pattern: Takes typed input (validated with Zod), returns `{ content: [{ type: "text", text: JSON.stringify(...) }] }`
- Auth: Inherited from parent MCP server's key validation
- Error handling: Try-catch wrapping Supabase calls, return error objects

**Metadata (JSONB):**
- Purpose: Flexible, query-able structured data on thoughts and domain tables
- Pattern: JSON object stored in JSONB column, queryable with PostgreSQL operators (`->`, `->>`)
- Examples: `metadata->>'source'`, `details->'model'`, `tags` arrays
- Benefit: Can add new fields without migrations; can aggregate/filter via SQL

**Shared MCP Server (Primitive):**
- Purpose: Create scoped access to parts of your brain for other people
- Implementation: Separate database role with limited permissions, separate MCP server pointing to that role
- Security layers: Different API key, RLS policies restricting table/operation access, read-only vs read-write control
- Examples: Meal planning shared with spouse (recipes read-only, shopping list read-write)

**Thought (Core):**
- Purpose: Canonical unit of stored knowledge
- Schema: `id`, `content` (text), `embedding` (vector), `metadata` (jsonb), `created_at`, `user_id`, etc.
- Queryable by: Vector similarity, metadata filters, full-text search (ILike)
- Accessed by: All MCP servers, search tools, extensions, recipes, integrations

## Entry Points

**Core MCP Endpoint (upstream, not in this repo):**
- Location: Supabase Edge Function running the canonical Open Brain MCP server
- Triggers: Any MCP client making a JSON-RPC 2.0 call to the function URL
- Responsibilities: Route calls to `capture_thought`, `search_thoughts`, `list_thoughts`, `thought_stats`, any extension tools registered in same function

**Extension MCP Endpoint:**
- Location: `extensions/{extension-name}/index.ts` deployed as Supabase Edge Function
- Triggers: MCP client calling `POST /mcp?key=...` with JSON-RPC payload
- Responsibilities: Expose domain-specific tools (add_recipe, search_recipes, add_contact, etc.), manage extension tables, optionally cross-reference core `thoughts`

**Recipe Entry Points:**
- **Python scripts** (`recipes/chatgpt-conversation-import/import-chatgpt.py`): CLI tool, user-invoked locally
- **TypeScript/Deno scripts** (`recipes/source-filtering/backfill-metadata.ts`): Deno-based utility, user-invoked locally
- Triggers: User runs script with command-line args and environment variables
- Responsibilities: Import external data, transform it, validate, write to Supabase

**Schema Entry Points:**
- Location: SQL files in `schemas/{schema-name}/` (e.g., `001_create_contacts.sql`)
- Triggers: User manually pastes SQL into Supabase SQL Editor and clicks Run
- Responsibilities: Create tables, indexes, RLS policies, triggers, sample data (optional)

**Dashboard Entry Points:**
- Location: Frontend app (React/Next.js) in `dashboards/{dashboard-name}/`
- Triggers: User navigates to deployed URL or localhost
- Responsibilities: Display Open Brain data, provide UI for adding/editing/searching, handle authentication
- Auth: Uses Supabase anon key (public, scoped by RLS to user's own data)

**Integration Entry Points:**
- **Webhook receivers** (e.g., Discord capture): Deployed Edge Function listening for incoming messages
- **CLI tools**: User-invoked scripts to sync external data
- **Bots**: Long-running processes monitoring channels/APIs
- Triggers: External service event (Discord message, Slack message, email) or user-triggered sync
- Responsibilities: Validate source, transform data, call `capture_thought` or schema insert

## Error Handling

**Strategy:** Client-side error reporting with consistent JSON response format; validation errors bubble to caller; database constraint errors are descriptive.

**Patterns:**

**MCP Tool Errors:**
```typescript
try {
  const { data, error } = await supabase.from("table").insert({...}).select().single();
  if (error) throw error;
  return { content: [{ type: "text", text: JSON.stringify(data) }] };
} catch (e) {
  return { content: [{ type: "text", text: `Error: ${e.message}` }] };
}
```

**Input Validation (Zod):**
```typescript
server.tool(
  "add_recipe",
  "...",
  {
    name: z.string().describe("Recipe name"),
    prep_time: z.number().optional().describe("Minutes"),
  },
  async (args) => { ... }
);
```
Zod validates before tool invocation; invalid inputs return 400 before the async handler runs.

**Auth Errors:**
```typescript
const key = c.req.query("key") || c.req.header("x-access-key");
const expected = Deno.env.get("MCP_ACCESS_KEY");
if (!key || key !== expected) {
  return c.json({ error: "Unauthorized" }, 401);
}
```

**Database Constraint Errors:**
- Foreign key violations (e.g., contact_id references non-existent contact): Caught and returned as error message
- RLS policy violations: PostgreSQL returns "new row violates row-level security policy" — tool catches and reports
- Unique constraint violations: Tool catches and reports duplicate attempt

## Cross-Cutting Concerns

**Logging:**
- Approach: `console.log()` statements in Edge Functions (visible in Supabase logs)
- Pattern: Log at key decision points (auth checks, data mutations, API calls to external services)
- Example: `console.log("Creating household item for user:", user_id);`
- Aggregation: Supabase dashboard shows logs; not stored in database

**Validation:**
- Approach: Zod schemas on MCP tool inputs; PostgreSQL constraints at database level
- Pattern: Client validates with Zod before executing async handler; database validates at INSERT/UPDATE
- Example: `z.string().email()` for email fields; `CHECK (rating >= 1 AND rating <= 5)` in schema

**Authentication:**
- Approach: Three-level: MCP server level (query param key), database level (RLS policies), API level (external service tokens)
- Pattern: MCP server checks `?key=` against `Deno.env.get("MCP_ACCESS_KEY")` on every request
- Database RLS: `auth.uid()` claims from Supabase auth table (or hardcoded user_id in MCP calls)
- External APIs: OAuth tokens, API keys stored in Supabase secrets or environment variables (never in code)

**Authorization:**
- Approach: Row-Level Security policies on all user-scoped tables
- Pattern: Policies check `auth.uid() = user_id` or similar ownership rules
- Shared MCP servers: Create separate database role with limited table/operation grants
- Default: Deny everything unless explicitly allowed (principle of least privilege)

**Rate Limiting:**
- Approach: Not implemented in this repo; delegated to deployment platform (Supabase) or client-side responsibility
- Pattern: If needed, add logic in MCP server to track requests per key per time window

**Data Consistency:**
- Approach: PostgreSQL ACID properties (transactions), foreign key constraints, NOT NULL constraints
- Pattern: All writes go through MCP tools or direct Supabase inserts; no partial updates
- Example: CRM interaction must reference existing contact; thought must have embedding before being queryable

---

*Architecture analysis: 2026-03-13*
