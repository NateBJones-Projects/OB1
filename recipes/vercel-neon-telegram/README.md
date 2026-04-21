# Vercel + Neon + Telegram

An alternative Open Brain architecture that replaces Cloudflare Workers with **Vercel serverless functions**, Supabase with **Neon Postgres** (pgvector), and Slack with **Telegram** for mobile capture. Uses the **Vercel AI SDK** with OpenAI directly — no OpenRouter required.

## What It Does

Deploys a complete Open Brain on the Vercel + Neon stack with four capture channels:

- **MCP server** — ChatGPT, Claude Desktop, Claude Code, Cursor, and any MCP-compatible client can read and write thoughts
- **Telegram bot** — capture thoughts from your phone, search with `/search <query>`
- **HTTP API** — direct REST endpoint for scripts, shortcuts, and automation
- **CLI function** — one-liner bash function for terminal capture

All thoughts are embedded with `text-embedding-3-small`, classified by `gpt-4o-mini`, stored in Neon with pgvector, and searchable via cosine similarity.

## Prerequisites

- A working Open Brain setup (completed the [Getting Started guide](../../docs/01-getting-started.md))
- A [Neon](https://neon.tech) account (free tier)
- A [Vercel](https://vercel.com) account (free tier)
- An [OpenAI](https://platform.openai.com) API key
- A [Telegram](https://telegram.org) account (for mobile capture — optional)
- Node.js 18+

## Architecture

```
Telegram (phone)  ──→  Vercel Function  ──→  Neon Postgres (pgvector)
CLI (terminal)    ──→  /api/capture     ──→    thoughts table
MCP clients       ──→  /api/mcp         ──→    match_thoughts()
                           ↓
                     Vercel AI SDK  ──→  OpenAI API
                     (embed + extract)   (text-embedding-3-small + gpt-4o-mini)
```

**3 services total.** Monthly cost: ~$0.10–0.30 (API calls only, infrastructure on free tiers).

## Step-by-Step Instructions

### 1. Clone and install

```bash
git clone https://github.com/YOUR_USERNAME/open-brain-vercel-neon.git
cd open-brain-vercel-neon
npm install
```

Or copy the source files from this recipe into a new directory and run `npm install`.

### 2. Create a Neon project

1. Go to [console.neon.tech](https://console.neon.tech)
2. Create a new project (name it anything — e.g., "open-brain")
3. Copy the connection string

### 3. Generate an access key

```bash
npm run generate-key
```

Save the output — you'll need it for the `.env.local` file and for connecting clients.

### 4. Configure environment variables

Create `.env.local` from the template:

```bash
cp .env.example .env.local
```

Fill in:

| Variable | Where to get it |
|----------|----------------|
| `DATABASE_URL` | Neon dashboard → Connection string |
| `OPENAI_API_KEY` | [platform.openai.com/api-keys](https://platform.openai.com/api-keys) |
| `BRAIN_ACCESS_KEY` | Output from step 3 |
| `TELEGRAM_BOT_TOKEN` | @BotFather on Telegram (optional) |
| `TELEGRAM_WEBHOOK_SECRET` | Any alphanumeric string you choose (optional) |
| `APP_URL` | Your Vercel deployment URL (set after step 6) |

### 5. Run database migrations

```bash
npm run migrate
```

This creates the `thoughts` table with pgvector indexes and the `match_thoughts()` function.

### 6. Deploy to Vercel

```bash
npx vercel --prod
```

If this is your first deploy, Vercel will prompt you to link the project. Set the framework to **Next.js**.

After deployment, note your production URL (e.g., `https://your-project.vercel.app`).

**Add environment variables to Vercel:**

```bash
npx vercel env add DATABASE_URL
npx vercel env add OPENAI_API_KEY
npx vercel env add BRAIN_ACCESS_KEY
```

Or add them via the Vercel dashboard → Settings → Environment Variables. Then redeploy:

```bash
npx vercel --prod
```

### 7. Verify the deployment

```bash
# Health check
curl https://your-project.vercel.app/api/health

# Capture a test thought
curl -X POST https://your-project.vercel.app/api/capture \
  -H "Content-Type: application/json" \
  -H "x-brain-key: YOUR_ACCESS_KEY" \
  -d '{"content": "Testing Open Brain on Vercel + Neon"}'
```

You should see a JSON response with `id` and `metadata` (type, topics, people, action items).

### 8. Connect MCP clients

**ChatGPT** (Settings → Apps & Connectors → Add MCP):

```
https://your-project.vercel.app/api/mcp?key=YOUR_ACCESS_KEY
```

Set auth to "None" (key is in the URL). Note: enabling Developer Mode in ChatGPT disables its built-in Memory — Open Brain replaces it.

**Claude Desktop** (Settings > Connectors > Add custom connector):

1. Open Claude Desktop
2. Go to **Settings** > **Connectors**
3. Click **Add custom connector**
4. Name: `Open Brain`
5. Remote MCP server URL: `https://your-project.vercel.app/api/mcp?key=YOUR_ACCESS_KEY`
6. Click **Add**

The connector will appear as "Open Brain" in your MCP tools list. Enable it per conversation via the "+" button > Connectors.

**Claude Code:**

```bash
claude mcp add --transport http open-brain \
  https://your-project.vercel.app/api/mcp \
  --header "x-brain-key: YOUR_ACCESS_KEY"
```

### 9. Set up Telegram (optional)

1. Message [@BotFather](https://t.me/BotFather) on Telegram → `/newbot`
2. Add `TELEGRAM_BOT_TOKEN` and `TELEGRAM_WEBHOOK_SECRET` to Vercel env vars
3. Set `APP_URL` in your `.env.local` to your Vercel deployment URL
4. Redeploy: `npx vercel --prod`
5. Register the webhook:

```bash
npm run set-telegram-webhook
```

1. Send a message to your bot — it should reply with a classification

### 10. Add CLI capture (optional)

Add to your `~/.bashrc` or `~/.zshrc`:

```bash
brain() {
  curl -s -X POST "https://your-project.vercel.app/api/capture" \
    -H "Content-Type: application/json" \
    -H "x-brain-key: YOUR_ACCESS_KEY" \
    -d "{\"content\": \"$*\", \"source\": \"cli\"}"
}
```

Then capture from anywhere:

```bash
brain "Book the Lake Tahoe cabin before June — ask Sarah about group size"
```

## Expected Outcome

After completing these steps, you should be able to:

1. **Capture** a thought from any channel (MCP, Telegram, CLI, HTTP)
2. **Search** by meaning — "upcoming deadlines" finds thoughts about due dates, even if the word "deadline" isn't used
3. **List** thoughts filtered by type (task, idea, observation, etc.) or topic
4. **Cross-client memory** — capture from Telegram on your phone, retrieve from ChatGPT on your laptop

Each captured thought is automatically:
- Embedded as a 1536-dimension vector (`text-embedding-3-small`)
- Classified by type (observation, task, idea, reference, person_note, decision, meeting_note)
- Tagged with topics (1–3), people mentioned, action items, and dates

## How It Differs from the Default Stack

| Component | Default (OB1) | This recipe |
|-----------|---------------|-------------|
| Runtime | Cloudflare Workers | Vercel Serverless (Next.js App Router) |
| Database | Supabase (pgvector) | Neon Postgres (pgvector) |
| AI Provider | OpenAI via OpenRouter | OpenAI direct (Vercel AI SDK) |
| Mobile capture | Slack | Telegram (grammY) |
| MCP transport | SSE | Streamable HTTP (2025-03-26 spec) |
| Auth | Supabase auth + API keys | Static access key (timing-safe) |

The `thoughts` table schema and `match_thoughts()` function are identical to OB1's — data is portable between stacks.

## File Structure

```
vercel-neon-telegram/
├── README.md
├── metadata.json
├── package.json
├── tsconfig.json
├── next.config.mjs
├── vercel.json
├── .env.example
├── sql/
│   ├── 001-create-thoughts.sql
│   └── 002-match-thoughts.sql
├── scripts/
│   ├── generate-key.ts
│   ├── migrate.ts
│   └── set-telegram-webhook.ts
└── src/
    ├── lib/
    │   ├── types.ts          # Zod metadata schema
    │   ├── ai.ts             # Vercel AI SDK (embed + extract)
    │   ├── db.ts             # Neon tagged-template queries
    │   ├── auth.ts           # Timing-safe key validation
    │   ├── capture.ts        # Core pipeline (parallel embed + extract + store)
    │   ├── rate-limit.ts     # In-memory rate limiter (30 req/min)
    │   └── __tests__/        # Unit tests (vitest)
    │       ├── auth.test.ts
    │       ├── rate-limit.test.ts
    │       └── types.test.ts
    └── app/api/
        ├── mcp/route.ts      # MCP server (3 tools)
        ├── capture/route.ts  # Direct HTTP capture
        ├── telegram/route.ts # Telegram webhook (grammY)
        └── health/route.ts   # Health check
```

## Running Tests

```bash
npm test
```

Unit tests cover auth (key extraction from 3 sources, timing-safe validation), rate limiting (sliding window, expiration), and metadata schemas (Zod validation, defaults, constraints). No external services required.

## Security

- **Auth:** timing-safe key comparison on all write/read endpoints
- **Rate limiting:** 30 captures per minute (prevents runaway AI agent loops)
- **Input cap:** 10KB max per thought (prevents OpenAI cost abuse)
- **Telegram:** webhook secret required — rejects requests when not configured
- **Health endpoint:** intentionally public (no secrets exposed)

## Troubleshooting

### "DATABASE_URL is required" when running migrate

Your `.env.local` file is missing or the variable isn't set. Make sure you copied `.env.example` to `.env.local` and filled in the Neon connection string. The migrate script reads from `.env.local` — run it with:

```bash
source .env.local && npm run migrate
```

### Vercel build fails with "No Output Directory named public"

The Vercel project isn't configured as a Next.js project. Add to `vercel.json`:

```json
{ "framework": "nextjs" }
```

Or set the framework in the Vercel dashboard → Settings → General → Framework Preset → Next.js.

### "cannot insert multiple commands into a prepared statement" during migration

The Neon HTTP driver can't execute multiple SQL statements in a single call. The included `migrate.ts` script handles this automatically by splitting statements. If you're running SQL manually, execute each statement separately.

### MCP connection fails in Claude Desktop

Make sure you're using the custom connectors UI, not a JSON config file:

1. Open **Settings** > **Connectors** > **Add custom connector**
2. Paste the full URL including the key: `https://your-project.vercel.app/api/mcp?key=YOUR_KEY`
3. If the connector shows "disconnected," verify your Vercel deployment is running (`curl https://your-project.vercel.app/api/health`)

If your Claude Desktop doesn't have the Connectors option, update to the latest version.

### Telegram webhook returns 503

`TELEGRAM_WEBHOOK_SECRET` is not set in your Vercel environment variables. Add it in the Vercel dashboard, redeploy, then re-run `npm run set-telegram-webhook`. The secret must contain only letters, numbers, underscores, and hyphens.

### ChatGPT doesn't pick up MCP tools automatically

ChatGPT is less intuitive at discovering MCP tools than Claude. Be explicit: "Use the capture_thought tool to save..." or "Use search_thoughts to find..." until it learns the pattern.
