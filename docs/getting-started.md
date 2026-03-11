# Build Your Open Brain: Complete Setup Guide

> **Credit:** This guide is based on [Nate B. Jones's original Substack guide](https://natebjones.substack.com/). It has been adapted for the OB1 repo with his permission. Visit the Substack for discussion, community updates, and the companion prompt pack.

The infrastructure layer for your thinking. One database, one AI gateway, one chat channel. Any AI tool can access shared persistent memory — Claude, ChatGPT, Cursor, and anything that supports MCP — through a unified database with vector search and open protocol architecture.

## What You're Building

A two-part system:

1. **Capture System** (Steps 1–9) — A Slack integration that captures your thoughts automatically, embeds them with AI, extracts metadata, and stores everything in a searchable database.
2. **Retrieval System** (Steps 10–13) — An MCP server that lets any AI assistant search and write to your brain by semantic meaning.

## Requirements

- **Time:** ~45 minutes, no coding experience needed
- **Services (all free tier):**
  - [Supabase](https://supabase.com) — database + edge functions
  - [OpenRouter](https://openrouter.ai) — AI gateway for embeddings and metadata extraction
  - [Slack](https://slack.com) — capture interface

## Cost

| Service | Cost |
|---------|------|
| Slack | Free |
| Supabase | $0 (free tier) |
| Embeddings (text-embedding-3-small) | ~$0.02 per million tokens |
| Metadata extraction (GPT-4o-mini via OpenRouter) | ~$0.15 per million input tokens |
| **Estimated monthly total (20 thoughts/day)** | **$0.10–$0.30** |

## Credential Tracker

Keep this filled in as you go. You'll need these values across multiple steps.

| Credential | Where to find it | Your value |
|------------|-----------------|------------|
| Supabase Project Ref | Dashboard URL: `https://supabase.com/dashboard/project/YOUR_REF` | |
| Supabase Project URL | Settings → API | |
| Supabase Service Role Key | Settings → API (secret key) | |
| OpenRouter API Key | openrouter.ai → Keys | |
| Slack Channel ID | Channel details → bottom of About tab | |
| Slack Bot Token | api.slack.com → Your App → OAuth & Permissions | |
| Edge Function URL (ingest) | Output of `supabase functions deploy` | |
| Edge Function URL (MCP) | Output of `supabase functions deploy` | |
| MCP Access Key | You generate this in Step 10 | |

---

## Part 1: Capture System

### Step 1: Create Supabase Project

1. Sign up at [supabase.com](https://supabase.com)
2. Click **New Project**
3. Name it `open-brain`
4. Generate a database password (save it somewhere safe)
5. Choose the region closest to you
6. Click **Create new project**

Your **Project Ref** is in the dashboard URL: `https://supabase.com/dashboard/project/YOUR_PROJECT_REF`

Save it in the credential tracker above.

### Step 2: Database Setup

Open the **SQL Editor** in your Supabase dashboard (left sidebar). Run each of these blocks one at a time.

**Enable pgvector extension:**

```sql
create extension if not exists vector with schema extensions;
```

**Create the thoughts table:**

```sql
create table public.thoughts (
  id bigint generated always as identity primary key,
  content text not null,
  embedding extensions.vector(1536),
  metadata jsonb default '{}'::jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Index for fast semantic search
create index on public.thoughts using ivfflat (embedding extensions.vector_cosine_ops)
  with (lists = 100);
```

**Create the semantic search function:**

```sql
create or replace function public.search_thoughts(
  query_embedding extensions.vector(1536),
  match_threshold float default 0.5,
  match_count int default 10
)
returns table (
  id bigint,
  content text,
  metadata jsonb,
  similarity float
)
language plpgsql
as $$
begin
  return query
  select
    t.id,
    t.content,
    t.metadata,
    1 - (t.embedding <=> query_embedding) as similarity
  from public.thoughts t
  where 1 - (t.embedding <=> query_embedding) > match_threshold
  order by t.embedding <=> query_embedding
  limit match_count;
end;
$$;
```

**Enable Row Level Security:**

```sql
alter table public.thoughts enable row level security;

create policy "Service role only" on public.thoughts
  for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');
```

### Step 3: Save Connection Details

In your Supabase dashboard, go to **Settings → API**.

Save these to your credential tracker:
- **Project URL** — looks like `https://YOUR_REF.supabase.co`
- **Service Role Key** (the secret one, not the anon key) — starts with `eyJ...`

### Step 4: OpenRouter API Key

1. Sign up at [openrouter.ai](https://openrouter.ai)
2. Go to **Keys** and create a new API key named `open-brain`
3. Add **$5 in credits** (this lasts months at typical usage)
4. Save the API key to your credential tracker

### Step 5: Slack Channel

1. Open Slack and create a **private channel** named `capture`
2. Open channel details (click the channel name at the top)
3. Scroll to the bottom of the **About** tab — the **Channel ID** is there (starts with `C`)
4. Save it to your credential tracker

### Step 6: Slack App

1. Go to [api.slack.com/apps](https://api.slack.com/apps) and click **Create New App → From scratch**
2. Name it `Open Brain`, select your workspace
3. Go to **OAuth & Permissions** and add these **Bot Token Scopes:**
   - `channels:history`
   - `groups:history`
   - `chat:write`
4. Click **Install to Workspace** and authorize
5. Copy the **Bot User OAuth Token** (starts with `xoxb-`) to your credential tracker
6. In Slack, go to the `#capture` channel and type: `/invite @Open Brain`

### Step 7: Deploy the Ingest Edge Function

Install the Supabase CLI if you haven't:

```bash
# macOS
brew install supabase/tap/supabase

# Windows
scoop bucket add supabase https://github.com/supabase/scoop-bucket.git
scoop install supabase

# npm (any platform)
npm i -g supabase
```

Then set up and deploy:

```bash
supabase login
supabase link --project-ref YOUR_PROJECT_REF
```

Set your secrets:

```bash
supabase secrets set OPENROUTER_API_KEY=your-openrouter-key
supabase secrets set SLACK_BOT_TOKEN=xoxb-your-bot-token
supabase secrets set SLACK_CHANNEL_ID=C0123456789
```

Create and deploy the function:

```bash
supabase functions new ingest-thought
supabase functions deploy ingest-thought --no-verify-jwt
```

The function does this on each Slack message:
1. Receives the message via Slack Events API
2. Generates an embedding via OpenRouter (text-embedding-3-small)
3. Extracts metadata (category, people, action items) via GPT-4o-mini
4. Stores the thought in Supabase
5. Replies in Slack with a confirmation

Save the **Edge Function URL** from the deploy output to your credential tracker.

### Step 8: Connect Slack to the Edge Function

1. Back in [api.slack.com/apps](https://api.slack.com/apps), open your app
2. Go to **Event Subscriptions** and toggle it **On**
3. Paste your Edge Function URL in the **Request URL** field — Slack will verify it
4. Under **Subscribe to bot events**, add:
   - `message.channels`
   - `message.groups`
5. Click **Save Changes**

### Step 9: Test Capture

Go to your `#capture` channel in Slack and type:

```
Sarah mentioned she's thinking about leaving her job to start a consulting business
```

Within a few seconds, you should see a reply from the bot:

```
Captured as person_note — career, consulting | People: Sarah | Action items: Check in with Sarah about consulting plans
```

If you see this, Part 1 is done. Your brain is capturing.

---

## Part 2: Retrieval System

### Step 10: Create an Access Key

Generate a random 64-character key:

```bash
# macOS / Linux
openssl rand -hex 32

# Windows PowerShell
-join ((1..32) | ForEach-Object { '{0:x2}' -f (Get-Random -Maximum 256) })
```

Save it as a Supabase secret:

```bash
supabase secrets set MCP_ACCESS_KEY=your-64-char-key-here
```

Save this key in your credential tracker — you'll need it to connect AI clients.

### Step 11: Deploy the MCP Server

Create and deploy the MCP edge function:

```bash
supabase functions new open-brain-mcp
supabase functions deploy open-brain-mcp --no-verify-jwt
```

The MCP server exposes four tools to any connected AI:

| Tool | What it does |
|------|-------------|
| `search_thoughts` | Semantic search — find thoughts by meaning |
| `list_thoughts` | Browse recent thoughts with optional filters |
| `thought_stats` | Statistics on your captured content |
| `capture_thought` | Save a new thought directly from any AI |

Save the **MCP Function URL** to your credential tracker.

### Step 12: Connect to AI Clients

Your MCP Connection URL follows this pattern:

```
https://YOUR_REF.supabase.co/functions/v1/open-brain-mcp/mcp?key=YOUR_MCP_ACCESS_KEY
```

**Claude Desktop:**
1. Open Settings → Connectors
2. Click **Add custom connector**
3. Paste your MCP Connection URL

**ChatGPT (requires paid plan):**
1. Open Settings → Apps & Connectors
2. Click **Create connector**
3. Paste your MCP endpoint URL

**Claude Code:**

```bash
claude mcp add --transport http open-brain https://YOUR_REF.supabase.co/functions/v1/open-brain-mcp/mcp --header "x-brain-key: YOUR_MCP_ACCESS_KEY"
```

**Other MCP-compatible clients:**

Use the URL with a query parameter:
```
https://YOUR_REF.supabase.co/functions/v1/open-brain-mcp/mcp?key=YOUR_MCP_ACCESS_KEY
```

For clients that only support local stdio servers, use the `mcp-remote` bridge:
```bash
npx mcp-remote https://YOUR_REF.supabase.co/functions/v1/open-brain-mcp/mcp --header "x-brain-key: YOUR_MCP_ACCESS_KEY"
```

### Step 13: Test Retrieval

Try these prompts in any connected AI client:

- **"What did I capture about career changes?"** — Uses semantic search to find thoughts by meaning
- **"What did I capture this week?"** — Browses recent thoughts
- **"Save this: decided to move launch to March 15"** — Captures a new thought directly

If your AI can search and return your thoughts, you're done. Your Open Brain is live.

---

## Troubleshooting

**Slack Request URL not verified**
Redeploy the edge function (`supabase functions deploy ingest-thought --no-verify-jwt`) and check the output for errors. The function must respond to Slack's verification challenge.

**Messages not triggering the function**
Verify both event types (`message.channels` and `message.groups`) are subscribed in Event Subscriptions. Also confirm the bot was invited to the channel.

**Duplicate database entries**
Slack retries if it doesn't get a response within 3 seconds. If your function is slow, duplicates can appear. Delete them manually from the SQL Editor:
```sql
delete from thoughts where id in (
  select id from (
    select id, row_number() over (partition by content, created_at::date order by id) as rn
    from thoughts
  ) t where rn > 1
);
```

**No confirmation reply in Slack**
Check that the bot token (`xoxb-...`) is set correctly and the `chat:write` scope is in the bot's permissions.

**401 errors from MCP**
Verify your access key matches exactly — check `supabase secrets list` and compare with what's in your AI client config.

**Search returns no results**
Make sure you have captured thoughts first. If you do, try lowering the match threshold:
```sql
select * from search_thoughts(
  (select embedding from thoughts order by created_at desc limit 1),
  0.3,  -- lower threshold
  10
);
```

---

## Architecture Notes

Unlike local MCP servers that require Node.js and credential management on your computer, this deployment runs entirely on Supabase infrastructure. Connections use simple URLs with no local dependencies.

- **Embedding model:** `text-embedding-3-small` generates 1536-dimensional vectors for semantic matching
- **Metadata extraction:** GPT-4o-mini via OpenRouter provides structured filtering (categories, people, action items)
- **Protocol:** MCP (Model Context Protocol) — the open standard for connecting AI tools to data sources

## What's Next

Browse the [OB1 community extensions](../README.md) to add new capabilities to your brain:
- [Recipes](../recipes/) — step-by-step builds (email import, ChatGPT import, daily digest)
- [Schemas](../schemas/) — database extensions (CRM contacts, taste tracker)
- [Dashboards](../dashboards/) — frontend templates for your brain
- [Integrations](../integrations/) — new capture sources (Discord, email, browser extension)
