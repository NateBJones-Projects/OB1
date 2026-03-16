# Open Brain Dashboard

> Search, filter, and capture your thoughts from a production-ready SvelteKit UI.

## What it does

This dashboard connects directly to your Open Brain MCP endpoint and gives you an interface to:

- capture new thoughts from a web form,
- search and filter existing thoughts by type, topic, and people,
- inspect stats, action items, and recent capture activity in a clean, focused layout.

## Prerequisites

- Working Open Brain setup ([guide](../../docs/01-getting-started.md))
- Supabase project URL + anon key for your Open Brain project
- MCP function URL + access key for your Open Brain MCP function
- Node.js 18+
- A Supabase-authenticated user in your project (this dashboard uses email/password sign-in)

## Credential Tracker

Copy this block into a text editor and fill it as you go.

```text
OPEN BRAIN DASHBOARD -- CREDENTIAL TRACKER
------------------------------------------

FROM OPEN BRAIN
  Supabase URL:              ____________
  Supabase anon key:         ____________
  MCP Function URL:          ____________
  MCP Access Key:            ____________

HOSTING
  Deploy URL:                ____________

------------------------------------------
```

## Steps

1. Clone or copy this folder into its own repo or monorepo workspace.
2. Install dependencies:

   ```bash
   npm install
   ```

3. Create local environment variables from `.env.example`:

   ```bash
   cp .env.example .env.local
   ```

4. Edit `.env.local` with your values:

   - `PUBLIC_SUPABASE_URL`
   - `PUBLIC_SUPABASE_ANON_KEY`
   - `MCP_URL`
   - `MCP_KEY`

5. Ensure your MCP URL points to your deployed `open-brain-mcp` function and the value in `MCP_KEY` matches your MCP access key.
6. Start the app:

   ```bash
   npm run dev
   ```

7. Open `http://localhost:5173` and sign in with an existing Open Brain user email/password.
8. Deploy to Vercel or Netlify:
   - Vercel: import this folder and set the same environment variables.
   - Netlify: deploy as a SvelteKit site and set the same environment variables.

## Expected outcome

After setup, you should be able to:

- see your total captured-thoughts count in the header,
- search thoughts and get results sorted by recency,
- filter by type (Observation/Task/Idea/Reference/Person Note), topic, and people,
- open a thought for full text review,
- capture a new thought and immediately persist it through MCP.

If a value is missing in env, the app will show startup errors about missing `PUBLIC_SUPABASE_URL` / `PUBLIC_SUPABASE_ANON_KEY` or missing MCP credentials.

## Troubleshooting

**Issue: `Missing PUBLIC_SUPABASE_URL or PUBLIC_SUPABASE_ANON_KEY`**
Solution: Ensure `.env.local` exists, both variables are set, and SvelteKit has been restarted after editing env.

**Issue: App keeps redirecting to sign-in**
Solution: Confirm you have a valid Supabase user in the project and correct credentials; the app intentionally requires auth via `/signin`.

**Issue: MCP calls fail with `Unauthorized` or 401**
Solution: Verify `MCP_URL` points to the Supabase Edge Function for this project, and `MCP_KEY` matches the function key expected by `open-brain-mcp`.

**Issue: Search results look empty even when thoughts exist**
Solution: Confirm your MCP function can run `search_thoughts` and `thought_stats` for your authenticated user or service scope.
