# Deploy an Edge Function

A guide to deploying any Open Brain extension as a Supabase Edge Function. This is the same pattern used by the core Open Brain MCP server — one deployment, accessible from any AI client.

## Prerequisites

- Supabase CLI installed and linked to your project (covered in the [Getting Started Guide](../../docs/01-getting-started.md))
- Your extension's `index.ts` server code ready

## Step 1: Create the Function

```bash
supabase functions new your-extension-mcp
```

Replace `your-extension-mcp` with the name from your extension's README (e.g., `household-knowledge-mcp`, `family-calendar-mcp`).

## Step 2: Add Dependencies

Create `supabase/functions/your-extension-mcp/deno.json`:

```json
{
  "imports": {
    "@hono/mcp": "npm:@hono/mcp@0.1.1",
    "@modelcontextprotocol/sdk": "npm:@modelcontextprotocol/sdk@1.24.3",
    "hono": "npm:hono@4.9.2",
    "zod": "npm:zod@4.1.13",
    "@supabase/supabase-js": "npm:@supabase/supabase-js@2.47.10"
  }
}
```

These are the standard dependencies for all Open Brain MCP servers. Use these exact versions unless the extension specifies otherwise.

## Step 3: Write the Server

Open `supabase/functions/your-extension-mcp/index.ts` and paste the MCP server code from the extension's `index.ts` file.

> `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are automatically available inside Edge Functions — you don't need to set them manually.

## Step 4: Generate an Access Key

Your MCP server will be a public URL. The access key ensures only you can use it.

```bash
# Mac/Linux
openssl rand -hex 32

# Windows (PowerShell)
-join ((1..32) | ForEach-Object { '{0:x2}' -f (Get-Random -Maximum 256) })
```

Copy the output — it'll look something like `a3f8b2c1d4e5...` (64 characters). Save it in your credential tracker under **MCP Access Key**.

Set it as a Supabase secret:

```bash
supabase secrets set MCP_ACCESS_KEY=your-generated-key-here
```

## Step 5: Deploy

```bash
supabase functions deploy your-extension-mcp --no-verify-jwt
```

Your MCP server is now live at:

```text
https://YOUR_PROJECT_REF.supabase.co/functions/v1/your-extension-mcp
```

Replace `YOUR_PROJECT_REF` with your project ref from the credential tracker. Save this as your **MCP Server URL**.

Now build your **MCP Connection URL** by adding your access key:

```text
https://YOUR_PROJECT_REF.supabase.co/functions/v1/your-extension-mcp?key=your-access-key
```

Save this in your credential tracker. This is what you'll give to AI clients.

> That's it. No npm install, no TypeScript build, no local server to keep running. It's deployed on Supabase's infrastructure.

## Updating a Deployed Function

When you modify the server code, redeploy with the same command:

```bash
supabase functions deploy your-extension-mcp --no-verify-jwt
```

The URL and access key stay the same — no need to reconfigure your AI clients.

## Troubleshooting

**"Function not found" during deploy**
- Verify you ran `supabase functions new your-extension-mcp` first
- Check that the function directory exists: `ls supabase/functions/your-extension-mcp/`

**"Missing deno.json" or import errors**
- Verify `deno.json` is in the function directory (not the project root)
- Check that the import paths in `deno.json` match the versions listed above

**Deploy succeeds but function returns errors**
- Check Edge Function logs: Supabase Dashboard → Edge Functions → your function → Logs
- Verify secrets are set: `supabase secrets list` should show `MCP_ACCESS_KEY`
- `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are auto-injected — if they're missing, your Supabase project may need to be restarted

**"Invalid JWT" or authentication errors**
- Make sure you deployed with `--no-verify-jwt` flag
- The MCP server handles its own authentication via the access key

**"Permission denied" errors**
- The service role key bypasses RLS, so this suggests a configuration issue
- Verify the user_id being passed exists in `auth.users`
- Check that foreign key constraints are not blocking inserts

## Extensions That Use This

- [Household Knowledge Base](../../extensions/household-knowledge/) (Extension 1)
- [Home Maintenance Tracker](../../extensions/home-maintenance/) (Extension 2)
- [Family Calendar](../../extensions/family-calendar/) (Extension 3)
- [Meal Planning](../../extensions/meal-planning/) (Extension 4)
- [Professional CRM](../../extensions/professional-crm/) (Extension 5)
- [Job Hunt Pipeline](../../extensions/job-hunt/) (Extension 6)

Every extension follows this exact deployment pattern.
