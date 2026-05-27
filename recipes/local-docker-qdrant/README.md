# Local Docker Open Brain (Qdrant)

> A self-contained Docker deployment of Open Brain using local Qdrant for vector storage and AWS Bedrock for embeddings and metadata extraction. Multi-tenancy-primed with ACL enforcement built in — runs side-by-side with the pgvector recipe.

## What It Does

Deploys a complete Open Brain instance (Qdrant vector store + MCP server + capture clients) as a Docker Compose stack on your local machine. Instead of Supabase cloud and OpenRouter, it uses local [Qdrant](https://qdrant.tech/) for vector storage and AWS Bedrock for embeddings and metadata extraction. All data stays on your machine and within your AWS account.

This is the Qdrant variant of [recipes/local-docker](../local-docker/). The two stacks run independently and can be active at the same time on different ports.

> [!IMPORTANT]
> This recipe uses a **local MCP server** rather than the standard remote (Supabase Edge Function) pattern. This is intentional — it exists for environments with data privacy constraints where sending knowledge to cloud-hosted databases is not permitted. If you don't have this constraint, the standard Open Brain setup with Supabase is simpler.

### What sets this apart from the pgvector recipe

Every thought carries `owner_id`, `visibility`, and `shared_with` fields, and every read operation enforces an ACL filter. Locally, `owner_id` is always `local-user`, so the filter trivially passes — you won't notice the difference day-to-day. The payoff comes in Stage 2, where swapping a single env var (`IDENTITY_MODE=entra`) turns on real user isolation without any data migration.

There is also a sixth MCP tool — `share_thought` — that lets you flip a thought's visibility between `private` and `shared`, and `search_thoughts` gains a `scope` parameter (`"private"`, `"shared"`, or `"all"`) for filtering results by audience.

### When to choose this recipe vs. the pgvector recipe

| Scenario | Recommendation |
|---|---|
| Single-user, simplest possible setup | [recipes/local-docker](../local-docker/) (pgvector) |
| You want ACL/sharing groundwork now | This recipe (Qdrant) |
| You plan to scale to multi-user (Stage 2) | This recipe (Qdrant) |
| You prefer Qdrant's native vector capabilities | This recipe (Qdrant) |
| Already running pgvector and want to migrate | This recipe + `scripts/migrate-pgvector-to-qdrant.mjs` |

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
LOCAL DOCKER OPEN BRAIN (QDRANT) -- CREDENTIAL TRACKER
-------------------------------------------------------

GENERATED DURING SETUP
  MCP access key:        ____________  (Step 1 — openssl rand -hex 32)
  AWS profile name:      ____________  (your existing AWS CLI profile)
  AWS home path:         ____________  (e.g., C:\Users\you\.aws)

-------------------------------------------------------
```

## Steps

![Step 1](https://img.shields.io/badge/Step_1-Configure_Environment-2E7D32?style=for-the-badge)

**1. Copy the environment template:**

```bash
cd recipes/local-docker-qdrant
cp .env.example .env
```

**2. Generate an MCP access key:**

```bash
openssl rand -hex 32
```

**3. Edit `.env` with your values:**

```env
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

Run from inside `recipes/local-docker-qdrant/`:

```bash
docker compose up --build -d
```

This builds the MCP server image and starts two containers:
- **qdrant** — `qdrant/qdrant:v1.16.3` on ports 6333 (HTTP) and 6334 (gRPC), data persisted to a named Docker volume
- **mcp-server** — Node.js 22 on port 3100, performs a Bedrock health check on startup

> [!CAUTION]
> If the health check fails (expired credentials, wrong region, model not enabled), the MCP server container will exit. Check logs with `docker compose logs mcp-server` and fix `.env` before retrying.

`Done when:` `docker compose ps` shows both containers as "running" (healthy).

---

![Step 3](https://img.shields.io/badge/Step_3-Connect_Your_AI_Client-2E7D32?style=for-the-badge)

Register the MCP server with your AI client. Note: this recipe uses port **3100**, not 3000.

For Claude Code:

```bash
claude mcp add open-brain-qdrant --transport http --url http://localhost:3100/mcp --header "x-brain-key: <your-MCP_ACCESS_KEY>"
```

For Claude Desktop: Settings > Connectors > Add custom connector, paste `http://localhost:3100/mcp` and add the `x-brain-key` header.

`Done when:` Your AI client lists 6 tools: `capture_thought`, `search_thoughts`, `list_thoughts`, `thought_stats`, `enrich_thoughts`, `share_thought`.

---

![Step 4](https://img.shields.io/badge/Step_4-Install_Capture_Clients_(Optional)-2E7D32?style=for-the-badge)

The MCP tools handle capture from AI sessions. For capturing from other applications, install one or more human capture clients. All clients in the `clients/` folder are pre-configured for port 3100.

![4.1](https://img.shields.io/badge/4.1-Chrome_Bookmarklet-555?style=for-the-badge&labelColor=2E7D32)

Open `clients/bookmarklet.html` in Chrome and drag the button to your bookmarks bar. On any page:
- **Selected text** is captured with the page title and URL
- **No selection** captures the page URL as a reference

> [!NOTE]
> Chrome blocks mixed-content requests (HTTP from HTTPS pages). The bookmarklet only works on HTTP pages and local files unless you put the server behind HTTPS (e.g., a Caddy reverse proxy).

![4.2](https://img.shields.io/badge/4.2-AutoHotkey_Global_Hotkey_(Windows)-555?style=for-the-badge&labelColor=2E7D32)

Requires [AutoHotkey v2](https://www.autohotkey.com/).

1. Set the `OPEN_BRAIN_KEY` environment variable to your MCP access key
2. Double-click `clients/capture.ahk` to start
3. Press `Ctrl+Shift+B` in any application to capture the selected text

The script auto-detects the source application (Teams, Outlook, Chrome, Edge, Word, etc.) and records it as provenance metadata. POSTs to `http://localhost:3100/capture-external`.

To auto-start: press `Win+R`, type `shell:startup`, drop a shortcut to `clients/capture.ahk` there.

![4.3](https://img.shields.io/badge/4.3-PowerShell_Script-555?style=for-the-badge&labelColor=2E7D32)

```powershell
# Set once in your PowerShell profile:
$env:OPEN_BRAIN_KEY = "<your-MCP_ACCESS_KEY>"

# Capture a thought:
.\clients\capture.ps1 "A thought to capture"

# Or capture from clipboard:
.\clients\capture.ps1
```

![4.4](https://img.shields.io/badge/4.4-Search_UI-555?style=for-the-badge&labelColor=2E7D32)

Open `clients/search.html` directly in Chrome from the filesystem. No build step required.

- Type a query and press Enter for semantic search
- `tag:aws` — browse by topic
- `type:idea` — browse by type
- `source:teams` — browse by source

`Done when:` At least one capture client is installed and you can capture and retrieve a test thought.

---

## Validating Side-by-Side Operation

If you are running both the pgvector and Qdrant stacks simultaneously:

- `curl http://localhost:3000/health` — hits the pgvector MCP server
- `curl http://localhost:3100/health` — hits the Qdrant MCP server

Thoughts captured to one stack are invisible to the other. This is expected — each stack maintains its own independent store. If you want to move existing pgvector data into Qdrant, use the migration script (see below).

**Stopping only the Qdrant stack** leaves the pgvector stack running untouched:

```bash
docker compose -p open-brain-qdrant down
```

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

---

## Tool Surface Area

This recipe exposes 6 MCP tools. As you add more Open Brain extensions, review the [MCP Tool Audit & Optimization Guide](../../docs/05-tool-audit.md) to manage your total tool surface area.

| Tool | Type | Description |
|------|------|-------------|
| `capture_thought` | Write | Save a thought with auto-generated embedding and metadata. Accepts an optional `visibility` parameter (`"private"` or `"shared"`, default `"private"`) |
| `search_thoughts` | Read | Semantic similarity search. Accepts an optional `scope` parameter (`"private"`, `"shared"`, or `"all"`, default `"all"`) |
| `list_thoughts` | Read | Browse recent thoughts with metadata filters |
| `thought_stats` | Read | Aggregate statistics: totals, types, top topics |
| `enrich_thoughts` | Write | Batch metadata extraction for untagged thoughts |
| `share_thought` | Write | **NEW** — Flip the visibility of any thought you own between `"private"` and `"shared"` |

---

## Migration from the pgvector Recipe

If you have an existing pgvector deployment and want to move your data into Qdrant, a migration script is provided:

```bash
# Dry run — shows what would be migrated without writing anything
node scripts/migrate-pgvector-to-qdrant.mjs --dry-run

# Live run
node scripts/migrate-pgvector-to-qdrant.mjs
```

The script reads from the pgvector Postgres instance (must be running) and writes into the Qdrant instance (must be running). Both stacks must be up simultaneously during migration.

---

## Troubleshooting

**Issue: MCP server container exits immediately after starting**

Check `docker compose logs mcp-server`. Most common cause: expired AWS credentials. Refresh your session tokens (`aws sso login` or re-run your assume-role script), then `docker compose restart mcp-server`.

**Issue: Capture/search returns "Error: No credentials found for profile"**

The `AWS_PROFILE` in `.env` doesn't match any profile in your `~/.aws/credentials` file. Verify with `aws configure list --profile <your-profile>`.

**Issue: "model is not accessible" error from Bedrock**

You need to enable model access in the AWS console. Go to Amazon Bedrock > Model access > Request access for both `Titan Text Embeddings V2` and `Claude 3.5 Haiku`. This can take a few minutes to propagate.

**Issue: Qdrant container is unhealthy**

Qdrant's readiness is determined by its `/readyz` endpoint. If the container stays unhealthy, check `docker compose logs qdrant`. Common causes: port 6333 already in use (another Qdrant instance?), or insufficient disk space for the data volume.

**Issue: Bookmarklet doesn't work on HTTPS pages**

This is Chrome's mixed-content policy — it blocks HTTP requests from HTTPS origins. Options:
1. Use the AutoHotkey or PowerShell client instead (they call localhost directly)
2. Put the server behind a local HTTPS reverse proxy (e.g., [Caddy](https://caddyserver.com/))

**Issue: Slow first request after container start**

The first Bedrock call after startup is always slower (~8-10s) due to model loading on the AWS side. Subsequent calls are warm (~2.5-4s). This is expected behavior.

**Issue: Both stacks running but searches return no results from the Qdrant stack**

Check that your AI client connector is pointing to port **3100**, not 3000. The `claude mcp list` command shows the registered URL.

---

## Architecture

For design decisions, collection schema, ACL filter design, payload indexes, and the multi-tenancy roadmap, see [ARCHITECTURE.md](ARCHITECTURE.md).
