# Bookshelf — Deploy Instructions

## Prerequisites
- Working Open Brain / Supabase setup
- `MCP_ACCESS_KEY` and `DEFAULT_USER_ID` already set as Supabase secrets

## Step 1 — Run the schema

In Supabase dashboard → SQL Editor → New query, paste the entire contents of `schema.sql` and click Run.

The file creates everything in the correct order: trigger function first, then `reading_list`, then the bookshelf tables. The `CREATE OR REPLACE` on the trigger function is safe if it already exists from the CRM extension.

## Step 2 — Create the Edge Function

In Supabase dashboard → Edge Functions → Deploy a new function.

Name it per user — one function per person who will use it:
- Your function: `bookshelf-lauren-mcp` (or whatever label you prefer)
- Additional users: `bookshelf-[name]-mcp`

## Step 3 — Paste the files

In the function editor, add two files:

**`index.ts`** — paste the contents of `index.ts` from this directory.

On line 8, change `USER_ID` to the user's UUID:
```typescript
const USER_ID = "YOUR-UUID-HERE";
```

Use your existing UUID from `DEFAULT_USER_ID` for your own function.
For additional users, generate a new UUID:
```bash
uuidgen | tr '[:upper:]' '[:lower:]'
```

**`deno.json`** — paste the contents of `deno.json` from this directory. No changes needed.

## Step 4 — Disable JWT verification

In the function's Details tab, turn off JWT verification. This is required — the function handles its own auth via `MCP_ACCESS_KEY`.

## Step 5 — Deploy

Click Deploy. Verify it's running by opening the function URL in a browser — you should see:
```json
{"status":"ok","service":"Bookshelf","version":"1.0.0"}
```

## Step 6 — Connect to Claude

Add a custom connector in Claude (Desktop: Settings → Connectors / Web: Settings → Connectors):

- Name: `Bookshelf` (or `Bookshelf - [Name]` for shared users)
- URL: `https://YOUR_PROJECT_REF.supabase.co/functions/v1/bookshelf-lauren-mcp?key=YOUR_MCP_ACCESS_KEY`

No OAuth. The key is embedded in the URL.

## Sharing with other users

Repeat Steps 2–6 for each additional user:
1. Generate a new UUID for them
2. Create a new function with their name (e.g. `bookshelf-donna-mcp`)
3. Paste the same `index.ts` and `deno.json`, swap the `USER_ID` on line 8
4. Disable JWT verification, deploy
5. Give them their own connection URL

Each user's data is fully isolated — they only see their own books, notes, and quotes.
