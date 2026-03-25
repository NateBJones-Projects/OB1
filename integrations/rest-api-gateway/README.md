# REST API Gateway

Add a standard REST API to your Open Brain. Any app, automation tool, or device that can make HTTP requests can now capture, search, and manage your thoughts.

> **Architecture note:** This is a standalone REST API gateway deployed as a Supabase Edge Function. It does not use MCP and requires no local config file changes. It runs alongside your existing MCP server as a separate function — two doors to the same brain.

## What It Does

Deploys a second Supabase Edge Function alongside your MCP server that exposes your Open Brain as a standard REST API. While MCP works great for AI assistants like Claude and Cursor, many tools only speak HTTP — ChatGPT Custom Actions, iPhone Shortcuts, Zapier, Make, n8n, web dashboards, or a simple `curl` command. This gateway gives them all a door in.

**Routes:**

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/search` | Search thoughts (semantic vector search) |
| `POST` | `/capture` | Capture a new thought |
| `GET` | `/recent` | List recent thoughts with filters |
| `GET` | `/thought/:id` | Get a single thought |
| `PUT` | `/thought/:id` | Update a thought's content |
| `DELETE` | `/thought/:id` | Delete a thought |
| `GET` | `/stats` | Brain stats summary |
| `GET` | `/health` | Health check |

## Prerequisites

- Working Open Brain setup ([Getting Started guide](../../docs/01-getting-started.md))
- Supabase CLI installed and linked to your project
- Your Open Brain access key (same one used for MCP)

## Credential Tracker

You'll need these values during setup. Fill them in as you go:

**FROM YOUR OPEN BRAIN SETUP:**
```
Supabase Project URL: ______________________________
MCP Access Key:       ______________________________
OpenRouter API Key:   ______________________________
```

No additional credentials needed — the REST gateway reuses your existing Open Brain secrets.

## Setup

### Step 1: Create the Edge Function folder

In your Supabase project directory, create the function:

```bash
mkdir -p supabase/functions/open-brain-rest
```

### Step 2: Add the function code

Copy [`index.ts`](./index.ts) from this directory into `supabase/functions/open-brain-rest/index.ts`.

### Step 3: Deploy

```bash
supabase functions deploy open-brain-rest --no-verify-jwt
```

That's it. Your existing secrets (`MCP_ACCESS_KEY`, `OPENROUTER_API_KEY`) are already available to the new function.

### Step 4: Test It

**Health check:**
```bash
curl "https://YOUR-PROJECT-REF.supabase.co/functions/v1/open-brain-rest/health" \
  -H "x-brain-key: YOUR_ACCESS_KEY"
```

Expected response:
```json
{"ok": true, "service": "open-brain-rest"}
```

**Capture a thought:**
```bash
curl -X POST "https://YOUR-PROJECT-REF.supabase.co/functions/v1/open-brain-rest/capture" \
  -H "x-brain-key: YOUR_ACCESS_KEY" \
  -H "Content-Type: application/json" \
  -d '{"content": "Testing REST API gateway"}'
```

Expected response:
```json
{"thought_id": "abc-123", "action": "inserted", "type": "idea", "message": "Captured new thought as idea"}
```

**Search your brain:**
```bash
curl -X POST "https://YOUR-PROJECT-REF.supabase.co/functions/v1/open-brain-rest/search" \
  -H "x-brain-key: YOUR_ACCESS_KEY" \
  -H "Content-Type: application/json" \
  -d '{"query": "testing", "limit": 5}'
```

**List recent thoughts:**
```bash
curl "https://YOUR-PROJECT-REF.supabase.co/functions/v1/open-brain-rest/recent?limit=5&type=idea" \
  -H "x-brain-key: YOUR_ACCESS_KEY"
```

### Step 5: Connect to Your Tools

**ChatGPT Custom Actions:** Use the OpenAPI schema in the `openapi.yaml` file (or generate one from the routes above) to create a Custom Action in ChatGPT that talks to your brain.

**iPhone Shortcuts:** Create a shortcut with a "Get Contents of URL" action pointing to `/capture`. Add a text input and you have mobile thought capture without a bot.

**Zapier / Make / n8n:** Create a webhook action that POSTs to `/capture` whenever a trigger fires (starred email, new Notion page, calendar event, etc.).

## Expected Outcome

After setup, you can:
1. Capture thoughts from any tool that speaks HTTP
2. Search your brain from scripts, automations, or dashboards
3. Update and delete thoughts without needing an MCP client
4. Build web dashboards that display your brain stats

The REST gateway uses the same auth (`x-brain-key` header or `?key=` query parameter) and same database as your MCP server. They're two doors to the same brain.

## Edge Function Code

See [`index.ts`](./index.ts) for the full Edge Function implementation.

> **Tool hygiene:** This integration adds endpoints to your Open Brain. As you add more integrations, the total tool count grows. See the [MCP Tool Audit & Optimization Guide](../../docs/05-tool-audit.md) for strategies on managing your tool surface area.

## Troubleshooting

**Issue: "Unauthorized" response**
**Solution:** Make sure you're passing your access key. Use the `x-brain-key` header, `?key=` query parameter, or `Authorization: Bearer <key>` header. This is the same key as your MCP server.

**Issue: "Embedding failed" error on capture**
**Solution:** Check that your `OPENROUTER_API_KEY` secret is set. Run `supabase secrets list` to verify. If it's missing, set it with `supabase secrets set OPENROUTER_API_KEY=your-key`.

**Issue: CORS errors from a web app**
**Solution:** The gateway includes permissive CORS headers (`Access-Control-Allow-Origin: *`). If you're still seeing CORS errors, make sure you're hitting the correct URL and including the `Content-Type: application/json` header on POST requests.

**Issue: Search returns no results**
**Solution:** The search endpoint uses semantic (vector) similarity. Make sure your thoughts have embeddings — thoughts captured through this gateway are automatically embedded. If you imported thoughts without embeddings, they won't appear in search results.
