# Local Docker Open Brain

> A fully self-contained Open Brain deployment using Docker, local Postgres + pgvector, and AWS Bedrock — for environments where data cannot leave your infrastructure.

## What It Does

Deploys a complete Open Brain instance (database + MCP server + capture clients) as a Docker Compose stack on your local machine. Instead of Supabase cloud and OpenRouter, it uses local PostgreSQL with pgvector for storage and AWS Bedrock for embeddings and metadata extraction. All data stays on your machine and within your AWS account.

> [!IMPORTANT]
> This recipe uses a **local MCP server** rather than the standard remote (Supabase Edge Function) pattern. This is intentional — it exists for environments with data privacy constraints where sending knowledge to cloud-hosted databases is not permitted. If you don't have this constraint, the standard Open Brain setup with Supabase is simpler.

## Prerequisites

- Working knowledge of the [Open Brain concepts](../../docs/01-getting-started.md) (you don't need a Supabase instance — this replaces it)
- [Docker Desktop](https://www.docker.com/products/docker-desktop/) installed and running
- AWS account with Bedrock model access enabled for:
  - `amazon.titan-embed-text-v2:0` (embeddings)
  - `us.anthropic.claude-haiku-4-5-20251001-v1:0` (metadata extraction)
- [AWS CLI](https://aws.amazon.com/cli/) configured with a profile that has `bedrock:InvokeModel` permissions
- An AI client that supports HTTP-based MCP servers (Claude Code, Claude Desktop, etc.)

## Credential Tracker

Copy this block into a text editor and fill it in as you go.

```text
LOCAL DOCKER OPEN BRAIN -- CREDENTIAL TRACKER
----------------------------------------------

GENERATED DURING SETUP
  Postgres password:     ____________  (Step 1 — openssl rand -hex 16)
  MCP access key:        ____________  (Step 1 — openssl rand -hex 32)
  AWS profile name:      ____________  (your existing AWS CLI profile)
  AWS home path:         ____________  (e.g., C:\Users\you\.aws)

----------------------------------------------
```

## Steps

![Step 1](https://img.shields.io/badge/Step_1-Configure_Environment-2E7D32?style=for-the-badge)

**1. Copy the environment template:**

```bash
cd recipes/local-docker
cp .env.example .env
```

**2. Generate credentials and fill in `.env`:**

```bash
# Generate a strong Postgres password
openssl rand -hex 16

# Generate your MCP access key
openssl rand -hex 32
```

**3. Edit `.env` with your values:**

```env
POSTGRES_PASSWORD=<paste hex from step above>
MCP_ACCESS_KEY=<paste hex from step above>
AWS_HOME=C:\Users\<your-username>\.aws
AWS_REGION=us-east-1
AWS_PROFILE=default
```

> [!TIP]
> On Linux/macOS, use `AWS_HOME=$HOME/.aws`. On Windows, use the full path with backslashes.

> [!WARNING]
> The `AWS_PROFILE` must point to a profile with valid credentials. If you use temporary session tokens (SSO, assume-role), they must be refreshed before the container starts.

`Done when:` `.env` exists with all values filled in, no `change-me` placeholders remain.

---

![Step 2](https://img.shields.io/badge/Step_2-Start_the_Stack-2E7D32?style=for-the-badge)

```bash
docker compose up --build -d
```

This builds the MCP server image and starts two containers:
- **postgres** — `pgvector/pgvector:pg16` on port 5432, auto-initializes schema from `init-db/01-schema.sql`
- **mcp-server** — Node.js 22 on port 3000, performs a Bedrock health check on startup

> [!CAUTION]
> If the health check fails (expired credentials, wrong region, model not enabled), the container will exit. Check logs with `docker compose logs mcp-server` and fix `.env` before retrying.

`Done when:` `docker compose ps` shows both containers as "running" (healthy).

---

![Step 3](https://img.shields.io/badge/Step_3-Connect_Your_AI_Client-2E7D32?style=for-the-badge)

Register the MCP server with your AI client. For Claude Code:

```bash
claude mcp add open-brain --transport http --url http://localhost:3000/mcp --header "x-brain-key: <your-MCP_ACCESS_KEY>"
```

For Claude Desktop: Settings > Connectors > Add custom connector, paste `http://localhost:3000/mcp` and add the `x-brain-key` header.

`Done when:` Your AI client lists 5 tools: `capture_thought`, `search_thoughts`, `list_thoughts`, `thought_stats`, `enrich_thoughts`.

---

![Step 4](https://img.shields.io/badge/Step_4-Install_Capture_Clients_(Optional)-2E7D32?style=for-the-badge)

The MCP tools handle capture from AI sessions. For capturing from other applications, install one or more human capture clients:

![4.1](https://img.shields.io/badge/4.1-Chrome_Bookmarklet-555?style=for-the-badge&labelColor=2E7D32)

Open `bookmarklet.html` in Chrome and drag the button to your bookmarks bar. On any page:
- **Selected text** is captured with the page title and URL
- **No selection** captures the page URL as a reference

> [!NOTE]
> Chrome blocks mixed-content requests (HTTP from HTTPS pages). The bookmarklet only works on HTTP pages and local files unless you put the server behind HTTPS (e.g., Caddy reverse proxy).

![4.2](https://img.shields.io/badge/4.2-AutoHotkey_Global_Hotkey_(Windows)-555?style=for-the-badge&labelColor=2E7D32)

Requires [AutoHotkey v2](https://www.autohotkey.com/).

1. Set the `OPEN_BRAIN_KEY` environment variable to your MCP access key
2. Double-click `capture.ahk` to start
3. Press `Ctrl+Shift+B` in any application to capture the selected text

The script auto-detects the source application (Teams, Outlook, Chrome, Edge, Word, etc.) and records it as provenance metadata.

To auto-start: press `Win+R`, type `shell:startup`, drop a shortcut to `capture.ahk` there.

![4.3](https://img.shields.io/badge/4.3-PowerShell_Script-555?style=for-the-badge&labelColor=2E7D32)

```powershell
# Set once in your PowerShell profile:
$env:OPEN_BRAIN_KEY = "<your-MCP_ACCESS_KEY>"

# Capture a thought:
.\capture.ps1 "A thought to capture"

# Or capture from clipboard:
.\capture.ps1
```

![4.4](https://img.shields.io/badge/4.4-Search_UI-555?style=for-the-badge&labelColor=2E7D32)

Open `search.html` directly in Chrome from the filesystem. No build step required.

- Type a query and press Enter for semantic search
- `tag:aws` — browse by topic
- `type:idea` — browse by type
- `source:teams` — browse by source

`Done when:` At least one capture client is installed and you can capture and retrieve a test thought.

---

## Expected Outcome

After completing all steps:

1. `docker compose ps` shows both containers healthy
2. Your AI client can call `capture_thought` and `search_thoughts` successfully
3. Asking your AI "what do I know about [topic]?" retrieves semantically relevant results
4. Capture latency is ~4s (embedding + metadata in parallel), search is ~2.5s

Test it by capturing a thought and immediately searching for it:
- Capture: "The quarterly planning meeting is moving to Thursdays starting next month"
- Search: "when is planning?" — should return the thought above with high similarity

## Troubleshooting

**Issue: Container exits immediately after starting**

Check `docker compose logs mcp-server`. Most common cause: expired AWS credentials. Refresh your session tokens (`aws sso login` or re-run your assume-role script), then `docker compose restart mcp-server`.

**Issue: Capture/search returns "Error: No credentials found for profile"**

The `AWS_PROFILE` in `.env` doesn't match any profile in your `~/.aws/credentials` file. Verify with `aws configure list --profile <your-profile>`.

**Issue: "model is not accessible" error from Bedrock**

You need to enable model access in the AWS console. Go to Amazon Bedrock > Model access > Request access for both `Titan Text Embeddings V2` and `Claude 3.5 Haiku`. This can take a few minutes to propagate.

**Issue: Bookmarklet doesn't work on HTTPS pages**

This is Chrome's mixed-content policy — it blocks HTTP requests from HTTPS origins. Options:
1. Use the AutoHotkey or PowerShell clients instead (they call localhost directly)
2. Put the server behind a local HTTPS reverse proxy (e.g., [Caddy](https://caddyserver.com/))

**Issue: Slow first request after container start**

The first Bedrock call after startup is always slower (~8-10s) due to model loading on the AWS side. Subsequent calls are warm (~2.5-4s). This is expected behavior.

## Architecture

For detailed design decisions, alternatives considered, and performance benchmarks, see [ARCHITECTURE.md](ARCHITECTURE.md).

## Tool Surface Area

This recipe exposes 5 MCP tools. As you add more Open Brain extensions, review the [MCP Tool Audit & Optimization Guide](../../docs/05-tool-audit.md) to manage your total tool surface area.

| Tool | Type | Description |
|------|------|-------------|
| `capture_thought` | Write | Save a thought with auto-generated embedding and metadata |
| `search_thoughts` | Read | Semantic similarity search across all thoughts |
| `list_thoughts` | Read | Browse recent thoughts with metadata filters |
| `thought_stats` | Read | Aggregate statistics: totals, types, top topics |
| `enrich_thoughts` | Write | Batch metadata extraction for untagged thoughts |
