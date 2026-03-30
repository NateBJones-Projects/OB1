# OB1 — Fully Local Open Brain (Docker)

A fully local, self-hosted Open Brain stack. No cloud services, no API keys, no subscriptions. Everything runs on your machine in Docker.

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│  Your AI Client (Claude Desktop, Claude Code, etc.)     │
│  Talks to OB1 via MCP protocol                          │
└──────────────────────┬──────────────────────────────────┘
                       │ HTTP (port 3000)
                       ▼
              ┌─────────────────┐
              │   ob1-mcp       │  Deno MCP server
              │   (port 3000)   │  Auth, routing, tool dispatch
              └───┬─────────┬───┘
                  │         │
         SQL queries    Embedding + LLM
                  │         │
                  ▼         ▼
        ┌──────────┐  ┌──────────┐
        │ ob1-     │  │ ob1-     │
        │ postgres │  │ ollama   │
        │ (5432)   │  │ (11434)  │
        └──────────┘  └──────────┘
         pgvector       nomic-embed-text
         thoughts       llama3
         table

        ┌──────────┐  ┌──────────┐
        │ ob1-     │  │ ob1-     │
        │ pgadmin  │  │ webui    │
        │ (5050)   │  │ (8080)   │
        └──────────┘  └──────────┘
         DB admin       Ollama admin
```

> **Interactive diagram:** Open [`docs/architecture.html`](docs/architecture.html) in a browser for a visual version with credentials and tool reference.
>
> **Mermaid diagram:** [`docs/architecture.mermaid`](docs/architecture.mermaid) renders on GitHub or any Mermaid-compatible viewer.

## Requirements

- **Docker Desktop** with WSL2 backend (Windows) or Docker Engine (Linux/Mac)
- **NVIDIA GPU** with drivers installed (for GPU acceleration)
  - NVIDIA Container Toolkit must be installed for Docker GPU passthrough
  - Without a GPU, Ollama falls back to CPU (slower but functional)
- **Node.js** (only needed if connecting Claude Desktop via `mcp-remote` bridge)

## Quick Start

```bash
cd docker/

# 1. Copy and edit the environment file
cp .env.example .env
# Edit .env to set your MCP_ACCESS_KEY (generate one with: openssl rand -hex 32)

# 2. Start the stack
bash scripts/start.sh

# 3. Pull the AI models (one-time, ~5GB total)
bash scripts/pull-models.sh

# 4. Connect Claude Code
bash scripts/connect.sh
```

## Services

| Service | URL | Purpose |
|---------|-----|---------|
| **MCP Server** | http://localhost:3000 | MCP endpoint for AI clients |
| **Open WebUI** | http://localhost:8080 | Ollama management & chat UI |
| **pgAdmin** | http://localhost:5050 | PostgreSQL database admin |
| **PostgreSQL** | localhost:5432 | Database (not browser-accessible) |
| **Ollama** | localhost:11434 | LLM API (not browser-accessible) |

## Default Credentials

> **These are local-only defaults.** Change them in `.env` if your machine is network-accessible.

### PostgreSQL

| Field | Value |
|-------|-------|
| Host | `ob1-postgres` (from Docker) or `localhost` (from host) |
| Port | `5432` |
| Database | `openbrain` |
| Username | `openbrain` |
| Password | `openbrain` |

### pgAdmin

| Field | Value |
|-------|-------|
| URL | http://localhost:5050 |
| Email | `admin@openbrain.dev` |
| Password | `openbrain` (matches POSTGRES_PASSWORD) |

### Open WebUI

| Field | Value |
|-------|-------|
| URL | http://localhost:8080 |
| Account | Created on first visit (local only, not sent anywhere) |

### MCP Access Key

| Field | Value |
|-------|-------|
| Key | Set in `.env` as `MCP_ACCESS_KEY` |
| Generate new | `openssl rand -hex 32` |

The access key is required for all MCP requests. It can be passed as:
- Header: `x-brain-key: <key>`
- URL parameter: `?key=<key>`

## Connecting AI Clients

### Claude Code

```bash
bash scripts/connect.sh
```

Or manually:

```bash
claude mcp add --transport http open-brain \
  http://localhost:3000 \
  --header "x-brain-key: YOUR_MCP_ACCESS_KEY"
```

### Claude Desktop (Windows)

Claude Desktop requires HTTPS for connectors, so use the `mcp-remote` bridge. Edit your `claude_desktop_config.json` (Settings → Developer → Edit Config):

```json
{
  "mcpServers": {
    "open-brain": {
      "command": "npx",
      "args": [
        "mcp-remote",
        "http://localhost:3000",
        "--header",
        "x-brain-key:YOUR_MCP_ACCESS_KEY"
      ]
    }
  }
}
```

Requires Node.js installed on Windows. Restart Claude Desktop after saving.

### Other MCP Clients (Cursor, VS Code Copilot, Windsurf)

**Option A — Direct URL** (if client supports remote MCP):

```
http://localhost:3000?key=YOUR_MCP_ACCESS_KEY
```

**Option B — mcp-remote bridge** (if client only supports stdio/JSON config):

```json
{
  "mcpServers": {
    "open-brain": {
      "command": "npx",
      "args": [
        "mcp-remote",
        "http://localhost:3000",
        "--header",
        "x-brain-key:${BRAIN_KEY}"
      ],
      "env": {
        "BRAIN_KEY": "YOUR_MCP_ACCESS_KEY"
      }
    }
  }
}
```

## MCP Tools

Once connected, your AI has 4 tools:

| Tool | Description | Example Prompt |
|------|-------------|----------------|
| `capture_thought` | Save a thought with auto-generated embedding + metadata | "Remember this: Sarah is thinking about leaving her job" |
| `search_thoughts` | Semantic search by meaning | "What did I capture about career changes?" |
| `list_thoughts` | Browse recent thoughts with filters | "Show my thoughts from this week" |
| `thought_stats` | Summary: totals, top topics, people | "How many thoughts do I have?" |

## AI Models

| Model | Purpose | Size |
|-------|---------|------|
| `nomic-embed-text` | Embeddings (768 dimensions) | 274 MB |
| `llama3` | Metadata extraction (topics, people, type) | 4.7 GB |

### Swapping Models

To change the metadata extraction model, edit `LLM_MODEL` in `docker-compose.yml` and restart:

```bash
# Pull the new model first
docker compose exec ob1-ollama ollama pull qwen2.5:32b

# Then update docker-compose.yml: LLM_MODEL: qwen2.5:32b
docker compose up -d ob1-mcp
```

To change the embedding model, you must also update `EMBED_MODEL` in `docker-compose.yml` **and** update the vector dimensions in `init.sql` (e.g., `vector(768)` → `vector(1024)`). This requires a database reset since existing embeddings won't match the new dimensions.

Models can be managed through Open WebUI at http://localhost:8080.

## Management Scripts

All scripts are in `docker/scripts/` and should be run from the `docker/` directory.

| Script | Purpose |
|--------|---------|
| `start.sh` | Start the OB1 stack |
| `stop.sh` | Stop the stack (data preserved in volumes) |
| `status.sh` | Show containers, models, and thought count |
| `logs.sh` | View logs. Usage: `./logs.sh [service] [--follow]` |
| `pull-models.sh` | Pull/update Ollama models |
| `connect.sh` | Connect Claude Code to the MCP server |
| `reset.sh` | Wipe database and start fresh (with confirmation prompt) |

Examples:

```bash
bash scripts/status.sh
bash scripts/logs.sh ob1-mcp --follow
bash scripts/stop.sh
```

## pgAdmin Setup

After logging in at http://localhost:5050:

1. Right-click **Servers** → **Register** → **Server**
2. **General tab** — Name: `OB1`
3. **Connection tab**:
   - Host: `ob1-postgres`
   - Port: `5432`
   - Maintenance database: `openbrain`
   - Username: `openbrain`
   - Password: `openbrain`
   - Toggle **Save password** on
4. Click **Save**

Navigate to: Servers → OB1 → Databases → openbrain → Schemas → public → Tables → thoughts

## Database Schema

### `thoughts` table

| Column | Type | Description |
|--------|------|-------------|
| `id` | uuid | Auto-generated primary key |
| `content` | text | The thought text |
| `embedding` | vector(768) | Semantic embedding from nomic-embed-text |
| `metadata` | jsonb | Extracted metadata (type, topics, people, action_items, etc.) |
| `created_at` | timestamptz | When the thought was captured |
| `updated_at` | timestamptz | Auto-updated on modification |

### `match_thoughts()` function

Semantic search function used by the MCP server:

```sql
SELECT * FROM match_thoughts(
  query_embedding,    -- vector(768)
  match_threshold,    -- float, default 0.7
  match_count,        -- int, default 10
  filter              -- jsonb, default '{}'
);
```

### Indexes

- **HNSW** on `embedding` (cosine similarity) — fast vector search
- **GIN** on `metadata` — fast JSON filtering
- **B-tree** on `created_at DESC` — fast date range queries

## File Structure

```
docker/
├── docker-compose.yml    # Stack definition (5 services)
├── Dockerfile            # Deno MCP server image
├── init.sql              # Database schema (run once on first start)
├── .env                  # Secrets (MCP_ACCESS_KEY, POSTGRES_PASSWORD)
├── .env.example          # Template for .env
├── setup.sh              # Legacy setup script
├── server/
│   ├── index.ts          # MCP server source (Deno + Hono)
│   └── deno.json         # Deno dependencies
├── scripts/
│   ├── start.sh          # Start the stack
│   ├── stop.sh           # Stop the stack
│   ├── status.sh         # Show status
│   ├── logs.sh           # View logs
│   ├── pull-models.sh    # Pull Ollama models
│   ├── connect.sh        # Connect Claude Code
│   └── reset.sh          # Wipe and restart
└── README.md             # This file
```

## Docker Volumes

| Volume | Contents | Survives `docker compose down`? |
|--------|----------|---------------------------------|
| `ob1-pgdata` | PostgreSQL data (all your thoughts) | Yes |
| `ob1-ollama` | Downloaded Ollama models | Yes |
| `ob1-webui` | Open WebUI config and chat history | Yes |
| `ob1-pgadmin` | pgAdmin config and saved servers | Yes |

To fully wipe everything: `docker compose down -v` (destroys all volumes).

## GPU Support

The stack is configured for NVIDIA GPU passthrough. Requirements:

- NVIDIA GPU with up-to-date drivers
- NVIDIA Container Toolkit installed
- Docker Desktop with WSL2 backend (Windows) or Docker Engine with nvidia-container-runtime (Linux)

To verify GPU passthrough works:

```bash
docker run --rm --gpus all nvidia/cuda:12.0.0-base-ubuntu22.04 nvidia-smi
```

If you don't have an NVIDIA GPU, remove the `deploy` section from the `ob1-ollama` service in `docker-compose.yml`:

```yaml
# Remove this block:
deploy:
  resources:
    reservations:
      devices:
        - driver: nvidia
          count: all
          capabilities: [gpu]
```

Ollama will fall back to CPU inference (slower but functional).

## Troubleshooting

**Containers won't start — port already in use**

Another service is using the port. Check with `docker ps` or `netstat -tlnp`. Either stop the conflicting service or change the port mapping in `docker-compose.yml` (e.g., `"3001:3000"`).

**MCP server returns 401**

The access key doesn't match. Verify the key in `.env` matches what you're sending in the header or URL parameter.

**Search returns no results**

Capture at least one thought first. If you have thoughts but search fails, try lowering the threshold: "search with threshold 0.3".

**Ollama is slow (using CPU)**

Check that the `deploy` section with GPU reservations is present in `docker-compose.yml` and that `nvidia-smi` works inside Docker. Restart the ollama container after adding GPU config.

**pgAdmin won't connect to Postgres**

Use `ob1-postgres` as the hostname (Docker internal network name), not `localhost`. Port is `5432`, database/user/password are all `openbrain`.

**Open WebUI can't find Ollama**

The `OLLAMA_BASE_URL` must be `http://ob1-ollama:11434` (Docker internal name). If you changed the service name, update this accordingly.

**Models missing after restart**

Models are stored in the `ob1-ollama` volume and persist across restarts. If you ran `docker compose down -v` (which deletes volumes), you need to re-pull: `bash scripts/pull-models.sh`.
