# Deploy an Edge Function

A guide to deploying any Open Brain extension as a Supabase Edge Function. This is the same pattern used by the core Open Brain MCP server — one deployment, accessible from any AI client.

## Prerequisites

- Completed the [Getting Started Guide](../../docs/01-getting-started.md) — you should already have:
  - Supabase CLI installed
  - A project folder with `supabase init` and `supabase link` already done
  - Your credential tracker with Supabase project ref and secrets

## Before You Start

Navigate to your Open Brain project folder — the one you created during the Getting Started guide.

🟩 **Mac/Linux:**

```bash
cd /paste/your/path/here
```

🟦 **Windows (PowerShell):**

```powershell
cd "C:\paste\your\path\here"
```

> Not sure where it is? It's the folder you created in Step 6 of the Getting Started guide — the one with the `supabase/` directory inside it.

## What You Need From the Extension

Every extension README includes a deployment table like this:

| Setting | Value |
|---------|-------|
| Function name | `extension-name-mcp` |
| Download path | `extensions/extension-name` |

You'll use these values in the steps below. Replace `FUNCTION_NAME` and `DOWNLOAD_PATH` with the values from the extension you're deploying.

---

## Step 1: Create the Function Folder

```bash
supabase functions new FUNCTION_NAME
```

Example: `supabase functions new household-knowledge-mcp`

## Step 2: Download the Server Files

🟩 **Mac/Linux:**

```bash
curl -o supabase/functions/FUNCTION_NAME/index.ts https://raw.githubusercontent.com/NateBJones-Projects/OB1/main/DOWNLOAD_PATH/index.ts
```

```bash
curl -o supabase/functions/FUNCTION_NAME/deno.json https://raw.githubusercontent.com/NateBJones-Projects/OB1/main/DOWNLOAD_PATH/deno.json
```

🟦 **Windows (PowerShell):**

```powershell
Invoke-WebRequest -Uri https://raw.githubusercontent.com/NateBJones-Projects/OB1/main/DOWNLOAD_PATH/index.ts -OutFile supabase\functions\FUNCTION_NAME\index.ts
```

```powershell
Invoke-WebRequest -Uri https://raw.githubusercontent.com/NateBJones-Projects/OB1/main/DOWNLOAD_PATH/deno.json -OutFile supabase\functions\FUNCTION_NAME\deno.json
```

> Replace `FUNCTION_NAME` and `DOWNLOAD_PATH` with the values from the extension's deployment table.

## Step 3: Set the OAuth Secrets

These extensions now use the same OAuth-backed auth model as the core Open Brain server. Set:

```bash
supabase secrets set SUPABASE_PUBLISHABLE_KEY=your-publishable-key
supabase secrets set OB1_OWNER_USER_ID=your-owner-user-id
```

Optional migration fallback:

```bash
supabase secrets set ALLOW_LEGACY_MCP_KEY=true
```

Only keep `MCP_ACCESS_KEY` around if you're temporarily supporting old key-based connectors during migration.

## Step 4: Deploy

```bash
supabase functions deploy FUNCTION_NAME --no-verify-jwt
```

Your MCP server is now live at:

```text
https://YOUR_PROJECT_REF.supabase.co/functions/v1/FUNCTION_NAME
```

Save the clean MCP server URL in your credential tracker, then follow the [Remote MCP Connection](../remote-mcp/) guide to connect it through OAuth.

---

## Updating a Deployed Function

When the extension code is updated in the repo, pull the latest version and redeploy:

🟩 **Mac/Linux:**

```bash
curl -o supabase/functions/FUNCTION_NAME/index.ts https://raw.githubusercontent.com/NateBJones-Projects/OB1/main/DOWNLOAD_PATH/index.ts
```

🟦 **Windows (PowerShell):**

```powershell
Invoke-WebRequest -Uri https://raw.githubusercontent.com/NateBJones-Projects/OB1/main/DOWNLOAD_PATH/index.ts -OutFile supabase\functions\FUNCTION_NAME\index.ts
```

Then deploy:

```bash
supabase functions deploy FUNCTION_NAME --no-verify-jwt
```

The URL stays the same. If you are already on OAuth, no client reconfiguration is needed after a normal code update.

---

## Troubleshooting

**"Function not found" during deploy**
- Verify you ran `supabase functions new FUNCTION_NAME` first
- Make sure you're in your Open Brain project folder (the one with the `supabase/` directory)

**Import errors or "not in import map"**
- Verify `deno.json` was downloaded into the function directory, not the project root
- Run `ls supabase/functions/FUNCTION_NAME/` — you should see both `index.ts` and `deno.json`

**Deploy succeeds but function returns errors**
- Check Edge Function logs: Supabase Dashboard → Edge Functions → your function → Logs
- Verify secrets are set: `supabase secrets list` should show `SUPABASE_PUBLISHABLE_KEY` and `OB1_OWNER_USER_ID`
- `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are auto-injected — if they're missing, your Supabase project may need to be restarted

**"Invalid JWT" or authentication errors**
- Make sure you deployed with `--no-verify-jwt` flag

## Extensions That Use This

- [Household Knowledge Base](../../extensions/household-knowledge/) (Extension 1)
- [Home Maintenance Tracker](../../extensions/home-maintenance/) (Extension 2)
- [Family Calendar](../../extensions/family-calendar/) (Extension 3)
- [Meal Planning](../../extensions/meal-planning/) (Extension 4)
- [Professional CRM](../../extensions/professional-crm/) (Extension 5)
- [Job Hunt Pipeline](../../extensions/job-hunt/) (Extension 6)
