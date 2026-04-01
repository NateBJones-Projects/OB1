# 03 — MCP Server Deployment

Deploy the unified Amicus Superbrain MCP server and connect it to your AI clients.

---

## Step 1: Set Supabase Secrets

From your project root, set the environment variables the Edge Function needs:

```bash
supabase secrets set SUPABASE_URL=https://YOUR_REF.supabase.co
supabase secrets set SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
supabase secrets set OPENROUTER_API_KEY=sk-or-v1-your-key
supabase secrets set MCP_ACCESS_KEY=your-generated-access-key
supabase secrets set DEFAULT_USER_ID=your-generated-uuid
```

Verify:

```bash
supabase secrets list
```

You should see all five secrets listed.

---

## Step 2: Deploy the Edge Function

```bash
supabase functions deploy open-brain-mcp --no-verify-jwt
```

Expected output:

```
Deployed Functions on project YOUR_REF: open-brain-mcp
```

---

## Step 3: Test the Endpoint

Verify all 18 tools are registering:

```bash
curl -s "https://YOUR_REF.supabase.co/functions/v1/open-brain-mcp?key=YOUR_ACCESS_KEY" \
  -X POST \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

You should see a JSON response listing all 18 tools.

---

## Step 4: Connect to Claude

1. Go to [claude.ai](https://claude.ai) > **Settings** > **Connectors**
2. Click **Add custom connector**
3. Paste your URL:
   ```
   https://YOUR_REF.supabase.co/functions/v1/open-brain-mcp?key=YOUR_ACCESS_KEY
   ```
4. Name it **Amicus Superbrain**
5. Save

You should see 18 tools available in the connector.

---

## Step 5: Connect to ChatGPT

Follow the same process using ChatGPT's MCP connector/plugin settings. Use the same URL.

---

## Step 6: Connect to Claude Code

Add to your Claude Code MCP configuration:

```json
{
  "mcpServers": {
    "amicus-superbrain": {
      "url": "https://YOUR_REF.supabase.co/functions/v1/open-brain-mcp?key=YOUR_ACCESS_KEY"
    }
  }
}
```

---

## Available Tools (18)

| # | Tool | Category | Description |
|---|------|----------|-------------|
| 1 | `search_thoughts` | Thoughts | Semantic search across all captured thoughts |
| 2 | `list_thoughts` | Thoughts | List recent thoughts with filters |
| 3 | `capture_thought` | Thoughts | Save a new thought with auto-embedding |
| 4 | `thought_stats` | Thoughts | Summary statistics of your brain |
| 5 | `upload_document` | Documents | Upload PDF/DOCX/XLSX with text extraction |
| 6 | `search_documents` | Documents | Search documents by matter/contact/name |
| 7 | `list_documents` | Documents | List documents grouped by matter |
| 8 | `add_professional_contact` | CRM | Add a new contact |
| 9 | `search_contacts` | CRM | Search contacts by name/company/tags |
| 10 | `log_interaction` | CRM | Log a meeting/call/email with a contact |
| 11 | `get_contact_history` | CRM | Full contact profile with interactions |
| 12 | `create_opportunity` | CRM | Create a deal/opportunity |
| 13 | `get_follow_ups_due` | CRM | List overdue and upcoming follow-ups |
| 14 | `link_thought_to_contact` | CRM | Link a thought to a contact |
| 15 | `log_time` | Time | Log billable hours to a matter |
| 16 | `list_time_entries` | Time | List time entries with filters |
| 17 | `list_matters` | Time | List active matters by attorney |

---

## Redeploying After Changes

After editing `server/index.ts`:

```bash
cp server/index.ts supabase/functions/open-brain-mcp/index.ts
cp server/deno.json supabase/functions/open-brain-mcp/deno.json
supabase functions deploy open-brain-mcp --no-verify-jwt
```

---

Next: [04 — CRM Setup](04-crm-setup.md)
