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

## Quick Start

1. Install dependencies:

   ```bash
   cd dashboards/open-brain-dashboard
   npm install
   ```

2. Create `.env.local` in the dashboard folder (or symlink from the repo root):

   ```bash
   cp .env.example .env.local
   ```

3. Fill in your 4 values. You can find them at:

   | Variable | Where to get it |
   |----------|----------------|
   | `PUBLIC_SUPABASE_URL` | Supabase Dashboard → Settings → API → Project URL |
   | `PUBLIC_SUPABASE_ANON_KEY` | Supabase Dashboard → Settings → API → `anon` `public` key |
   | `MCP_URL` | Your deployed Edge Function URL (e.g. `https://<ref>.supabase.co/functions/v1/open-brain-mcp`) |
   | `MCP_KEY` | The `MCP_ACCESS_KEY` you set during Open Brain setup. Also visible in Claude Desktop → Settings → Connectors → your connector URL after `?key=` |

4. Create a sign-in user (if you don't have one). In Supabase Dashboard → Authentication → Add user → create with email + password + Auto Confirm.

   > **Note:** If your existing user was created via OAuth, you won't have a password. Click "Send password recovery" from the user detail panel, or create a second user with email/password (e.g. `you+dashboard@gmail.com`).

5. Start the app:

   ```bash
   npm run dev
   ```

6. Open `http://localhost:5173` and sign in.

## Deploy to Production

- **Vercel:** Import this folder, set the same 4 environment variables.
- **Netlify:** Deploy as a SvelteKit site, set the same 4 environment variables.

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

**Issue: Search returns "No thoughts found" but stats show thoughts exist**
Solution: Search uses semantic (vector) similarity, not keyword matching. Three things to check:

1. **OpenRouter API key** — `search_thoughts` calls OpenRouter to generate a query embedding. If `OPENROUTER_API_KEY` is missing or invalid in your Supabase secrets, search silently returns nothing. Verify with: `supabase secrets list | grep OPENROUTER`
2. **Embeddings exist** — Thoughts captured before embeddings were configured won't be searchable. Check in SQL Editor: `SELECT count(*) FROM thoughts WHERE embedding IS NULL`
3. **Similarity threshold** — Short queries against long content may score below the default 0.5 threshold. Try a more specific search phrase, or pass a lower `threshold` value.

**Issue: "Database error querying schema" on sign-in**
Solution: Your user was likely created via OAuth and has no password set. Either send a password recovery email from the Supabase Dashboard user detail panel, or create a new email/password user.
