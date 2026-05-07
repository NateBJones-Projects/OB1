# Open Brain v2 — Setup Guide

Follow Nate's [getting-started guide](docs/01-getting-started.md) for Steps 1-6, then add our DOK pipeline extensions.

## Quick Setup (following Nate's guide)

### Step 1: Create Supabase Project
1. Go to [supabase.com](https://supabase.com) → sign up (GitHub login)
2. **New Project** → name: `open-brain` → generate password → pick region → create
3. Save **Project ref** and **Database password** (you'll need them)

### Step 2: Set Up the Database
In Supabase SQL Editor, run these SQL files from the `sql/` directory **in order**:

1. `sql/01-thoughts-table.sql` — core thoughts table + indexes
2. `sql/02-match-thoughts-function.sql` — semantic search function
3. `sql/03-rls.sql` — row-level security
4. `sql/04-permissions.sql` — service role permissions
5. `sql/05-dedup.sql` — content fingerprint dedup
6. `sql/06-dok-pipeline.sql` — DOK levels, cross-references, pipeline state (**our addition**)
7. `sql/07-access-stats.sql` — access tracking for knowledge lint (**our addition**)

Also enable the pgvector extension:
- **Database → Extensions** → search "vector" → toggle ON

### Step 3: Save Connection Details
- **Settings → API Keys** → copy Project URL and Secret key

### Step 4: Generate an Access Key
```bash
openssl rand -hex 32
```
Save this — it's your MCP access key for all Edge Functions.

### Step 5: Deploy Edge Functions

#### Nate's core MCP server (search, list, stats, capture)
Follow Nate's guide Step 6 using the `server/` directory.

Set secrets:
```bash
npx supabase secrets set SUPABASE_URL=https://YOUR_REF.supabase.co
npx supabase secrets set SUPABASE_SERVICE_ROLE_KEY=your-secret-key
npx supabase secrets set OPENAI_API_KEY=your-openai-key
npx supabase secrets set MCP_ACCESS_KEY=your-generated-key
```

Deploy:
```bash
npx supabase functions deploy open-brain-mcp --no-verify-jwt
```

#### Our brain-tools-mcp server (recall, query, learn)
Same secrets, same project — just a different function:

```bash
npx supabase functions deploy brain-tools-mcp --no-verify-jwt
```

### Step 6: Connect AI Clients

Add two MCP connectors in Claude Desktop (Settings → Connectors → Add custom connector):

1. **Open Brain** (Nate's core): `https://YOUR_REF.supabase.co/functions/v1/open-brain-mcp?key=YOUR_KEY`
2. **Brain Tools** (our extensions): `https://YOUR_REF.supabase.co/functions/v1/brain-tools-mcp?key=YOUR_KEY`

Or in Claude Code:
```bash
claude mcp add --transport http open-brain \
  https://YOUR_REF.supabase.co/functions/v1/open-brain-mcp \
  --header "x-brain-key: YOUR_KEY"

claude mcp add --transport http brain-tools \
  https://YOUR_REF.supabase.co/functions/v1/brain-tools-mcp \
  --header "x-brain-key: YOUR_KEY"
```

### Step 7: Verify

Test the core tools:
```
Use capture_thought to save: "The DOK pipeline enriches raw facts into insights and SPOVs"
Use search_thoughts to find: "DOK pipeline"
```

Test our tools:
```
Use learn to save: "Substack articles from Nate B Jones contain valuable prompts for AI agent frameworks" with tags "ai, agents, substack"
Use recall to find: "AI agent frameworks"
Use query to ask: "What do I know about AI agent frameworks?"
```

## After Setup

- Configure n8n ingestion workflows to POST to `https://YOUR_REF.supabase.co/functions/v1/open-brain-mcp` (via the `capture_thought` tool)
- The DOK pipeline recipe will be added in Phase 4 (separate Edge Function)
- Data migration from Qdrant happens in Phase 9
