# Cloudflare Deployment

<div align="center">

![Community Contribution](https://img.shields.io/badge/OB1_COMMUNITY-Approved_Contribution-2ea44f?style=for-the-badge&logo=github)

**Created by [@aspitz](https://github.com/aspitz)**

*Reviewed and merged by the Open Brain maintainer team — thank you for building the future of AI memory!*

</div>

> Deploy Open Brain entirely on Cloudflare — D1 database, Vectorize semantic search, Workers AI embeddings, and a Worker-based MCP server. No Supabase or OpenRouter required.

## What It Does

This integration rebuilds the full Open Brain stack on Cloudflare's edge platform. Your thoughts database (D1), vector embeddings (Vectorize), AI inference (Workers AI), and MCP server (Cloudflare Worker) all run on a single platform with no external dependencies. The MCP endpoint is a remote URL accessible from any MCP client.

**Stack comparison:**

| Open Brain (Original) | Open Brain (Cloudflare) |
|---|---|
| Supabase PostgreSQL + pgvector | Cloudflare D1 + Vectorize |
| Supabase Edge Functions | Cloudflare Workers |
| OpenRouter (embeddings + LLM) | Workers AI (built-in, no API key) |
| Supabase Row Level Security | Worker-level auth with access key |
| Supabase Dashboard | Wrangler CLI + D1 Console |

## Prerequisites

- A free [Cloudflare account](https://dash.cloudflare.com/sign-up)
- Node.js 18+ installed
- About 15 minutes (automated setup) or 45 minutes (manual)

> [!NOTE]
> You do **not** need a working Supabase-based Open Brain to use this integration. This is a standalone alternative deployment that replaces the entire backend.

## Credential Tracker

Copy this block into a text editor and fill it in as you go.

```text
CLOUDFLARE OPEN BRAIN — CREDENTIALS
====================================
Cloudflare Account ID:    _______________
D1 Database Name:         open-brain
D1 Database ID:           _______________
Vectorize Index Name:     thoughts-index
MCP Access Key:           _______________
Slack Bot Token:          _______________  (optional)
Slack Signing Secret:     _______________  (optional)
Slack Channel ID:         _______________  (optional)
```

> [!CAUTION]
> Fill this in as you go. Some values cannot be retrieved after you leave the page.

---

## Steps

### Automated Setup (Recommended)

The [`setup-open-brain.sh`](setup-open-brain.sh) script handles everything — database creation, Vectorize index, Worker deployment, and secret configuration — in a single command.

```bash
chmod +x setup-open-brain.sh
./setup-open-brain.sh                  # defaults to "open-brain"
./setup-open-brain.sh my-brain         # custom name
```

The script outputs your credentials and MCP config when it finishes. Skip to [Connect Your AI Tools](#connect-your-ai-tools-via-mcp) below.

> [!TIP]
> To tear down everything the script created, run `./setup-open-brain.sh --delete` (or `./setup-open-brain.sh --delete my-brain` for a named brain).

---

### Manual Setup

If you prefer to understand each step, follow along below.

---

![Step 1](https://img.shields.io/badge/Step_1-Install_Wrangler_and_Log_In-1565C0?style=for-the-badge)

Wrangler is Cloudflare's CLI. It's how you create databases, deploy Workers, and manage everything.

```bash
npm install -g wrangler
wrangler login
```

This opens a browser window. Log in to your Cloudflare account and authorize Wrangler.

Get your Account ID from the Cloudflare dashboard (top right → your account → Overview). Paste it into the credential tracker.

> [!IMPORTANT]
> `wrangler whoami` must show your account name before continuing.

---

![Step 2](https://img.shields.io/badge/Step_2-Create_Your_D1_Database-1565C0?style=for-the-badge)

D1 is Cloudflare's serverless SQLite database. It stores your thoughts as text, metadata, and timestamps.

```bash
wrangler d1 create open-brain
```

This outputs a database ID. **Copy it into your credential tracker immediately.**

Now apply the schema:

```bash
wrangler d1 execute open-brain --remote --file=schema.sql
```

<details>
<summary>📋 <strong>SQL: D1 Schema</strong> (click to expand)</summary>

```sql
CREATE TABLE IF NOT EXISTS thoughts (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  content TEXT NOT NULL,
  metadata TEXT DEFAULT '{}',
  source TEXT DEFAULT 'mcp',
  embedded INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_thoughts_created_at ON thoughts(created_at);
CREATE INDEX IF NOT EXISTS idx_thoughts_source ON thoughts(source);
CREATE INDEX IF NOT EXISTS idx_thoughts_embedded ON thoughts(embedded);

CREATE VIRTUAL TABLE IF NOT EXISTS thoughts_fts USING fts5(
  content,
  content_rowid='rowid'
);

CREATE TRIGGER IF NOT EXISTS thoughts_fts_insert AFTER INSERT ON thoughts
BEGIN
  INSERT INTO thoughts_fts(rowid, content) VALUES (NEW.rowid, NEW.content);
END;

CREATE TRIGGER IF NOT EXISTS thoughts_fts_update AFTER UPDATE OF content ON thoughts
BEGIN
  DELETE FROM thoughts_fts WHERE rowid = OLD.rowid;
  INSERT INTO thoughts_fts(rowid, content) VALUES (NEW.rowid, NEW.content);
END;

CREATE TRIGGER IF NOT EXISTS thoughts_fts_delete AFTER DELETE ON thoughts
BEGIN
  DELETE FROM thoughts_fts WHERE rowid = OLD.rowid;
END;
```

</details>

✅ **Done when:** `wrangler d1 execute open-brain --remote --command="SELECT name FROM sqlite_master WHERE type='table';"` shows `thoughts` and `thoughts_fts`.

---

![Step 3](https://img.shields.io/badge/Step_3-Create_Your_Vectorize_Index-1565C0?style=for-the-badge)

Vectorize stores the embeddings — 768-dimensional vectors that capture the *meaning* of each thought. This is what powers semantic search.

```bash
wrangler vectorize create thoughts-index \
  --dimensions=768 \
  --metric=cosine
```

> [!TIP]
> Workers AI's built-in embedding model (`@cf/baai/bge-base-en-v1.5`) outputs 768-dimensional vectors. If you later switch to an OpenAI-compatible model (1,536 dimensions), you'll need to recreate the index.

✅ **Done when:** `wrangler vectorize list` shows `thoughts-index`.

---

![Step 4](https://img.shields.io/badge/Step_4-Generate_Your_Access_Key-1565C0?style=for-the-badge)

Your MCP server will be a public URL. This key locks it down.

```bash
openssl rand -hex 32
```

Copy the output into your credential tracker under **MCP Access Key**.

---

![Step 5](https://img.shields.io/badge/Step_5-Create_the_Worker-1565C0?style=for-the-badge)

This is the brain of the system. One Worker handles both capture and retrieval.

**1. Create the project:**

```bash
mkdir open-brain-worker && cd open-brain-worker
npm init -y
```

**2. Create `wrangler.toml`:**

```toml
name = "open-brain"
main = "src/index.ts"
compatibility_date = "2024-12-01"
workers_dev = true
preview_urls = true

[ai]
binding = "AI"

[[d1_databases]]
binding = "DB"
database_name = "open-brain"
database_id = "YOUR_D1_DATABASE_ID"  # ← paste from credential tracker

[[vectorize]]
binding = "VECTORIZE"
index_name = "thoughts-index"
```

**3. Create `src/index.ts`:**

The full Worker source is in [`src/index.ts`](src/index.ts) in this directory. Copy it into your project, or use the automated setup script which generates it for you.

<details>
<summary>📋 <strong>Worker source overview</strong> (click to expand)</summary>

The Worker provides:
- **MCP endpoint** (`POST /mcp`) — JSON-RPC handler with `capture_thought`, `search_thoughts`, and `list_recent` tools
- **REST API** — `/capture`, `/search`, `/recent`, `/embed-pending` endpoints
- **Slack webhook** (`POST /slack`) — Optional quick-capture from Slack channels
- **Auth** — Bearer token or query parameter key validation
- **Background embedding** — Thoughts are stored instantly; embedding and metadata extraction happen asynchronously via `ctx.waitUntil`

</details>

---

![Step 6](https://img.shields.io/badge/Step_6-Deploy_and_Set_Your_Secret-1565C0?style=for-the-badge)

```bash
wrangler deploy

wrangler secret put MCP_ACCESS_KEY
# Paste your access key from the credential tracker when prompted
```

Wrangler will output your Worker URL (e.g., `https://open-brain.YOUR_SUBDOMAIN.workers.dev`).

**Test it:**

```bash
# Health check
curl https://open-brain.YOUR_SUBDOMAIN.workers.dev/

# Capture a thought
curl -X POST https://open-brain.YOUR_SUBDOMAIN.workers.dev/capture \
  -H "Authorization: Bearer YOUR_ACCESS_KEY" \
  -H "Content-Type: application/json" \
  -d '{"content": "Testing my Open Brain on Cloudflare. This is my first thought."}'

# Search
curl -X POST https://open-brain.YOUR_SUBDOMAIN.workers.dev/search \
  -H "Authorization: Bearer YOUR_ACCESS_KEY" \
  -H "Content-Type: application/json" \
  -d '{"query": "first thought"}'
```

✅ **Done when:** You can capture a thought and search for it by meaning.

---

## Connect Your AI Tools via MCP

![Step 7](https://img.shields.io/badge/Step_7-Connect_Your_MCP_Client-1565C0?style=for-the-badge)

Your Worker is a remote MCP server accessible by URL.

> [!IMPORTANT]
> The MCP server runs **remotely on Cloudflare Workers**, not locally. The connection methods below all point to your deployed Worker URL — no local stdio server is involved.

### Claude Desktop (Custom Connector)

The preferred method — uses Claude Desktop's built-in remote MCP support:

1. Open Claude Desktop → **Settings** → **Connectors** → **Add custom connector**
2. Paste your Worker MCP endpoint URL:
   ```
   https://open-brain.YOUR_SUBDOMAIN.workers.dev/mcp?key=YOUR_ACCESS_KEY
   ```
3. Click **Save**. The Open Brain tools should appear immediately.

### Claude Desktop (via mcp-remote)

If the custom connector method doesn't work for your setup, you can use `mcp-remote` as a bridge. Add this to your Claude Desktop MCP config:

```json
{
  "mcpServers": {
    "open-brain": {
      "command": "npx",
      "args": [
        "-y", "mcp-remote",
        "https://open-brain.YOUR_SUBDOMAIN.workers.dev/mcp?key=YOUR_ACCESS_KEY"
      ]
    }
  }
}
```

Restart Claude Desktop. You should see the Open Brain tools available.

### Claude Code

In your project's `.mcp.json` or Claude Code settings, add:

```json
{
  "mcpServers": {
    "open-brain": {
      "type": "sse",
      "url": "https://open-brain.YOUR_SUBDOMAIN.workers.dev/mcp?key=YOUR_ACCESS_KEY"
    }
  }
}
```

### Test It

In Claude (Desktop or Code), try:

> "Save this thought to my Open Brain: I'm exploring how to build a subconscious layer for AI memory systems using Cloudflare Workers."

Then:

> "Search my Open Brain for anything about memory systems."

✅ **Done when:** You can capture and search thoughts from inside your AI client.

---

## Part 3 (Optional): Slack Capture

![Optional](https://img.shields.io/badge/Optional-Slack_Capture-555?style=for-the-badge&labelColor=1565C0)

If you want a quick-capture channel outside your AI tools.

**1. Create a Slack App:**

1. Go to [api.slack.com/apps](https://api.slack.com/apps) → **Create New App** → **From scratch**
2. Name it "Open Brain" and pick your workspace
3. **OAuth & Permissions** → Add Bot Token Scopes: `channels:history`, `channels:read`
4. **Install to Workspace** → Copy the **Bot User OAuth Token** into your credential tracker
5. **Event Subscriptions** → Enable → Set Request URL to:
   ```
   https://open-brain.YOUR_SUBDOMAIN.workers.dev/slack
   ```
6. Subscribe to bot events: `message.channels`
7. Invite the bot to your capture channel: `/invite @Open Brain`

✅ **Done when:** You type a message in Slack and it appears when you search via MCP.

---

## Expected Outcome

After completing the setup, you should have:

- A Cloudflare Worker responding at `https://open-brain.YOUR_SUBDOMAIN.workers.dev/`
- A D1 database storing your thoughts with full-text search
- A Vectorize index providing semantic (meaning-based) search
- Workers AI generating embeddings and extracting metadata — no API keys needed
- MCP tools (`capture_thought`, `search_thoughts`, `list_recent`) accessible from Claude Desktop or Claude Code
- (Optional) Slack messages captured automatically into your brain

Thoughts are queryable via `list_recent` immediately on capture. Semantic search becomes available within a few seconds once background embedding completes.

---

## How It Works Under the Hood

**When you capture a thought:**

```
Your AI client → POST /mcp (capture_thought)
  → SYNCHRONOUS (instant):
      → Write thought text to D1 with embedded=0
      → Return confirmation immediately
  → BACKGROUND (via ctx.waitUntil):
      → Generate embedding via Workers AI (768-dim, @cf/baai/bge-base-en-v1.5)
      → Extract metadata via Workers AI (Llama 3.1 8B)
      → Update D1 row with metadata, set embedded=1
      → Upsert embedding into Vectorize
```

**When you search:**

```
Your AI client → POST /mcp (search_thoughts)
  → Worker generates embedding of your query via Workers AI
  → Vectorize finds most similar vectors (cosine similarity)
  → Worker fetches full thought content from D1 by IDs
  → Results returned ranked by semantic similarity
```

If embedding fails, the thought stays in D1 with `embedded=0` and can be retried via the `/embed-pending` endpoint.

---

## Cost

Cloudflare's free tier covers a surprising amount:

| Service | Free Tier |
|---|---|
| Workers | 100,000 requests/day |
| D1 | 5M reads/day, 100K writes/day, 5 GB storage |
| Vectorize | 5M stored vector dimensions |
| Workers AI | 10,000 neurons/day |

For a personal Open Brain, the free tier will last a long time. At heavy usage, the paid Workers plan ($5/month) removes most limits.

---

## What's Next

This is the foundation. From here you can:

- **Build extensions:** Household knowledge, CRM, meal planning — same patterns as OB1's extensions, adapted for Cloudflare
- **Add a dashboard:** Deploy a Cloudflare Pages site that reads from D1
- **Hybrid search:** Combine Vectorize semantic search with D1 full-text search
- **Switch embedding models:** Workers AI supports multiple models; upgrade without changing infrastructure

---

## Troubleshooting

**"Vectorize query returned no results"**
If you just captured your first thought, give it a few seconds. Vectorize indexing is near-instant but not synchronous. Also check that your embedding dimensions match (768 for bge-base-en-v1.5).

**"Workers AI returned an error"**
Check your Workers AI usage in the Cloudflare dashboard. The free tier has a daily neuron limit. If you're hitting it, consider batching captures or upgrading to the paid plan.

**"D1 query failed"**
Run `wrangler d1 execute open-brain --remote --command="SELECT count(*) FROM thoughts;"` to verify your schema is set up correctly.

**"MCP connection failed in Claude Desktop"**
Double-check the URL and access key in your config. Restart Claude Desktop completely (not just close the window). Check `wrangler tail` to see if requests are reaching your Worker.

**"Slack messages aren't being captured"**
Verify Event Subscriptions shows a green checkmark for your Request URL. Make sure the bot is invited to the channel. Check `wrangler tail` for incoming Slack events.

---

## Tool Surface Area

> This integration exposes 3 MCP tools: `capture_thought`, `search_thoughts`, and `list_recent`. As you add more extensions to your Open Brain, your total tool count grows. See the [MCP Tool Audit & Optimization Guide](../../docs/05-tool-audit.md) for strategies on managing your tool surface area.
