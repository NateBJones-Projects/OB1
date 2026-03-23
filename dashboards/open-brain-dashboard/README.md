# Open Brain Dashboard

A full-featured web dashboard for your Open Brain second brain. Browse, search, capture, and manage thoughts through a modern dark-themed UI. Built with Next.js, React, TypeScript, and Tailwind CSS. Deploy to Vercel or any Node.js host.

## What It Does

Provides 8 pages for managing your thoughts:

| Page | Description |
|------|-------------|
| **Dashboard** | Stats overview (total thoughts, type distribution, top topics), recent activity, quick capture |
| **Browse** | Paginated thought table with filters for type, source, and importance |
| **Detail** | Full thought view with inline editing, delete, linked reflections, and related connections |
| **Search** | Semantic (vector similarity) and full-text search with match scores and pagination |
| **Add to Brain** | Smart ingest with auto-routing — short text goes to single capture, long text to extraction with dry-run preview |
| **Audit** | Quality review for low-score thoughts with bulk delete |
| **Duplicates** | Semantic similarity detection with keep/delete/keep-both resolution |
| **Login** | API key authentication via encrypted session cookie |

## Prerequisites

- A working Open Brain setup with the **REST API gateway** (`open-brain-rest`) deployed
- **Node.js 18+** installed
- A **Vercel account** (free tier works) or any Node.js hosting

### Credential Tracker

| Credential | Where to get it | Where it goes |
|------------|----------------|---------------|
| `NEXT_PUBLIC_API_URL` | Your Supabase project URL + `/functions/v1/open-brain-rest` | `.env` or hosting env vars |
| `SESSION_SECRET` | Generate: `openssl rand -hex 32` | `.env` or hosting env vars |
| `RESTRICTED_PASSPHRASE_HASH` | Optional. Generate: `echo -n "passphrase" \| shasum -a 256` | `.env` or hosting env vars |

## Steps

### Step 1: Clone the dashboard

```bash
# From the OB1 repo
cd dashboards/open-brain-dashboard
```

Or copy the folder to your own project directory.

### Step 2: Install dependencies

```bash
npm install
```

### Step 3: Configure environment

```bash
cp .env.example .env
```

Edit `.env` and set your values:

```
NEXT_PUBLIC_API_URL=https://YOUR-PROJECT-REF.supabase.co/functions/v1/open-brain-rest
SESSION_SECRET=your-32-char-secret-here
```

### Step 4: Run locally

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). You should see the login page.

Enter your Open Brain API key (the `MCP_ACCESS_KEY` from your Supabase Edge Function secrets). After login, the dashboard loads with your stats and recent thoughts.

### Step 5: Deploy to Vercel (optional)

```bash
npx vercel --prod
```

Or connect the folder to Vercel via the dashboard. Set the environment variables (`NEXT_PUBLIC_API_URL`, `SESSION_SECRET`) in your Vercel project settings.

> [!TIP]
> The free Vercel tier is sufficient. The dashboard makes server-side API calls to your Open Brain REST endpoint — there's no heavy compute.

## Expected Outcome

When working correctly:

- **Login page** accepts your Open Brain API key and redirects to the dashboard
- **Dashboard** shows thought count, type distribution chart, top topics, and recent thoughts
- **Browse** displays a paginated table of all thoughts with working type/source/importance filters
- **Search** returns results with similarity scores (semantic mode) or rank scores (full-text mode)
- **Add to Brain** auto-routes short text (< 500 chars, single paragraph) to single capture, and long/structured text to extraction with dry-run preview
- **Detail page** shows full thought content with metadata, inline edit for content/type/importance, and linked reflections

## REST API Endpoints Required

The dashboard calls these endpoints on your Open Brain REST API:

| Endpoint | Method | Used By |
|----------|--------|---------|
| `/health` | GET | Login validation |
| `/thoughts` | GET | Browse page (paginated, filtered) |
| `/thought/:id` | GET | Detail page |
| `/thought/:id` | PUT | Inline edit (content, type, importance) |
| `/thought/:id` | DELETE | Delete button |
| `/search` | POST | Search page (semantic + full-text) |
| `/stats` | GET | Dashboard stats widget |
| `/capture` | POST | Quick capture (single thought) |
| `/thought/:id/reflection` | GET | Detail page (linked reflections) |
| `/ingest` | POST | Smart ingest (extraction) |
| `/ingestion-jobs` | GET | Ingest page (job history) |
| `/duplicates` | GET | Duplicates page |

> [!NOTE]
> If your Open Brain instance doesn't have all these endpoints (e.g., no smart-ingest or duplicates), those pages will show errors but the core pages (dashboard, browse, search, detail) will still work.

## Optional: Restricted Content

If you've applied the [sensitivity-tiers](https://github.com/NateBJones-Projects/OB1/pull/110) primitive and want to control access to sensitive thoughts:

1. Set `RESTRICTED_PASSPHRASE_HASH` in your environment
2. A lock/unlock toggle appears in the sidebar
3. When locked (default), restricted thoughts are filtered from all views
4. Enter your passphrase to temporarily unlock restricted content for the session

If `RESTRICTED_PASSPHRASE_HASH` is not set, the toggle is hidden — no action needed.

## Authentication

The dashboard uses **iron-session** for encrypted HTTP-only session cookies:

1. User enters their Open Brain API key once at login
2. Key is validated against the `/health` endpoint
3. Key is stored in an encrypted session cookie (not in client-side JS or localStorage)
4. All server-side API calls use the key from the session
5. Sessions expire after 24 hours

No API key is stored in environment variables or exposed to the browser.

## Tech Stack

- **Next.js 16** (App Router)
- **React 19** with TypeScript
- **Tailwind CSS 4** (dark theme)
- **iron-session 8** (encrypted cookies)
- Zero external runtime dependencies beyond these

## Troubleshooting

1. **"Could not reach API" on login** — Verify `NEXT_PUBLIC_API_URL` is correct and your REST API gateway (`open-brain-rest`) is deployed. Test with: `curl https://YOUR-REF.supabase.co/functions/v1/open-brain-rest/health -H "x-brain-key: YOUR_KEY"`.

2. **"SESSION_SECRET env var is required"** — The app requires a 32+ character secret for cookie encryption. Generate one with `openssl rand -hex 32`.

3. **Build fails with SWC error** — This happens when `node_modules` was installed on a different platform (e.g., Windows modules on Linux). Delete `node_modules` and `package-lock.json`, then run `npm install` on your target platform.

4. **Search returns no results** — Ensure your thoughts have embeddings. Semantic search requires the `embedding` column to be populated. Run an embedding backfill if needed.

5. **Ingest page shows "extracting" forever** — Check that the `smart-ingest` Edge Function is deployed. The ingest feature depends on a separate Edge Function for document extraction.
