#!/bin/bash
set -e

# ─── Open Brain on Cloudflare — Automated Setup ─────────────────────────
# This script builds your entire Open Brain infrastructure on Cloudflare:
#   - D1 database with schema
#   - Vectorize index
#   - Worker with MCP server, REST API, and Slack capture
#   - Access key generation
#   - Deployment
#
# Prerequisites:
#   - Node.js 18+ installed
#   - npm installed
#   - Logged into Cloudflare via `wrangler login`
#
# Usage:
#   chmod +x setup-open-brain.sh
#   ./setup-open-brain.sh                  # defaults to "open-brain"
#   ./setup-open-brain.sh my-brain         # custom name
#   ./setup-open-brain.sh open-brain-test  # another custom name
#   ./setup-open-brain.sh --delete         # delete default "open-brain"
#   ./setup-open-brain.sh --delete my-brain  # delete a named brain
# ─────────────────────────────────────────────────────────────────────────

BLUE='\033[0;34m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

# ─── Argument Parsing ───────────────────────────────────────────────────
DELETE_MODE=false
BRAIN_NAME="open-brain"

for arg in "$@"; do
  if [ "$arg" = "--delete" ]; then
    DELETE_MODE=true
  elif [[ "$arg" != --* ]]; then
    BRAIN_NAME="$arg"
  fi
done

# Validate name: lowercase alphanumeric and hyphens only
if [[ ! "$BRAIN_NAME" =~ ^[a-z0-9][a-z0-9-]*[a-z0-9]$ ]]; then
  echo -e "${RED}✘ Invalid name '${BRAIN_NAME}'. Use lowercase letters, numbers, and hyphens only.${NC}"
  exit 1
fi

PROJECT_DIR="${BRAIN_NAME}-worker"
INDEX_NAME="${BRAIN_NAME}-index"

# ─── Delete Mode ─────────────────────────────────────────────────────────
if [ "$DELETE_MODE" = true ]; then
  echo -e "${RED}╔══════════════════════════════════════════════╗${NC}"
  echo -e "${RED}║   Open Brain on Cloudflare — DELETE          ║${NC}"
  echo -e "${RED}╚══════════════════════════════════════════════╝${NC}"
  echo ""
  echo -e "${RED}This will permanently delete:${NC}"
  echo -e "  • Worker:          ${BRAIN_NAME}"
  echo -e "  • D1 Database:     ${BRAIN_NAME} (all thoughts lost)"
  echo -e "  • Vectorize Index: ${INDEX_NAME} (all embeddings lost)"
  echo -e "  • Worker Secrets:  MCP_ACCESS_KEY"
  echo ""
  read -p "Type '${BRAIN_NAME}' to confirm deletion: " CONFIRM
  if [ "$CONFIRM" != "$BRAIN_NAME" ]; then
    echo -e "${YELLOW}Aborted. Nothing was deleted.${NC}"
    exit 0
  fi
  echo ""

  # Delete Worker
  echo -e "${YELLOW}▸ Deleting Worker '${BRAIN_NAME}'...${NC}"
  if wrangler delete --name "$BRAIN_NAME" --force 2>/dev/null; then
    echo -e "${GREEN}✔ Worker deleted${NC}"
  else
    echo -e "${YELLOW}  Worker '${BRAIN_NAME}' not found or already deleted.${NC}"
  fi

  # Delete Vectorize Index
  echo -e "${YELLOW}▸ Deleting Vectorize index '${INDEX_NAME}'...${NC}"
  if wrangler vectorize delete "$INDEX_NAME" --force 2>/dev/null; then
    echo -e "${GREEN}✔ Vectorize index deleted${NC}"
  else
    echo -e "${YELLOW}  Index '${INDEX_NAME}' not found or already deleted.${NC}"
  fi

  # Delete D1 Database
  echo -e "${YELLOW}▸ Deleting D1 database '${BRAIN_NAME}'...${NC}"
  D1_ID=$(wrangler d1 list 2>&1 | grep "$BRAIN_NAME" | awk '{print $1}')
  if [ -n "$D1_ID" ]; then
    if wrangler d1 delete "$BRAIN_NAME" -y 2>/dev/null; then
      echo -e "${GREEN}✔ D1 database deleted${NC}"
    else
      echo -e "${YELLOW}  Could not delete D1 database. Try manually: wrangler d1 delete ${BRAIN_NAME}${NC}"
    fi
  else
    echo -e "${YELLOW}  Database '${BRAIN_NAME}' not found or already deleted.${NC}"
  fi

  # Offer to delete local project directory
  if [ -d "$PROJECT_DIR" ]; then
    echo ""
    read -p "Delete local project directory '${PROJECT_DIR}'? (y/N): " DELETE_DIR
    if [[ "$DELETE_DIR" =~ ^[Yy]$ ]]; then
      rm -rf "$PROJECT_DIR"
      echo -e "${GREEN}✔ Local directory deleted${NC}"
    else
      echo -e "${YELLOW}  Local directory kept.${NC}"
    fi
  fi

  echo ""
  echo -e "${GREEN}Done. '${BRAIN_NAME}' has been removed from Cloudflare.${NC}"
  exit 0
fi

# ─── Setup Mode ──────────────────────────────────────────────────────────

echo -e "${BLUE}╔══════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║   Open Brain on Cloudflare — Setup Script    ║${NC}"
echo -e "${BLUE}╚══════════════════════════════════════════════╝${NC}"
echo ""
echo -e "${GREEN}Brain name:${NC}  ${BRAIN_NAME}"
echo -e "${GREEN}Project dir:${NC} ${PROJECT_DIR}"
echo ""

# ─── Preflight Checks ───────────────────────────────────────────────────
echo -e "${YELLOW}▸ Running preflight checks...${NC}"

if ! command -v node &> /dev/null; then
  echo -e "${RED}✘ Node.js not found. Install Node.js 18+ and try again.${NC}"
  exit 1
fi

if ! command -v npx &> /dev/null; then
  echo -e "${RED}✘ npx not found. Install npm and try again.${NC}"
  exit 1
fi

# Install wrangler globally if not present
if ! command -v wrangler &> /dev/null; then
  echo -e "${YELLOW}▸ Installing wrangler...${NC}"
  npm install -g wrangler@latest
fi

# Check wrangler auth
if ! wrangler whoami &> /dev/null 2>&1; then
  echo -e "${YELLOW}▸ Not logged into Cloudflare. Opening browser for login...${NC}"
  wrangler login
fi

WHOAMI=$(wrangler whoami 2>&1)
echo -e "${GREEN}✔ Logged in as: ${WHOAMI}${NC}"

# ─── Generate Access Key ────────────────────────────────────────────────
echo ""
echo -e "${YELLOW}▸ Generating MCP access key...${NC}"
MCP_ACCESS_KEY=$(openssl rand -hex 32)
echo -e "${GREEN}✔ Access key generated${NC}"

# ─── Create D1 Database ─────────────────────────────────────────────────
echo ""
echo -e "${YELLOW}▸ Creating D1 database '${BRAIN_NAME}'...${NC}"

# Check if database already exists
EXISTING_DB=$(wrangler d1 list 2>&1 | grep "$BRAIN_NAME" || true)
if [ -n "$EXISTING_DB" ]; then
  echo -e "${YELLOW}  Database '${BRAIN_NAME}' already exists. Reusing it.${NC}"
  D1_ID=$(wrangler d1 list 2>&1 | grep "$BRAIN_NAME" | awk '{print $1}')
else
  D1_OUTPUT=$(wrangler d1 create "$BRAIN_NAME" 2>&1)
  D1_ID=$(echo "$D1_OUTPUT" | grep -oE '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}')
fi

if [ -z "$D1_ID" ]; then
  echo -e "${RED}✘ Failed to get D1 database ID. Output:${NC}"
  echo "$D1_OUTPUT"
  exit 1
fi
echo -e "${GREEN}✔ D1 database ID: ${D1_ID}${NC}"

# ─── Create Vectorize Index ─────────────────────────────────────────────
echo ""
echo -e "${YELLOW}▸ Creating Vectorize index '${INDEX_NAME}'...${NC}"

EXISTING_INDEX=$(wrangler vectorize list 2>&1 | grep "$INDEX_NAME" || true)
if [ -n "$EXISTING_INDEX" ]; then
  echo -e "${YELLOW}  Index '${INDEX_NAME}' already exists. Reusing it.${NC}"
else
  wrangler vectorize create "$INDEX_NAME" --dimensions=768 --metric=cosine
fi
echo -e "${GREEN}✔ Vectorize index ready${NC}"

# ─── Create Project Directory ────────────────────────────────────────────
echo ""
echo -e "${YELLOW}▸ Creating project directory '${PROJECT_DIR}'...${NC}"

if [ -d "$PROJECT_DIR" ]; then
  echo -e "${YELLOW}  Directory already exists. Backing up to ${PROJECT_DIR}.bak${NC}"
  mv "$PROJECT_DIR" "${PROJECT_DIR}.bak.$(date +%s)"
fi

mkdir -p "$PROJECT_DIR/src"
cd "$PROJECT_DIR"

# ─── package.json ────────────────────────────────────────────────────────
cat > package.json << 'EOF'
{
  "name": "${BRAIN_NAME}",
  "version": "1.0.0",
  "private": true,
  "scripts": {
    "deploy": "wrangler deploy",
    "dev": "wrangler dev",
    "tail": "wrangler tail"
  }
}
EOF

# ─── wrangler.toml ──────────────────────────────────────────────────────
cat > wrangler.toml << EOF
name = "${BRAIN_NAME}"
main = "src/index.ts"
compatibility_date = "2024-12-01"
workers_dev = true
preview_urls = true

[ai]
binding = "AI"

[[d1_databases]]
binding = "DB"
database_name = "${BRAIN_NAME}"
database_id = "${D1_ID}"

[[vectorize]]
binding = "VECTORIZE"
index_name = "${INDEX_NAME}"
EOF

# ─── D1 Schema ──────────────────────────────────────────────────────────
cat > schema.sql << 'EOF'
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
EOF

# ─── Worker Source ───────────────────────────────────────────────────────
cat > src/index.ts << 'WORKER_EOF'
export interface Env {
  DB: D1Database;
  AI: Ai;
  VECTORIZE: VectorizeIndex;
  MCP_ACCESS_KEY: string;
}

// ─── Auth ───────────────────────────────────────────────────────────────
function authenticate(request: Request, env: Env): boolean {
  const authHeader = request.headers.get("Authorization");
  if (authHeader) {
    const token = authHeader.replace("Bearer ", "");
    if (token === env.MCP_ACCESS_KEY) return true;
  }
  const url = new URL(request.url);
  const keyParam = url.searchParams.get("key");
  if (keyParam === env.MCP_ACCESS_KEY) return true;
  return false;
}

// ─── Embedding Generation ───────────────────────────────────────────────
async function generateEmbedding(ai: Ai, text: string): Promise<number[]> {
  const result = await ai.run("@cf/baai/bge-base-en-v1.5", {
    text: [text],
  });
  return result.data[0];
}

// ─── Metadata Extraction ────────────────────────────────────────────────
async function extractMetadata(ai: Ai, content: string): Promise<object> {
  const result = await ai.run("@cf/meta/llama-3.1-8b-instruct", {
    messages: [
      {
        role: "system",
        content: `Extract metadata from the following thought. Return ONLY valid JSON with these fields:
          - type: one of "idea", "task", "observation", "memory", "question", "reference"
          - topics: array of 1-3 topic tags (lowercase, short)
          - people: array of any people mentioned (empty array if none)
          - sentiment: one of "positive", "negative", "neutral"
          - priority: one of "high", "medium", "low"
        Return ONLY the JSON object, no explanation.`,
      },
      { role: "user", content },
    ],
    max_tokens: 200,
  });

  try {
    const text = (result as any).response;
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
    return { type: "observation", topics: [], people: [], sentiment: "neutral", priority: "medium" };
  } catch {
    return { type: "observation", topics: [], people: [], sentiment: "neutral", priority: "medium" };
  }
}

// ─── Capture a Thought (sync: D1 write, returns immediately) ────────────
async function captureThought(
  env: Env,
  content: string,
  source: string = "mcp"
): Promise<{ id: string }> {
  const id = crypto.randomUUID().replace(/-/g, "");

  // Synchronous: write to D1 immediately — thought is queryable via FTS and list
  await env.DB.prepare(
    `INSERT INTO thoughts (id, content, metadata, source, embedded, created_at, updated_at)
     VALUES (?, ?, '{}', ?, 0, datetime('now'), datetime('now'))`
  )
    .bind(id, content, source)
    .run();

  return { id };
}

// ─── Embed a Thought (async: embedding + metadata + vectorize) ──────────
async function embedThought(env: Env, id: string, content: string, source: string): Promise<void> {
  try {
    const [embedding, metadata] = await Promise.all([
      generateEmbedding(env.AI, content),
      extractMetadata(env.AI, content),
    ]);

    // Update D1 with extracted metadata and mark as embedded
    await env.DB.prepare(
      `UPDATE thoughts SET metadata = ?, embedded = 1, updated_at = datetime('now') WHERE id = ?`
    )
      .bind(JSON.stringify(metadata), id)
      .run();

    // Upsert vector into Vectorize
    await env.VECTORIZE.upsert([
      {
        id,
        values: embedding,
        metadata: {
          source,
          ...(metadata as Record<string, any>),
        },
      },
    ]);
  } catch (err) {
    console.error(`Failed to embed thought ${id}:`, err);
    // Thought remains in D1 with embedded=0 for retry
  }
}

// ─── Embed Any Pending Thoughts (batch) ─────────────────────────────────
async function embedPending(env: Env, limit: number = 10): Promise<number> {
  const { results } = await env.DB.prepare(
    `SELECT id, content, source FROM thoughts WHERE embedded = 0 ORDER BY created_at ASC LIMIT ?`
  )
    .bind(limit)
    .all();

  if (!results || results.length === 0) return 0;

  await Promise.all(
    results.map((r: any) => embedThought(env, r.id, r.content, r.source))
  );

  return results.length;
}

// ─── Search Thoughts ────────────────────────────────────────────────────
async function searchThoughts(
  env: Env,
  query: string,
  topK: number = 10
): Promise<any[]> {
  const queryEmbedding = await generateEmbedding(env.AI, query);

  const vectorResults = await env.VECTORIZE.query(queryEmbedding, {
    topK,
    returnMetadata: "all",
  });

  if (!vectorResults.matches || vectorResults.matches.length === 0) {
    return [];
  }

  const ids = vectorResults.matches.map((m) => m.id);
  const placeholders = ids.map(() => "?").join(",");
  const { results } = await env.DB.prepare(
    `SELECT id, content, metadata, source, created_at FROM thoughts WHERE id IN (${placeholders})`
  )
    .bind(...ids)
    .all();

  const thoughtMap = new Map(results?.map((r: any) => [r.id, r]) || []);
  return vectorResults.matches
    .map((match) => {
      const thought = thoughtMap.get(match.id);
      if (!thought) return null;
      return {
        id: match.id,
        content: (thought as any).content,
        metadata: JSON.parse((thought as any).metadata || "{}"),
        source: (thought as any).source,
        created_at: (thought as any).created_at,
        score: match.score,
      };
    })
    .filter(Boolean);
}

// ─── List Recent Thoughts ───────────────────────────────────────────────
async function listRecent(env: Env, limit: number = 20): Promise<any[]> {
  const { results } = await env.DB.prepare(
    `SELECT id, content, metadata, source, created_at
     FROM thoughts ORDER BY created_at DESC LIMIT ?`
  )
    .bind(limit)
    .all();

  return (results || []).map((r: any) => ({
    ...r,
    metadata: JSON.parse(r.metadata || "{}"),
  }));
}

// ─── JSON-RPC Helpers ───────────────────────────────────────────────────
function jsonrpc(id: any, result: any): Response {
  return Response.json({ jsonrpc: "2.0", id, result });
}

function jsonrpcError(id: any, code: number, message: string): Response {
  return Response.json({ jsonrpc: "2.0", id, error: { code, message } });
}

// ─── MCP Tool Definitions ───────────────────────────────────────────────
const MCP_TOOLS = [
  {
    name: "capture_thought",
    description:
      "Save a thought, idea, observation, or any piece of information to your Open Brain. The system will automatically generate a semantic embedding and extract metadata.",
    inputSchema: {
      type: "object",
      properties: {
        content: {
          type: "string",
          description: "The thought content to capture",
        },
        source: {
          type: "string",
          description: "Where this thought came from (e.g., 'claude', 'chatgpt', 'manual')",
          default: "mcp",
        },
      },
      required: ["content"],
    },
  },
  {
    name: "search_thoughts",
    description:
      "Search your Open Brain by meaning. Returns thoughts semantically similar to your query, ranked by relevance.",
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "What you're looking for — natural language works best",
        },
        limit: {
          type: "number",
          description: "Maximum number of results (default 10)",
          default: 10,
        },
      },
      required: ["query"],
    },
  },
  {
    name: "list_recent",
    description:
      "List your most recent thoughts, newest first.",
    inputSchema: {
      type: "object",
      properties: {
        limit: {
          type: "number",
          description: "Number of thoughts to return (default 20)",
          default: 20,
        },
      },
    },
  },
];

// ─── MCP Protocol Handler ───────────────────────────────────────────────
async function handleMCP(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const body: any = await request.json();
  const { method, params, id } = body;

  // Notifications (no id) — no response expected
  if (id === undefined || id === null) {
    return new Response(null, { status: 202 });
  }

  switch (method) {
    case "initialize":
      return jsonrpc(id, {
        protocolVersion: "2025-11-25",
        capabilities: {
          tools: { listChanged: false },
        },
        serverInfo: {
          name: "__BRAIN_NAME__",
          version: "1.0.0",
        },
      });

    case "ping":
      return jsonrpc(id, {});

    case "tools/list":
      return jsonrpc(id, { tools: MCP_TOOLS });

    case "tools/call": {
      const toolName = params?.name;
      const args = params?.arguments || {};

      switch (toolName) {
        case "capture_thought": {
          const source = args.source || "mcp";
          const result = await captureThought(env, args.content, source);
          // Async: embed in background — response returns immediately
          ctx.waitUntil(embedThought(env, result.id, args.content, source));
          return jsonrpc(id, {
            content: [
              {
                type: "text",
                text: `Thought captured (id: ${result.id}). Embedding in background — semantic search available shortly.`,
              },
            ],
          });
        }

        case "search_thoughts": {
          const results = await searchThoughts(env, args.query, args.limit || 10);
          if (results.length === 0) {
            return jsonrpc(id, {
              content: [
                { type: "text", text: "No matching thoughts found." },
              ],
            });
          }
          const formatted = results
            .map(
              (r: any, i: number) =>
                `${i + 1}. [${r.score.toFixed(3)}] (${r.created_at}) ${r.content}`
            )
            .join("\n\n");
          return jsonrpc(id, {
            content: [{ type: "text", text: formatted }],
          });
        }

        case "list_recent": {
          const results = await listRecent(env, args.limit || 20);
          if (results.length === 0) {
            return jsonrpc(id, {
              content: [{ type: "text", text: "No thoughts captured yet." }],
            });
          }
          const formatted = results
            .map(
              (r: any, i: number) =>
                `${i + 1}. (${r.created_at}) [${r.source}] ${r.content}`
            )
            .join("\n\n");
          return jsonrpc(id, {
            content: [{ type: "text", text: formatted }],
          });
        }

        default:
          return jsonrpcError(id, -32601, `Unknown tool: ${toolName}`);
      }
    }

    default:
      return jsonrpcError(id, -32601, `Method not found: ${method}`);
  }
}

// ─── Slack Handler (Optional) ───────────────────────────────────────────
async function handleSlack(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const body = await request.text();

  try {
    const json = JSON.parse(body);
    if (json.type === "url_verification") {
      return new Response(json.challenge, { status: 200 });
    }

    if (json.type === "event_callback" && json.event?.type === "message") {
      const event = json.event;
      if (event.bot_id || event.subtype) {
        return new Response("ok", { status: 200 });
      }
      if (event.text) {
        const result = await captureThought(env, event.text, "slack");
        ctx.waitUntil(embedThought(env, result.id, event.text, "slack"));
      }
    }
  } catch {
    // Not JSON — ignore
  }

  return new Response("ok", { status: 200 });
}

// ─── Main Router ────────────────────────────────────────────────────────
export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    // Health check
    if (url.pathname === "/" && request.method === "GET") {
      return new Response("Open Brain on Cloudflare is running.", { status: 200 });
    }

    // OAuth discovery — return 404 so mcp-remote skips OAuth
    if (url.pathname.startsWith("/.well-known/")) {
      return new Response("Not found", { status: 404 });
    }

    // MCP — GET for transport discovery
    if (url.pathname === "/mcp" && request.method === "GET") {
      return new Response("Method not allowed", { status: 405 });
    }

    // MCP — DELETE for session cleanup
    if (url.pathname === "/mcp" && request.method === "DELETE") {
      return new Response(null, { status: 200 });
    }

    // MCP endpoint — before global auth so handshake works
    if (url.pathname === "/mcp" && request.method === "POST") {
      return handleMCP(request, env, ctx);
    }

    // All other routes require auth
    if (!authenticate(request, env)) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    // REST: Capture
    if (url.pathname === "/capture" && request.method === "POST") {
      const { content, source } = (await request.json()) as any;
      if (!content) {
        return Response.json({ error: "content is required" }, { status: 400 });
      }
      const src = source || "api";
      const result = await captureThought(env, content, src);
      ctx.waitUntil(embedThought(env, result.id, content, src));
      return Response.json({ ...result, status: "captured, embedding in background" });
    }

    // REST: Search
    if (url.pathname === "/search" && request.method === "POST") {
      const { query, limit } = (await request.json()) as any;
      if (!query) {
        return Response.json({ error: "query is required" }, { status: 400 });
      }
      const results = await searchThoughts(env, query, limit || 10);
      return Response.json({ results });
    }

    // REST: Recent
    if (url.pathname === "/recent" && request.method === "GET") {
      const limit = parseInt(url.searchParams.get("limit") || "20");
      const results = await listRecent(env, limit);
      return Response.json({ results });
    }

    // REST: Process pending embeddings
    if (url.pathname === "/embed-pending" && request.method === "POST") {
      const limit = parseInt(url.searchParams.get("limit") || "10");
      const count = await embedPending(env, limit);
      return Response.json({ processed: count });
    }

    // Slack webhook (optional)
    if (url.pathname === "/slack" && request.method === "POST") {
      return handleSlack(request, env, ctx);
    }

    return Response.json({ error: "Not found" }, { status: 404 });
  },
};
WORKER_EOF

# Replace placeholder with actual brain name in worker source
sed -i'' -e "s/__BRAIN_NAME__/${BRAIN_NAME}/g" src/index.ts

echo -e "${GREEN}✔ Project files created${NC}"

# ─── Apply D1 Schema ────────────────────────────────────────────────────
echo ""
echo -e "${YELLOW}▸ Applying D1 schema...${NC}"
wrangler d1 execute "$BRAIN_NAME" --remote --file=schema.sql
echo -e "${GREEN}✔ Schema applied${NC}"

# ─── Deploy Worker ───────────────────────────────────────────────────────
echo ""
echo -e "${YELLOW}▸ Deploying Worker...${NC}"
wrangler deploy
echo -e "${GREEN}✔ Worker deployed${NC}"

# ─── Set Secret ──────────────────────────────────────────────────────────
echo ""
echo -e "${YELLOW}▸ Setting MCP access key secret...${NC}"
echo "$MCP_ACCESS_KEY" | wrangler secret put MCP_ACCESS_KEY
echo -e "${GREEN}✔ Secret set${NC}"

# ─── Get Worker URL ──────────────────────────────────────────────────────
WORKER_URL=$(wrangler deploy 2>&1 | grep -oE 'https://[^ ]+workers\.dev' | head -1)
if [ -z "$WORKER_URL" ]; then
  WORKER_URL="https://${BRAIN_NAME}.<your-subdomain>.workers.dev"
fi

# ─── Output Summary ─────────────────────────────────────────────────────
echo ""
echo -e "${BLUE}╔══════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║       ${BRAIN_NAME} Setup Complete!           ║${NC}"
echo -e "${BLUE}╚══════════════════════════════════════════════╝${NC}"
echo ""
echo -e "${GREEN}Worker URL:${NC}     ${WORKER_URL}"
echo -e "${GREEN}D1 Database ID:${NC} ${D1_ID}"
echo -e "${GREEN}Access Key:${NC}     ${MCP_ACCESS_KEY}"
echo ""
echo -e "── Save These Credentials ─────────────────────────"
echo ""

# Write credentials to file
CRED_FILE="credentials.txt"
cat > "$CRED_FILE" << EOF
${BRAIN_NAME} ON CLOUDFLARE — CREDENTIALS
========================================
Brain Name:       ${BRAIN_NAME}
Worker URL:       ${WORKER_URL}
D1 Database ID:   ${D1_ID}
Vectorize Index:  ${INDEX_NAME}
MCP Access Key:   ${MCP_ACCESS_KEY}
MCP Endpoint:     ${WORKER_URL}/mcp?key=${MCP_ACCESS_KEY}

── Test Commands ──────────────────────────────────

# Health check
curl ${WORKER_URL}/

# Capture a thought
curl -X POST ${WORKER_URL}/capture \\
  -H "Authorization: Bearer ${MCP_ACCESS_KEY}" \\
  -H "Content-Type: application/json" \\
  -d '{"content": "My first thought in Open Brain on Cloudflare."}'

# Search
curl -X POST ${WORKER_URL}/search \\
  -H "Authorization: Bearer ${MCP_ACCESS_KEY}" \\
  -H "Content-Type: application/json" \\
  -d '{"query": "first thought"}'

── Claude Desktop MCP Config ──────────────────────

Add to ~/Library/Application Support/Claude/claude_desktop_config.json:

{
  "mcpServers": {
    "${BRAIN_NAME}": {
      "command": "npx",
      "args": [
        "-y", "mcp-remote",
        "${WORKER_URL}/mcp?key=${MCP_ACCESS_KEY}"
      ]
    }
  }
}

── Claude Code MCP Config ─────────────────────────

Add to .mcp.json:

{
  "mcpServers": {
    "${BRAIN_NAME}": {
      "type": "sse",
      "url": "${WORKER_URL}/mcp?key=${MCP_ACCESS_KEY}"
    }
  }
}
EOF

echo -e "${GREEN}✔ Credentials saved to ${PROJECT_DIR}/${CRED_FILE}${NC}"
echo ""
echo -e "${YELLOW}⚠  Keep ${CRED_FILE} safe — it contains your access key.${NC}"
echo ""
echo -e "── Quick Test ─────────────────────────────────────"
echo ""
echo -e "  curl ${WORKER_URL}/"
echo ""
echo -e "── Next Steps ─────────────────────────────────────"
echo ""
echo -e "  1. Run the test commands in ${CRED_FILE}"
echo -e "  2. Connect Claude Desktop or Claude Code using the MCP config"
echo -e "  3. Start capturing thoughts!"
echo ""
