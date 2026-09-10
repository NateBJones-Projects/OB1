# Open Brain Local Docker — Architecture & Decision Log

## What This Is

A local Docker adaptation of the stock Open Brain (OB1) MCP server. The goal is a
self-contained personal knowledge capture system with no cloud dependencies, suitable
for work content under corporate data privacy constraints.

---

## What We Changed From Stock OB1 and Why

### 1. No Supabase (cloud → local Postgres)

**Stock OB1:** Supabase cloud hosts both the database (Postgres + pgvector) and the
MCP server runtime (Supabase Edge Functions / Deno).

**Our version:** `pgvector/pgvector:pg16` Docker container. Same schema, same SQL
functions (`match_thoughts`, `upsert_thought`), same everything — just running locally.

**Why:** Work content cannot go to arbitrary cloud services. Supabase cloud is out.

---

### 2. No OpenRouter / OpenAI (cloud AI → local or AWS)

**Stock OB1:** OpenRouter proxies to OpenAI for:
- Embeddings: `text-embedding-3-small` → 1536-dim vectors
- Metadata extraction: `gpt-4o-mini`

**Our version (current target):** AWS Bedrock for both:
- Embeddings: `amazon.titan-embed-text-v2:0` → 1024-dim vectors
- Metadata extraction: `anthropic.claude-haiku-4-5-20251001`

**Why:** Same data privacy constraint. AWS Bedrock is already approved — data stays
within the corporate AWS account. Configure your AWS profile and region in `.env`
(see `.env.example`).

**Schema impact:** Vector dimension changed from 1536 → 1024. Both `01-schema.sql`
references updated accordingly.

**We also tried:** Ollama (local, fully offline) with `nomic-embed-text` (768-dim)
and `llama3.2` / `qwen2.5:0.5b`. This worked but was too slow on CPU (~12-16s per
embedding, ~30s+ for metadata extraction). Bedrock is the right answer — sub-second
latency and data stays in AWS.

---

### 3. MCP server runtime — Node.js (ported from Deno)

**Stock OB1:** Deno running in Supabase Edge Functions. Uses `@supabase/supabase-js`
for database access.

**Our version:** Node.js 22 running in a `node:22-alpine` container. Switched database
client from `@supabase/supabase-js` to `postgres` (postgres.js) for direct
Postgres access.

**Key fix made:** postgres.js requires `sql.json()` to pass JSONB parameters — plain
object passing silently stores `{}`. This was the metadata storage bug.

**Why we moved from Deno to Node.js:** The AWS SDK for JavaScript
(`@aws-sdk/client-bedrock-runtime`) is a Node.js SDK. It uses Node.js's `http2`
module which Deno does not fully implement — causing `Not implemented:
Http2Session.settings` at runtime. Node.js is the native target for the AWS SDK:
no shims, no workarounds, clean credential handling via `fromIni`.

**Runtime is inside Docker** — no Node.js installation required on the host machine.
The `node:22-alpine` image is pulled and built as part of `docker compose up`.

**Deno-isms removed in the port:**
- `Deno.env.get()` → `process.env`
- `Deno.serve()` → `@hono/node-server` (`serve()`)
- `NodeHttpHandler` shim → removed (not needed on Node.js)
- `duplex: "half"` request workaround → removed
- `deno.json` import map → standard `package.json`; TypeScript run via `tsx`

---

### 4. AWS Credential Handling

The MCP server needs Bedrock access. Credentials are sourced from your host's `~/.aws/credentials` file via a read-only bind mount, then parsed on every Bedrock call. This is deliberate — the alternatives all have failure modes.

**How it works:**
- `docker-compose.yml` bind-mounts `${AWS_HOME}` → `/root/.aws` as `read_only: true`. The container can read your credentials but cannot modify them.
- `server/index.ts:readCredentials()` parses the standard INI format manually, picks the section named by `AWS_PROFILE`, and returns `{ accessKeyId, secretAccessKey, sessionToken? }`.
- `makeBedrock()` is called fresh per Bedrock request. No SDK credential caching, no module-level singleton. Every request reads the file again.

**Why not the AWS SDK's built-in `fromIni()` / default credential chain:**
- The SDK chain caches credentials in memory. With SSO or assume-role profiles whose tokens expire on the order of hours, that cache goes stale and you get `ExpiredTokenException` until the container is restarted.
- Reading the file per request makes rotation transparent. Run `aws sso login` on the host and the next Bedrock call from the container picks up the new tokens automatically — no container restart needed.

**What never leaves the container:**
- Credentials go to the AWS Bedrock endpoint (HTTPS) and nowhere else.
- They are never written to logs, captured thoughts, or the database.
- They are never copied into the image — only mounted at runtime.

**Trade-offs we rejected:**
- *Inject `AWS_ACCESS_KEY_ID` etc. via env vars* — breaks when tokens rotate.
- *Mount `~/.aws` writable* — unnecessary privilege; we only need to read.
- *Bake credentials into the image* — never. The image is portable; credentials are per-user.

**Operator notes:**
- If `aws configure list --profile <your-profile>` works on the host, the container will see the same credentials.
- Expired credentials cause the startup health check to fail fast (`process.exit(1)`) so the container won't run with broken AWS access.
- On Windows with Git Bash, the `AWS_HOME` env var must be the Windows absolute path (e.g. `C:\Users\you\.aws`), not a translated Unix path. `MSYS_NO_PATHCONV=1` is only needed for `docker exec` commands that mention `/root/...` — the mount itself works correctly without it.

---

## Current Stack

```
postgres (pgvector/pgvector:pg16)
  - Port 5432
  - Data volume: postgres-data
  - Init SQL: local-docker/init-db/01-schema.sql

mcp-server (node:22-alpine)
  - Port 3000
  - Source: local-docker/server/
  - Env: DATABASE_URL, MCP_ACCESS_KEY, AWS_REGION, AWS_PROFILE
  - Volume: ${AWS_HOME} → /root/.aws (read-only)
```

Ollama container was removed — Bedrock replaces it entirely.

---

## REST API (Human Capture Clients)

In addition to the MCP endpoint, the server exposes two plain REST routes for
capture and search from non-MCP clients (browser, scripts, hotkeys). Both use the
same `x-brain-key` authentication header and return plain JSON — no SSE, no
JSON-RPC envelope.

### `POST /capture-external`

Captures a thought from any external source.

**Request body:**
```json
{
  "content": "The thought to capture",
  "source": "teams|outlook|browser-selection|browser-url|clipboard|terminal|...",
  "title": "Optional page or document title",
  "url": "Optional source URL"
}
```

Only `content` is required. `source`, `title`, and `url` are stored as provenance
metadata alongside the AI-extracted fields (`type`, `topics`, `people`, etc.).

**Response:**
```json
{ "id": "uuid", "type": "observation", "topics": ["tag1", "tag2"] }
```

### `POST /search-external`

Searches thoughts semantically or browses by metadata filter.

**Semantic search** (returns top N by vector similarity):
```json
{ "query": "what do I know about X", "limit": 10, "threshold": 0.25 }
```

**Browse by tag/type/source** (returns up to N sorted newest first, no embedding):
```json
{ "tag": "AWS" }
{ "type": "idea" }
{ "source": "teams" }
```

`tag`, `type`, and `source` can be combined. `limit` defaults to 10 for semantic
search and 50 for browse mode.

**Response:**
```json
{
  "mode": "search|browse",
  "results": [
    {
      "id": "uuid",
      "content": "...",
      "similarity": 87,
      "type": "observation",
      "topics": ["tag1"],
      "source": "mcp",
      "created_at": "2026-05-01T..."
    }
  ]
}
```

`similarity` is `null` in browse mode (no ranking).

---

## Human Capture Clients

### `bookmarklet.html`

Open this file locally in Chrome and drag the button to the bookmarks bar. On any
page, click the bookmark to capture:
- **Selected text** → captured with `source: "browser-selection"`, plus `title` and `url`
- **No selection** → captures the page URL with `source: "browser-url"` and `title`

Shows a 3-second toast notification on success. Stores `OPEN_BRAIN_KEY` in
`localStorage` — prompted once, never again.

**Limitation:** Chrome blocks `fetch` to `http://localhost` from `https://` pages
(mixed-content policy). Works on HTTP pages and local files. HTTPS sites (e.g.
Confluence) require the server to be behind HTTPS (e.g. Caddy reverse proxy).

### `capture.ahk`

AutoHotkey v2 script providing a global system hotkey (`Ctrl+Shift+B` by default).
On trigger:
1. Reads the foreground window process name **before** anything steals focus
2. Infers `source` from the active application (Teams, Outlook, Chrome, Edge, Word,
   PowerPoint, OneNote, Windows Terminal → `"desktop"` for anything else)
3. Sends `Ctrl+C` and reads the clipboard
4. Reads `OPEN_BRAIN_KEY` from the environment
5. POSTs to `/capture-external`
6. Shows a tray toast with the result

**To install:** Double-click `capture.ahk` (requires AutoHotkey v2). For startup:
press `Win+R`, type `shell:startup`, drop a shortcut to `capture.ahk` there.

**To change the hotkey:** Edit the `MyHotkey` line at the top of the script.

### `capture.ps1`

PowerShell script for terminal-based capture. Accepts a string argument or reads
from the clipboard if none provided.

```powershell
.\capture.ps1 "A thought to capture"
.\capture.ps1   # reads clipboard
```

Requires `OPEN_BRAIN_KEY` as a user/system environment variable.

### `search.html`

A standalone local search UI — open in Chrome directly from the filesystem. No build
step, no dependencies.

**Usage:**
- Type a query and press Enter for semantic search (top 10 by similarity)
- `tag:aws` — browse all thoughts tagged "aws", newest first
- `type:idea` — browse all thoughts of type "idea", newest first
- `source:teams` — browse all thoughts captured from Teams, newest first

Results show match %, type, source, topics, and date as clickable badges. Clicking a
topic or type badge triggers a browse search for that value. Key stored in
`localStorage`, prompted once.

---

## File Map

```
local-docker/
  docker-compose.yml       — 2-container stack (postgres + mcp-server)
  .env                     — POSTGRES_PASSWORD, MCP_ACCESS_KEY, AWS_PROFILE, AWS_HOME
  .env.example             — template (committed)
  bookmarklet.html         — Chrome bookmarklet installer page
  capture.ahk              — AutoHotkey v2 global hotkey capture script
  capture.ps1              — PowerShell capture script (clipboard or argument)
  search.html              — Standalone browser search UI
  session-audit.mjs        — Utility: audit Claude Code session availability
  timing-test.sh           — Direct HTTP benchmark script (bash timing-test.sh)
  timing.mjs               — Node.js timing utility
  init-db/
    01-schema.sql          — thoughts table, indexes, match_thoughts, upsert_thought
  server/
    index.ts               — MCP + REST server (Node.js/Hono)
    package.json           — npm dependencies
    Dockerfile             — node:22-alpine base
```

---

## How to Run Timing Tests

Timing is measured by calling `date +%s%3N` (milliseconds since epoch) immediately
before and after each MCP tool call, then subtracting. This is done from Claude Code
by interleaving `Bash` tool calls with MCP tool calls in the same response.

Example pattern:

```
1. Bash: date +%s%3N          → capture start timestamp
2. MCP:  capture_thought(...)  → capture call
3. Bash: date +%s%3N          → capture end / search start
4. MCP:  search_thoughts(...)  → search call
5. Bash: date +%s%3N          → search end timestamp
```

Elapsed = (end - start) / 1000 seconds.

**How to run:** From Git Bash in `local-docker/`:

```bash
bash timing-test.sh
```

The script does a warmup call then 3 capture + search pairs, printing elapsed ms for
each. This measures true server latency — not Claude Code round-trip time.

**Important:** Do not use `date +%s%3N` around MCP tool calls in Claude Code to
measure latency. That captures the full Claude Code transport round-trip and produces
wildly inflated numbers (20-60s). Always use the timing script for benchmarks.

---

**Ollama results (CPU only, warm, embedding-only capture — no metadata extraction):**

| Operation | Time |
|---|---|
| Capture (nomic-embed-text, 768-dim, no metadata) | ~12-16s |
| Search (nomic-embed-text) | ~12-15s |

No meaningful difference between Ollama in Docker vs Ollama native on Windows —
virtualization overhead was not the bottleneck. Pure CPU compute.

**Bedrock results (Node.js server, Titan V2 1024-dim + Claude Haiku metadata, warm):**

| Operation | Time |
|---|---|
| Capture (embedding + metadata extraction in parallel) | ~4s |
| Search (embedding only) | ~2.5s |

Bedrock capture includes both Titan V2 embedding AND Claude Haiku metadata extraction
running in parallel — yet still 3-4x faster than Ollama embedding alone on CPU.
Search is embedding-only in both cases, so the 2.5s vs 12-15s gap is pure
Bedrock-vs-CPU difference.

**Estimated self-contained Ollama result with metadata (never fully measured):**
Capture would have been ~40-50s (12-16s embedding + 30s metadata extraction
sequentially). This was why metadata extraction was decoupled from capture in the
Ollama configuration.

**Note on "cold" vs "warm":** First call after container start is slow (model loading).
Subsequent calls are the warm numbers above. Always run at least one throwaway call
before recording benchmark numbers.

---

## What Works Today

- Postgres + pgvector schema initializes correctly
- MCP server starts and serves all 5 tools
- Auth (`x-brain-key` header) works on all endpoints
- All 5 MCP tools work correctly:
  - `capture_thought` — stores content + metadata, updates embedding
  - `search_thoughts` — vector similarity search with threshold
  - `list_thoughts` — filtered recent thoughts
  - `thought_stats` — aggregated counts
  - `enrich_thoughts` — batch metadata extraction for untagged thoughts
- REST endpoints work:
  - `POST /capture-external` — plain JSON capture from any HTTP client
  - `POST /search-external` — semantic search and metadata browse
- Chrome bookmarklet captures selected text or page URL from any HTTP page
- AutoHotkey global hotkey captures from any Windows application
- PowerShell capture script works from terminal
- Standalone search UI works from local filesystem
- Claude Code MCP connection works (`claude mcp add --transport http --scope user`)
- Credential file mount works (Windows path required)
- AWS credential rotation is handled automatically — `makeBedrock()` reads fresh
  credentials on every call; no restart required after token rotation

## What Does Not Work / Known Limitations

- Bookmarklet is blocked by Chrome's mixed-content policy on HTTPS pages — requires
  HTTPS on the server side to work on sites like Confluence
- Startup health check calls `process.exit(1)` on Bedrock failure — if the container
  restarts during an auth outage it will not come back up until credentials are valid
