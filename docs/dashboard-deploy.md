# Deploying Extensions Without the Supabase CLI

Every extension in this repo ships with two versions of its server file:

| File | Use when |
|------|----------|
| `index.ts` | You have the Supabase CLI installed and linked |
| `index.dashboard.ts` | You want to deploy entirely from the Supabase dashboard |

This guide covers the dashboard-only path.

## Why Two Files?

The Supabase CLI resolves imports using the project's `deno.json` import map, so `index.ts` can use bare specifiers like `import { Hono } from "hono"`.

When you paste code directly into the dashboard editor, there is no import map — Deno must fetch every dependency by URL. The `index.dashboard.ts` files replace every bare specifier with a fully-qualified `npm:` specifier and a pinned version, for example:

```typescript
// index.ts (CLI)
import { Hono } from "hono";

// index.dashboard.ts (dashboard)
import { Hono } from "npm:hono@4.9.2";
```

The logic is identical in both files.

## Deployment Steps (any extension)

### 1. Run the schema

Open your project's SQL Editor:
`https://supabase.com/dashboard/project/YOUR_PROJECT_REF/sql/new`

Paste the contents of the extension's `schema.sql` and click **Run**.

### 2. Create the Edge Function

Go to **Edge Functions** → **Deploy a new function**.

- Set the function name (e.g. `household-knowledge-mcp`)
- Paste the full contents of `index.dashboard.ts` into the editor
- Click **Deploy**

### 3. Set environment variables

Go to **Edge Functions** → select your function → **Secrets**.

Add the following (values from your credential tracker):

| Key | Value |
|-----|-------|
| `SUPABASE_URL` | Your project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Your service role / secret key |
| `MCP_ACCESS_KEY` | Your MCP access key |
| `DEFAULT_USER_ID` | Your UUID |

> The same four variables are used by every extension — set them once per function.

### 4. Disable JWT verification

Still on the function page, go to **Settings** and turn off **Enforce JWT Verification**.

The extensions handle their own authentication via `MCP_ACCESS_KEY`. Leaving JWT verification on will block every request with a 401 before your code runs.

### 5. Connect to Claude

In Claude Desktop: **Settings → Connectors → Add custom connector**

| Field | Value |
|-------|-------|
| Name | e.g. `Household Knowledge` |
| URL | `https://YOUR_PROJECT_REF.supabase.co/functions/v1/FUNCTION_NAME?key=YOUR_MCP_ACCESS_KEY` |

Repeat for each extension you deploy.

## Extensions with dashboard files

| Extension | Function name | File |
|-----------|---------------|------|
| 1 — Household Knowledge Base | `household-knowledge-mcp` | `extensions/household-knowledge/index.dashboard.ts` |
| 2 — Home Maintenance Tracker | `home-maintenance-mcp` | `extensions/home-maintenance/index.dashboard.ts` |
| 3 — Family Calendar | `family-calendar-mcp` | `extensions/family-calendar/index.dashboard.ts` |
| 4 — Meal Planning | `meal-planning-mcp` | `extensions/meal-planning/index.dashboard.ts` |

## Troubleshooting

**401 Unauthorized** — JWT verification is still on. Disable it in the function's Settings tab.

**`Relative import path not prefixed`** — You pasted from `index.ts` instead of `index.dashboard.ts`.

**`[object Object]` error from a tool** — A database error is being swallowed. Check that the schema ran successfully and all four environment variables are set on the function.

**`NOT_FOUND`** — The function name in your connector URL doesn't match the deployed function name. Check Edge Functions → your function → copy the exact invoke URL.
