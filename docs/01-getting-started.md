# Build Your Open Brain

## Complete Setup Guide

---

## What You're Building

A Slack channel where you type a thought — it automatically gets embedded, classified, and stored in your database — you get a confirmation reply showing what was captured. Then an MCP server that lets any AI assistant search your brain by meaning — and write to it directly.

## What You Need

About 45 minutes and zero coding experience. You'll copy and paste everything.

### Services (All Free Tier)

- **Supabase** — Your database — stores everything
- **OpenRouter** — Your AI gateway — understands everything
- **Slack** — Your capture interface — where you type thoughts

### If You Get Stuck

Follow this guide step by step — it's designed to get you through without outside help. If you'd rather have an AI coding tool walk you through it, check out the [AI-Assisted Setup guide](04-ai-assisted-setup.md) — it covers how to use Cursor, Claude Code, or similar tools to build alongside this guide.

If something goes sideways, Supabase has a free built-in AI assistant in every project dashboard. Look for the chat icon in the bottom-right corner. It has access to all of Supabase's documentation and can help with every Supabase-specific step in this guide.

Things it's good at:

- Walking you through where to click when you can't find something in the dashboard
- Fixing SQL errors if you paste in the error message
- Explaining terminal commands and what their output means
- Interpreting Edge Function logs when something isn't working
- Explaining Supabase concepts in plain English (what's a Secret key / service role key? what does Row Level Security do?)

It can't see your screen or run commands for you, but if you paste what you're seeing, it can tell you what to do next.

## Two Parts

**Part 1 — Capture** (Steps 1–9): Slack → Edge Function → Supabase. Type a thought, it gets embedded and classified automatically.

**Part 2 — Retrieval** (Steps 10–13): Hosted MCP Server → Any AI. Connect Claude, ChatGPT, or any MCP client to your brain with a URL. Read and write from any tool.

### After You're Done

This guide builds the system. The companion prompt pack — **[Open Brain: Companion Prompts](https://promptkit.natebjones.com/20260224_uq1_promptkit_1)** — makes it useful. It includes prompts for migrating your existing AI memories into the brain, migrating an existing second brain system, discovering use cases specific to your workflow, capture templates that optimize metadata extraction, and a weekly review ritual. Finish the setup first, then grab the prompts.

## Cost Breakdown

| Service | Cost |
| ------- | ---- |
| Slack | Free |
| Supabase (free tier) | $0 |
| Embeddings (text-embedding-3-small) | ~$0.02 / million tokens |
| Metadata extraction (gpt-4o-mini) | ~$0.15 / million input tokens |

For 20 thoughts/day: roughly $0.10–0.30/month in API costs.

---

## Credential Tracker

You're going to generate API keys, passwords, and IDs across three different services. You'll need them at specific steps later — sometimes minutes after you create them, sometimes much later. Don't trust your memory.

> Copy the block below into a text editor (Notes, TextEdit, Notepad) and fill it in as you go. Each item tells you which step generates it.

```text
OPEN BRAIN -- CREDENTIAL TRACKER
Keep this file. Fill in as you go.
--------------------------------------

SUPABASE
  Account email:      ____________
  Account password:   ____________
  Database password:  ____________ <- Step 1
  Project name:       ____________
  Project ref:        ____________ <- Step 1
  Project URL:        ____________ <- Step 3
  Secret key:         ____________ <- Step 3 (formerly "Service role key")

OPENROUTER
  Account email:      ____________
  Account password:   ____________
  API key:            ____________ <- Step 4

SLACK
  Workspace name:     ____________
  Workspace URL:      ____________
  Channel name:       ____________
  Channel ID:         ____________ <- Step 5
  Bot OAuth Token:    ____________ <- Step 6

GENERATED DURING SETUP
  Edge Function URL:  ____________ <- Step 7
  MCP Access Key:     ____________ <- Step 10
  MCP Server URL:     ____________ <- Step 11
  MCP Connection URL: ____________ <- Step 11 (server URL + ?key=your-access-key)

--------------------------------------
```

> Seriously — copy that now. You'll thank yourself at Step 7.

---

## Part 1 — Capture

### Step 1: Create Your Supabase Project

Supabase is your database. It stores your thoughts as raw text, vector embeddings, and structured metadata. It also gives you a REST API automatically.

1. Go to supabase.com and sign up (GitHub login is fastest)
2. Click **New Project** in the dashboard
3. Pick your organization (default is fine)
4. Set Project name: `open-brain` (or whatever you want)
5. Generate a strong Database password — paste into credential tracker NOW
6. Pick the Region closest to you
7. Click **Create new project** and wait 1–2 minutes

> Grab your Project ref — it's the random string in your dashboard URL: `supabase.com/dashboard/project/THIS_PART`. Paste it into the tracker.

---

### Step 2: Set Up the Database

Three SQL commands, pasted one at a time. This creates your storage table, your search function, and your security policy.

#### Enable the Vector Extension

In the left sidebar: **Database → Extensions** → search for "vector" → flip **pgvector ON**.

#### Create the Thoughts Table

In the left sidebar: **SQL Editor → New query** → paste and Run:

```sql
-- Create the thoughts table
create table thoughts (
  id uuid default gen_random_uuid() primary key,
  content text not null,
  embedding vector(1536),
  metadata jsonb default '{}'::jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Index for fast vector similarity search
create index on thoughts
  using hnsw (embedding vector_cosine_ops);

-- Index for filtering by metadata fields
create index on thoughts using gin (metadata);

-- Index for date range queries
create index on thoughts (created_at desc);

-- Auto-update the updated_at timestamp
create or replace function update_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger thoughts_updated_at
  before update on thoughts
  for each row
  execute function update_updated_at();
```

#### Create the Search Function

New query → paste and Run:

```sql
-- Semantic search function
create or replace function match_thoughts(
  query_embedding vector(1536),
  match_threshold float default 0.7,
  match_count int default 10,
  filter jsonb default '{}'::jsonb
)
returns table (
  id uuid,
  content text,
  metadata jsonb,
  similarity float,
  created_at timestamptz
)
language plpgsql
as $$
begin
  return query
  select
    t.id,
    t.content,
    t.metadata,
    1 - (t.embedding <=> query_embedding) as similarity,
    t.created_at
  from thoughts t
  where 1 - (t.embedding <=> query_embedding) > match_threshold
    and (filter = '{}'::jsonb or t.metadata @> filter)
  order by t.embedding <=> query_embedding
  limit match_count;
end;
$$;
```

#### Lock Down Security

One more new query:

```sql
-- Enable Row Level Security
alter table thoughts enable row level security;

-- Service role full access only
create policy "Service role full access"
  on thoughts
  for all
  using (auth.role() = 'service_role');
```

#### Quick Verification

Table Editor should show the `thoughts` table with columns: id, content, embedding, metadata, created_at, updated_at. Database → Functions should show `match_thoughts`.

---

### Step 3: Save Your Connection Details

In the left sidebar: **Settings** (gear icon) → **API**. Copy these into your credential tracker:

- **Project URL** — Listed in the API settings section under "Project URL"
- **Secret key** — Under "API keys," this is the key formerly labeled "Service role key." Same key, new name — click reveal and copy it.

> Treat the Secret key like a password. Anyone with it has full access to your data. You may also see a "Publishable key" listed — that's the anon key surfaced more prominently in the updated Supabase UI. You don't need it for this setup.

---

### Step 4: Get an OpenRouter API Key

OpenRouter is a universal AI API gateway — one account gives you access to every major model. We're using it for embeddings and lightweight LLM metadata extraction.

Why OpenRouter instead of OpenAI directly? One account, one key, one billing relationship — and it future-proofs you for Claude, Gemini, or any other model later.

1. Go to openrouter.ai and sign up
2. Go to openrouter.ai/keys
3. Click **Create Key**, name it `open-brain`
4. Copy the key into your credential tracker immediately
5. Add $5 in credits under Credits (lasts months)

---

### Step 5: Create Your Slack Capture Channel

1. If you don't have a Slack workspace, create one at slack.com (free tier works)
2. Click the **+** next to Channels → **Create new channel**
3. Name it "capture" (or brain, inbox, whatever feels natural)
4. Make it **Private** (recommended — this is personal)
5. Get the Channel ID: right-click channel → View channel details → scroll to bottom (starts with C)
6. Paste the Channel ID into your credential tracker

---

### Step 6: Create the Slack App

This is the bridge between Slack and your database.

#### Create the App

1. Go to api.slack.com/apps → **Create New App** → **From scratch**
2. App Name: "Open Brain", select your workspace
3. Click **Create App**

#### Set Permissions

1. Left sidebar → **OAuth & Permissions**
2. Scroll to **Scopes → Bot Token Scopes**
3. Add: `channels:history`, `groups:history`, `chat:write`
4. Scroll up → **Install to Workspace** → Allow
5. Copy the **Bot User OAuth Token** (starts with `xoxb-`) into credential tracker

#### Add App to Channel

In Slack, open your capture channel and type: `/invite @Open Brain`

> Don't set up Event Subscriptions yet — you need the Edge Function URL first (Step 7).

---

### Step 7: Deploy the Edge Function

This is the brains of the operation. One function receives messages from Slack, generates an embedding, extracts metadata, stores everything in Supabase, and replies with a confirmation.

> **New to the terminal?** The "terminal" is the text-based command line on your computer. On Mac, open the app called **Terminal** (search for it in Spotlight). On Windows, open **PowerShell**. Everything below gets typed there, not in your browser.

#### Install the Supabase CLI

> **Mac users:** If you already have Homebrew installed (you'll know — it's the thing you install with `brew`), use the first option. **Windows users:** use Scoop — Supabase recommends it over npm for Windows because it handles PATH and permissions cleanly. **Linux or Mac without Homebrew:** use npm.

```bash
# Mac with Homebrew
brew install supabase/tap/supabase

# Windows with Scoop (recommended)
# Install Scoop first if you don't have it:
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser
Invoke-RestMethod -Uri https://get.scoop.sh | Invoke-Expression

# Then install Supabase:
scoop bucket add supabase https://github.com/supabase/scoop-bucket.git
scoop install supabase

# Linux or Mac without Homebrew
npm install -g supabase
```

Verify it worked:

```bash
supabase --version
```

#### Log In and Link

```bash
supabase login
supabase link --project-ref YOUR_PROJECT_REF
```

Replace `YOUR_PROJECT_REF` with the project ref from your credential tracker (Step 1).

#### Create the Function

```bash
supabase functions new ingest-thought
```

Open `supabase/functions/ingest-thought/index.ts` and replace its entire contents with:

```typescript
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const OPENROUTER_API_KEY = Deno.env.get("OPENROUTER_API_KEY")!;
const SLACK_BOT_TOKEN = Deno.env.get("SLACK_BOT_TOKEN")!;
const SLACK_CAPTURE_CHANNEL = Deno.env.get("SLACK_CAPTURE_CHANNEL")!;

const OPENROUTER_BASE = "https://openrouter.ai/api/v1";
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

async function getEmbedding(text: string): Promise<number[]> {
  const r = await fetch(`${OPENROUTER_BASE}/embeddings`, {
    method: "POST",
    headers: { "Authorization": `Bearer ${OPENROUTER_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: "openai/text-embedding-3-small", input: text }),
  });
  const d = await r.json();
  return d.data[0].embedding;
}

async function extractMetadata(text: string): Promise<Record<string, unknown>> {
  const r = await fetch(`${OPENROUTER_BASE}/chat/completions`, {
    method: "POST",
    headers: { "Authorization": `Bearer ${OPENROUTER_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "openai/gpt-4o-mini",
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: `Extract metadata from the user's captured thought. Return JSON with:
- "people": array of people mentioned (empty if none)
- "action_items": array of implied to-dos (empty if none)
- "dates_mentioned": array of dates YYYY-MM-DD (empty if none)
- "topics": array of 1-3 short topic tags (always at least one)
- "type": one of "observation", "task", "idea", "reference", "person_note"
Only extract what's explicitly there.` },
        { role: "user", content: text },
      ],
    }),
  });
  const d = await r.json();
  try { return JSON.parse(d.choices[0].message.content); }
  catch { return { topics: ["uncategorized"], type: "observation" }; }
}

async function replyInSlack(channel: string, threadTs: string, text: string): Promise<void> {
  await fetch("https://slack.com/api/chat.postMessage", {
    method: "POST",
    headers: { "Authorization": `Bearer ${SLACK_BOT_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ channel, thread_ts: threadTs, text }),
  });
}

Deno.serve(async (req: Request): Promise<Response> => {
  try {
    const body = await req.json();
    if (body.type === "url_verification") {
      return new Response(JSON.stringify({ challenge: body.challenge }), {
        headers: { "Content-Type": "application/json" },
      });
    }
    const event = body.event;
    if (!event || event.type !== "message" || event.subtype || event.bot_id
        || event.channel !== SLACK_CAPTURE_CHANNEL) {
      return new Response("ok", { status: 200 });
    }
    const messageText: string = event.text;
    const channel: string = event.channel;
    const messageTs: string = event.ts;
    if (!messageText || messageText.trim() === "") return new Response("ok", { status: 200 });

    const [embedding, metadata] = await Promise.all([
      getEmbedding(messageText),
      extractMetadata(messageText),
    ]);

    const { error } = await supabase.from("thoughts").insert({
      content: messageText,
      embedding,
      metadata: { ...metadata, source: "slack", slack_ts: messageTs },
    });

    if (error) {
      console.error("Supabase insert error:", error);
      await replyInSlack(channel, messageTs, `Failed to capture: ${error.message}`);
      return new Response("error", { status: 500 });
    }

    const meta = metadata as Record<string, unknown>;
    let confirmation = `Captured as *${meta.type || "thought"}*`;
    if (Array.isArray(meta.topics) && meta.topics.length > 0)
      confirmation += ` - ${meta.topics.join(", ")}`;
    if (Array.isArray(meta.people) && meta.people.length > 0)
      confirmation += `\nPeople: ${meta.people.join(", ")}`;
    if (Array.isArray(meta.action_items) && meta.action_items.length > 0)
      confirmation += `\nAction items: ${meta.action_items.join("; ")}`;

    await replyInSlack(channel, messageTs, confirmation);
    return new Response("ok", { status: 200 });
  } catch (err) {
    console.error("Function error:", err);
    return new Response("error", { status: 500 });
  }
});
```

#### Set Your Secrets

```bash
supabase secrets set OPENROUTER_API_KEY=your-openrouter-key-here
supabase secrets set SLACK_BOT_TOKEN=xoxb-your-slack-bot-token-here
supabase secrets set SLACK_CAPTURE_CHANNEL=C0your-channel-id-here
```

> SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are automatically available inside Edge Functions — you don't need to set them.

#### Deploy

```bash
supabase functions deploy ingest-thought --no-verify-jwt
```

> Copy the Edge Function URL immediately after deployment! It looks like: `https://YOUR_PROJECT_REF.supabase.co/functions/v1/ingest-thought`

---

### Step 8: Connect Slack to the Edge Function

1. Go to api.slack.com/apps → select your Open Brain app
2. Left sidebar → **Event Subscriptions** → toggle **Enable Events ON**
3. Paste your Edge Function URL in the **Request URL** field
4. Wait for the green checkmark — Verified
5. Under **Subscribe to bot events**, add both: `message.channels` and `message.groups`
6. Click **Save Changes** (reinstall if prompted)

> **You need both events.** Slack treats public and private channels as separate entity types. Public channels fire `message.channels`, private channels fire `message.groups`. If you only add one, messages in the other channel type will silently fail — no error, just nothing happens. Add both so you're covered regardless of how your capture channel is configured.

---

### Step 9: Test It

Go to your capture channel in Slack and type:

```text
Sarah mentioned she's thinking about leaving her job to start a consulting business
```

Wait 5–10 seconds. You should see a threaded reply:

```text
Captured as person_note — career, consulting
People: Sarah
Action items: Check in with Sarah about consulting plans
```

Then open Supabase dashboard → Table Editor → thoughts. You should see one row with your message, an embedding, and metadata.

> If that works, Part 1 is done. You have a working capture system.

---

## Part 2 — Retrieval

### A Quick Note on Architecture

MCP servers can run two ways: locally on your computer, or hosted in the cloud.

The local approach means installing Node.js, building a TypeScript project, and running a server process on your machine. Every AI client you connect needs the full path to that server plus your database credentials pasted into a config file. If your laptop is closed, your brain is offline. If you switch computers, you set it up again.

We're not doing that.

Your capture system already runs on Supabase — the Edge Function you deployed in Part 1 handles Slack messages without anything running on your computer. The MCP server works the same way. One more Edge Function, deployed to the same project, reachable from anywhere. Your AI clients connect with a URL. No build steps, no local dependencies, no credentials on your machine.

If you want to run locally — maybe you're a developer who prefers that, or you want to customize beyond what Edge Functions allow — the MCP TypeScript SDK with StdioServerTransport works great. The [Supabase docs on deploying MCP servers](https://supabase.com/docs/guides/getting-started/byo-mcp) cover both approaches. Everything below uses hosted.

---

### Step 10: Create an Access Key

Your MCP server will be a public URL. The Supabase project ref in that URL is random enough that nobody will stumble onto it, but let's close the gap entirely. You'll generate a simple access key that the server checks on every request. Takes 30 seconds.

In your terminal, generate a random key:

```bash
# Mac/Linux
openssl rand -hex 32

# Windows (PowerShell)
-join ((1..32) | ForEach-Object { '{0:x2}' -f (Get-Random -Maximum 256) })
```

Copy the output — it'll look something like `a3f8b2c1d4e5...` (64 characters). Paste it into your credential tracker under MCP Access Key.

Set it as a Supabase secret:

```bash
supabase secrets set MCP_ACCESS_KEY=your-generated-key-here
```

---

### Step 11: Deploy the MCP Server

One Edge Function. Four tools: semantic search, browse recent thoughts, stats, and capture. Same deployment process as the capture function.

#### Create the Function

```bash
supabase functions new open-brain-mcp
```

#### Add Dependencies

Create `supabase/functions/open-brain-mcp/deno.json`:

```json
{
  "imports": {
    "@hono/mcp": "npm:@hono/mcp@0.1.1",
    "@modelcontextprotocol/sdk": "npm:@modelcontextprotocol/sdk@1.24.3",
    "hono": "npm:hono@4.9.2",
    "zod": "npm:zod@4.1.13",
    "@supabase/supabase-js": "npm:@supabase/supabase-js@2.47.10"
  }
}
```

#### Write the Server

Open `supabase/functions/open-brain-mcp/index.ts` and replace its entire contents with the MCP server code from the [original guide](https://promptkit.natebjones.com/20260224_uq1_guide_main).

#### Deploy

```bash
supabase functions deploy open-brain-mcp --no-verify-jwt
```

Your MCP server is now live at:

```text
https://YOUR_PROJECT_REF.supabase.co/functions/v1/open-brain-mcp
```

Replace `YOUR_PROJECT_REF` with the project ref from your credential tracker (Step 1). Paste the full URL into your credential tracker as the MCP Server URL.

Now build your **MCP Connection URL** by adding your access key to the end:

```text
https://YOUR_PROJECT_REF.supabase.co/functions/v1/open-brain-mcp?key=your-access-key-from-step-10
```

Paste this into your credential tracker as the MCP Connection URL. This is what you'll give to AI clients that support remote MCP — one URL, no extra config.

> That's it. No npm install, no TypeScript build, no local server to keep running. It's deployed alongside your capture function and runs on Supabase's infrastructure.

---

### Step 12: Connect to Your AI

You need your MCP Connection URL from the credential tracker — the one with `?key=` at the end.

#### Claude Desktop

1. Open Claude Desktop → **Settings** → **Connectors**
2. Click **Add custom connector**
3. Name: `Open Brain`
4. Remote MCP server URL: paste your **MCP Connection URL** (the one ending in `?key=your-access-key`)
5. Click **Add**

That's it. Start a new conversation, and Claude will have access to your Open Brain tools. You can enable or disable it per conversation via the "+" button → Connectors.

> No JSON config files. No Node.js. No terminal. If you had trouble with earlier versions of this guide, this is the fix.

#### ChatGPT

Requires a paid ChatGPT plan (Plus, Pro, Business, Enterprise, or Edu) and works on the web at chatgpt.com. Not available on mobile.

**Enable Developer Mode (one-time setup):**

1. Go to chatgpt.com → click your profile icon → **Settings**
2. Navigate to **Apps & Connectors** → **Advanced settings**
3. Toggle **Developer mode** ON

> Enabling Developer Mode disables ChatGPT's built-in Memory feature. Yes, that's ironic for a brain tool. Your Open Brain replaces that functionality anyway — and it works across every AI, not just ChatGPT.

**Add the connector:**

1. In Settings → **Apps & Connectors**, click **Create**
2. Name: `Open Brain`
3. Description: `Personal knowledge base with semantic search` (or whatever you want — this is just for your reference)
4. MCP endpoint URL: paste your **MCP Connection URL** (the one ending in `?key=your-access-key`)
5. Authentication: select **No Authentication** (your access key is embedded in the URL)
6. Click **Create**

**Using it:** Start a new conversation and make sure the Open Brain connector is enabled — check the tools/apps panel at the top of the chat. ChatGPT is less intuitive than Claude at picking the right MCP tool automatically. If it doesn't use your brain on its own, be explicit: "Use the Open Brain search_thoughts tool to find my notes about project planning." After it gets the pattern once or twice in a conversation, it usually picks up the habit.

#### Claude Code

```bash
claude mcp add --transport http open-brain \
  https://YOUR_PROJECT_REF.supabase.co/functions/v1/open-brain-mcp \
  --header "x-brain-key: your-access-key-from-step-10"
```

#### Other Clients (Cursor, VS Code Copilot, Windsurf)

Every MCP client handles remote servers slightly differently. The server accepts your access key two ways — pick whichever your client supports:

**Option A: URL with key (easiest).** If your client has a field for a remote MCP server URL, paste the full MCP Connection URL including `?key=your-access-key`. This works for any client that supports remote MCP without requiring headers.

**Option B: mcp-remote bridge.** If your client only supports local stdio servers (configured via a JSON config file), use `mcp-remote` to bridge to the remote server. This requires Node.js installed.

```json
{
  "mcpServers": {
    "open-brain": {
      "command": "npx",
      "args": [
        "mcp-remote",
        "https://YOUR_PROJECT_REF.supabase.co/functions/v1/open-brain-mcp",
        "--header",
        "x-brain-key:${BRAIN_KEY}"
      ],
      "env": {
        "BRAIN_KEY": "your-access-key-from-step-10"
      }
    }
  }
}
```

> Note: no space after the colon in `x-brain-key:${BRAIN_KEY}`. Some clients have a bug where spaces inside args get mangled.

---

### Step 13: Use It

Ask your AI naturally. It picks the right tool automatically:

| Prompt | Tool Used |
| ------ | --------- |
| "What did I capture about career changes?" | Semantic search |
| "What did I capture this week?" | Browse recent |
| "How many thoughts do I have?" | Stats overview |
| "Find my notes about the API redesign" | Semantic search |
| "Show me my recent ideas" | Browse + filter |
| "Who do I mention most?" | Stats |
| "Save this: decided to move the launch to March 15 because of the QA blockers" | Capture thought |
| "Remember that Marcus wants to move to the platform team" | Capture thought |

> The capture tool means you're not limited to Slack for input. Any MCP-connected AI can write directly to your brain — Claude Desktop, ChatGPT, Claude Code, Cursor. Wherever you're working, you can save a thought without switching apps.

---

## Troubleshooting

If the specific suggestions below don't solve your issue, remember: the Supabase AI assistant (chat icon, bottom-right of your dashboard) can help diagnose problems with anything Supabase-related. Paste the error message and tell it what step you're on.

### Capture Issues (Part 1)

**Slack says "Request URL not verified"**

Your Edge Function isn't deployed or isn't reachable. Run the deploy command again and check the output for errors.

```bash
supabase functions deploy ingest-thought --no-verify-jwt
```

**Messages aren't triggering the function**

Check Event Subscriptions — make sure both `message.channels` and `message.groups` are listed (public channels use the first, private channels use the second — you need both). Verify the app is invited to the channel. Confirm the channel ID in your secrets matches the actual channel.

**Slack creates duplicate database entries**

Slack retries webhook delivery if it doesn't get a response within 3 seconds. If your Edge Function takes longer than that (embedding + metadata extraction can take 4-5 seconds), Slack sends the event again, and you get two rows. This is a known edge case. The captures are identical, so it doesn't affect search — but if it bothers you, you can delete the duplicate row in the Supabase Table Editor.

**Function runs but nothing in the database**

Check Edge Function logs: Supabase dashboard → Edge Functions → ingest-thought → Logs. Most likely the OpenRouter key is wrong or has no credits.

```bash
supabase secrets list
```

**No confirmation reply in Slack**

The bot token might be wrong, or `chat:write` scope wasn't added. Go to your Slack app → OAuth & Permissions and verify. If you added the scope after installing, you need to reinstall the app.

**Metadata extraction seems off**

That's normal — the LLM is making its best guess with limited context. The metadata is a convenience layer on top of semantic search, not the primary retrieval mechanism. The embedding handles fuzzy matching regardless.

### Retrieval Issues (Part 2)

**Claude Desktop tools don't appear**

Make sure you added the connector in Settings → Connectors (not by editing the JSON config file). Verify the connector is enabled for your conversation — click the "+" button at the bottom of the chat, then Connectors, and check that Open Brain is toggled on. If the connector was added but tools still don't show, try removing and re-adding it with the same URL.

**ChatGPT doesn't use the Open Brain tools**

First, confirm Developer Mode is enabled (Settings → Apps & Connectors → Advanced settings). Without it, ChatGPT only exposes limited MCP functionality that won't cover Open Brain's full toolset. Next, check that the connector is active for your current conversation — look for it in the tools/apps panel. If it's connected but ChatGPT ignores it, be direct: "Use the Open Brain search_thoughts tool to search for [topic]." ChatGPT often needs explicit tool references the first few times before it starts picking them up automatically.

**Getting 401 errors**

The access key doesn't match what's stored in Supabase secrets. Double-check that the `?key=` value in your URL matches your MCP Access Key exactly. If you're using the header approach (Claude Code or mcp-remote), the header must be `x-brain-key` (lowercase, with the dash).

**Search returns no results**

Make sure you sent test messages in Part 1 first. Try asking the AI to "search with threshold 0.3" for a wider net. If that still returns nothing, check the Edge Function logs in the Supabase dashboard for errors.

**Tools work but responses are slow**

First search on a cold function takes a few seconds — the Edge Function is waking up. Subsequent calls are faster. If it's consistently slow, check your Supabase project region — pick the one closest to you.

**Capture tool saves but metadata is wrong**

Same as Slack capture — the metadata extraction is best-effort. The embedding is what powers semantic search, and that works regardless of how the metadata gets classified. If you consistently want a specific classification, use the capture templates from the prompt kit to give the LLM clearer signals.

---

## How It Works Under the Hood

When you type a message in Slack: Slack sends it to your Edge Function → the function generates an embedding (1536-dimensional vector of meaning) AND extracts metadata via LLM in parallel → both get stored as a single row in Supabase → the function replies in your Slack thread with a summary.

When you capture from any AI via MCP: your AI client sends the text to the capture_thought tool → the MCP server generates an embedding AND extracts metadata in parallel (same pipeline as Slack) → stored as a single row → confirmation returned to your AI.

When you ask your AI about it: your AI client sends the query to the MCP Edge Function → the function generates an embedding of your question → Supabase matches it against every stored thought by vector similarity → results come back ranked by meaning, not keywords.

The embedding is what makes retrieval powerful. "Sarah's thinking about leaving" and "What did I note about career changes?" match semantically even though they share zero keywords. The metadata is a bonus layer for structured filtering on top.

### Swapping Models Later

Because you're using OpenRouter, you can swap models by editing the model strings in the Edge Function code and redeploying. Browse available models at openrouter.ai/models. Just make sure embedding dimensions match (1536 for the current setup).

---

## What You Just Built — And What You Can Build Next

You just used three free services, some copy-pasted code, and a built-in AI assistant to build a personal knowledge system with semantic search, an open write protocol, and an open read protocol. No CS degree. No local servers. No monthly SaaS fee.

Here's the thing worth noticing: that Supabase AI assistant that helped you through the setup? It has access to all of Supabase's documentation, understands your project structure, and can help you build on top of what you've created. That's not a one-time trick for getting unstuck during setup. That's a permanent building partner.

Want to add a new capture source beyond Slack? Ask it how to create another Edge Function. Want to add a new field to your thoughts table? Ask it to help you write the SQL migration. Want to understand how to add authentication so you can share your brain with a teammate? It knows the docs better than you ever will.

You just built AI infrastructure using AI. That pattern doesn't stop here.

Got stuck or want to share what you've built? Join the [Open Brain Discord](https://discord.gg/Cgh9WJEkeG) — there's a `#help` channel for troubleshooting and a `#show-and-tell` channel for showing off.

---

## Your Next Step

Your Open Brain is live. Now make it work for you. The **[Companion Prompts](02-companion-prompts.md)** cover the full lifecycle from here:

- **Memory Migration** — Pull everything your AI already knows about you into your brain so every tool starts with context instead of zero
- **Second Brain Migration** — Bring your existing notes from Notion, Obsidian, or any other system into your Open Brain without starting over
- **Open Brain Spark** — Personalized use case discovery based on your actual workflow, not generic examples
- **Quick Capture Templates** — Five patterns optimized for clean metadata extraction so your brain tags and retrieves accurately
- **The Weekly Review** — A Friday ritual that surfaces themes, forgotten action items, and connections you missed

Start with the Memory Migration. If you have an existing second brain, run the Second Brain Migration next. Then use the Spark to figure out what to capture going forward. The templates build the daily habit. The weekly review closes the loop.

---

*Built by Nate B. Jones — companion to "Your Second Brain Is Closed. Your AI Can't Use It. Here's the Fix."*
