# Perplexity Pro MCP

> Connect Perplexity Pro as an MCP client to your Open Brain — enables AI-powered search across your captured thoughts.

## What It Does

Perplexity Pro can connect to remote MCP servers. Once connected, you can search your Open Brain directly from Perplexity using natural language. Your thoughts become part of Perplexity's contextual awareness.

## Prerequisites

- Working Open Brain setup ([guide](../../docs/01-getting-started.md))
- Perplexity Pro subscription
- Updated Open Brain MCP server (with Bearer auth support)

## Steps

### 1. Update Your MCP Server

If you deployed Open Brain before April 2026, update the edge function:

```bash
cd your-supabase-project
supabase functions deploy open-brain-mcp --no-verify-jwt
```

### 2. Get Your Connection Details

- **MCP URL:** `https://YOUR_PROJECT_REF.supabase.co/functions/v1/open-brain-mcp`
- **Access Key:** Your MCP_ACCESS_KEY from Step 5 of the setup guide

### 3. Connect Perplexity

1. Open Perplexity Pro > Your user profile > settings
2. Navigate to MCP / Connectors
3. Add new connector:
   - **Name:** MyOpenBrain
   - **URL:** `https://YOUR_PROJECT_REF.supabase.co/functions/v1/open-brain-mcp`
   - **Authentication:** Choose API `Authorization: Bearer YOUR_ACCESS_KEY`
4. Save and enable it

### 4. Verify Connection

From Perplexity input field, click "+" and choose the MyOpenBrain connector.

Ask Perplexity: "What thoughts do I have about [topic]?"

## Expected Outcome

Perplexity returns relevant thoughts from your Open Brain with citations. The four MCP tools (search_thoughts, list_thoughts, thought_stats, capture_thought) are available.

## Troubleshooting

**Issue: "Couldn't connect to MCP server"**
Solution: Ensure your MCP server is deployed and supports Bearer auth. Re-deploy if needed.

**Issue: "Invalid access key"**
Solution: Verify the key matches your MCP_ACCESS_KEY exactly. Re-check in Supabase secrets.

## Tool Surface Area

This integration adds 4 MCP tools to your Perplexity context. See the [MCP Tool Audit & Optimization Guide](../../docs/05-tool-audit.md).
