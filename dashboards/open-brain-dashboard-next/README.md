# Open Brain Dashboard (Next.js)

A web dashboard for Open Brain with dashboard stats, search, workflow, thought browsing, and a visual graph view.

This version is built for the **MCP-backed Open Brain setup** and uses **Supabase Auth** for login.

## What this dashboard does

- shows dashboard stats and recent activity
- lets users browse recent thoughts
- supports semantic search
- includes a workflow board for task-style thoughts
- includes a graph explorer for connected thoughts
- supports quick capture / add-to-brain flows
- uses email/password, GitHub, or Google sign-in

## Important architecture note

This dashboard no longer assumes a deployed `open-brain-rest` backend.

It is wired to the Open Brain backend pieces that are actually deployed in this project:

- `open-brain-mcp`
- `mcp-server`

That means the dashboard is primarily **MCP-backed**.

## Prerequisites

- a working Supabase project for Open Brain
- `open-brain-mcp` deployed
- `mcp-server` deployed
- Node.js 18+
- a Supabase Auth setup

## Environment variables

Create `.env.local` and set:

```env
NEXT_PUBLIC_SUPABASE_URL=https://YOUR-PROJECT-REF.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=sb_publishable_xxx
OPEN_BRAIN_MCP_URL=https://YOUR-PROJECT-REF.supabase.co/functions/v1/open-brain-mcp
OPEN_BRAIN_MCP_ACCESS_KEY=your-mcp-access-key
NEXT_PUBLIC_APP_URL=http://127.0.0.1:3001
SESSION_SECRET=your-32-char-secret-here
```

Optional:

```env
RESTRICTED_PASSPHRASE_HASH=optional-hash
```

## Local setup

```bash
npm install
npm run dev
```

Open the local URL shown by Next.js. In this project it has commonly been:

`http://127.0.0.1:3001`

## Login flow

Login uses **Supabase Auth**.

Supported sign-in methods:

- email/password
- GitHub
- Google

The dashboard keeps `OPEN_BRAIN_MCP_ACCESS_KEY` on the server. End users do **not** paste the MCP key into the login form.

## Supabase Auth setup

### URL Configuration

In Supabase:

`Authentication -> URL Configuration`

Set:

- `Site URL`
  `https://open-brain-dashboard-next-eight.vercel.app`

- `Redirect URLs`
  `https://open-brain-dashboard-next-eight.vercel.app/auth/callback`
  `http://127.0.0.1:3001/auth/callback`

### GitHub provider

In Supabase:

`Authentication -> Sign In / Providers -> GitHub`

Use a real GitHub OAuth app.

GitHub OAuth app settings:

- Homepage URL:
  `https://open-brain-dashboard-next-eight.vercel.app`
- Authorization callback URL:
  `https://mnihakzwdnhnxkinpuhy.supabase.co/auth/v1/callback`

Paste the GitHub-issued:

- `Client ID`
- `Client Secret`

into the Supabase GitHub provider settings.

### Google provider

In Supabase:

`Authentication -> Sign In / Providers -> Google`

Use a real Google OAuth client.

Google OAuth settings should include:

- redirect URI:
  `https://mnihakzwdnhnxkinpuhy.supabase.co/auth/v1/callback`
- origins:
  `https://open-brain-dashboard-next-eight.vercel.app`
  `http://127.0.0.1:3001`

Paste the Google-issued:

- `Client ID`
- `Client Secret`

into the Supabase Google provider settings.

## Current behavior

Working well now:

- GitHub sign-in
- dashboard stats
- recent thoughts
- graph page
- MCP-backed thought loading
- workflow summary

## Validation

These checks pass:

```bash
npm run lint
npx tsc --noEmit
```

## Main files

- `app/login/page.tsx`
- `app/login/LoginForm.tsx`
- `app/auth/callback/route.ts`
- `lib/supabaseAuth.ts`
- `lib/supabaseServerAuth.ts`
- `lib/openBrainMcp.ts`
- `components/GraphExplorer.tsx`
- `app/api/graph/route.ts`
- `app/api/graph-search/route.ts`

## Troubleshooting

### `Authentication callback failed`

Check:

- Supabase `Site URL`
- Supabase redirect URLs
- GitHub / Google provider credentials
- production deploy contains the latest callback code

### GitHub or Google button opens provider but never signs in

Usually means one of these is wrong:

- provider `Client ID`
- provider `Client Secret`
- Supabase callback URL
- Supabase redirect URL allow-list

### `SESSION_SECRET env var is required`

Set a 32+ character `SESSION_SECRET`.

### Search returns no results

Make sure thoughts have embeddings populated.

## Deployment

Deploy with Vercel:

```bash
npx vercel --prod
```

Make sure production env vars match your local `.env.local` values, especially:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `OPEN_BRAIN_MCP_URL`
- `OPEN_BRAIN_MCP_ACCESS_KEY`
- `NEXT_PUBLIC_APP_URL`
- `SESSION_SECRET`
