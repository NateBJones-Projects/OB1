# Open Brain Dashboard Pro

> A Next.js 16 + Tailwind + iron-session dashboard for browsing, searching, auditing, and ingesting content in your Open Brain. A third flavor alongside the SvelteKit `open-brain-dashboard` and the Next.js `open-brain-dashboard-next`.

## What It Does

Seven server-rendered pages backed by iron-session auth and the Open Brain REST API gateway:

| Page | What you get |
|------|--------------|
| **Dashboard** (`/`) | Stats widget (total thoughts, type distribution, top topics), inline "Add to Brain" capture, and the five most recent thoughts. |
| **Browse** (`/thoughts`) | Paginated thought table with filters for type, source, and minimum importance. |
| **Detail** (`/thoughts/:id`) | Full thought view with metadata panel, inline edit (content/type/importance), delete, and a connections panel when topics/people metadata is present. |
| **Search** (`/search`) | Client-side form for semantic (vector) and full-text search with pagination and similarity scores. |
| **Audit** (`/audit`) | Quality audit of thoughts with `quality_score < 30`, sorted ascending, with two-step bulk delete. |
| **Duplicates** (`/duplicates`) | Semantic near-duplicate pairs with threshold control, side-by-side comparison, and batch resolution (keep A / keep B / keep both). |
| **Ingest** (`/ingest`) | Smart-ingest UI with dry-run preview, extracted-item cards, execute button, and job history. |
| **Settings** (`/settings`) | Connection status, thought type breakdown, top topics, and masked API key prefix. |

## CRM (optional)

If your brain runs the CRM truth layer (the `crm-core` + `crm-engagement` schemas and the `/crm/*` routes on `open-brain-rest`), the dashboard grows a contacts surface:

| Page | What you get |
|------|--------------|
| **Contacts** (`/contacts`) | Searchable contact list and a "new contact" form. |
| **Contact** (`/contacts/:id`) | Editable fact panel with per-field origin, locks, and evidence; contact methods and aliases; this contact's open proposals with accept/reject; a notes / tasks / important-dates panel; and an activity view with a merged timeline and the raw change log. |
| **Proposals** (`/proposals`) | Inbox of machine-suggested field changes filtered by status, with per-row accept/reject and bulk accept/reject for a whole import run. |

The Contacts and Proposals nav entries appear **by default, whether or not the brain has the CRM layer installed yet**. Visiting either page on a brain without it shows a setup card: which schema(s) to apply (`schemas/crm-core` + `schemas/crm-engagement`), where to run them (your Supabase project's SQL editor), a link to the schema README, a reminder that `open-brain-rest` needs the `/crm/*` route group deployed, and a **Re-check now** button that re-probes the brain and refreshes the page — no sign-out required. The setup card's schema links point at the `alanshurafa/OB1` fork by default because the optional schemas haven't landed upstream yet; override with `NEXT_PUBLIC_SCHEMA_REPO_BASE` (see [Configuration](#configuration)). The open-proposals badge only ever renders a real count, so it stays hidden until CRM is actually enabled. Each CRM read also degrades on its own: if an individual route is missing or errors after CRM is enabled, that panel renders empty instead of blanking the page.

Prefer the old hide-until-detected behavior? Set `NEXT_PUBLIC_OPTIONAL_NAV=auto` (see [Configuration](#configuration)) and rebuild — the dashboard probes for `/crm` once at login, caches the result in the session, and only then shows the Contacts/Proposals entries.

## Wiki (optional)

If your brain runs the persistent-wiki layer (the `schemas/wiki-pages` schema and the `/wiki/*` routes on `open-brain-rest`), the dashboard grows a wiki surface:

| Page | What you get |
|------|--------------|
| **Wiki** (`/wiki`) | Page list filtered by kind (topic / entity / autobiography / custom), with section counts and a "new page" form. |
| **Wiki page** (`/wiki/:slug`) | Sections in display order, each with its markdown body rendered sanitized, an origin chip (yours / generated), a lock toggle, and an evidence chip listing supporting thought ids. Edit a section inline (your edit takes ownership); add a section; archive the page. When a machine writer proposes an update to a section you own, a review panel shows the current body against the proposed draft with **accept / reject**. |

The Wiki nav entry appears **by default, whether or not the brain has the wiki layer installed yet**. Visiting `/wiki` on a brain without it — the login-time probe came back negative, a re-check still says no, or `GET /wiki/pages` returns 404 — shows a setup card: apply `schemas/wiki-pages`, confirm `open-brain-rest` exposes the `/wiki/*` route group, and a **Re-check now** button that re-probes the brain and refreshes the page without a sign-out.

Prefer the old hide-until-detected behavior? Set `NEXT_PUBLIC_OPTIONAL_NAV=auto` (see [Configuration](#configuration)) and rebuild — the dashboard probes for `/wiki` once at login, caches the result in the session, and only then shows the Wiki entry.

Archived pages are hidden from the list but stay fetchable — and editable — by slug; unarchive is a future gateway addition.

Section bodies are agent-writable over MCP, so the dashboard treats them as untrusted: markdown is rendered with `react-markdown` and **no raw-HTML plugin**, so any embedded HTML is shown as text and never executed.

## Screenshots

Screenshots go in `docs/screenshots/` and should be referenced from this README once you add them.

## Prerequisites

- A working Open Brain setup ([guide](../../docs/01-getting-started.md))
- The **REST API gateway** (`open-brain-rest` Edge Function from PR #201) deployed and reachable
- **Node.js 20+**
- A host for the dashboard: Vercel or Netlify free tier works; self-hosting on a Node.js 20+ runtime is also fine

## Configuration

All configuration is through environment variables. **The app refuses to start if required variables are missing.**

| Variable | Required | Description |
|----------|----------|-------------|
| `NEXT_PUBLIC_API_URL` | Yes | Base URL of your Open Brain REST API, typically `https://YOUR-PROJECT-REF.supabase.co/functions/v1/open-brain-rest`. |
| `SESSION_SECRET` | Yes | 32+ character secret used by `iron-session` to encrypt the session cookie. Generate with `openssl rand -hex 32`. |
| `RESTRICTED_PASSPHRASE_HASH` | No | SHA-256 hash of a passphrase that unlocks restricted/sensitive content. Only meaningful if your brain has a `sensitivity_tier` column on `public.thoughts`. There is no official sensitivity-tiers primitive upstream yet — either add your own migration (see PR #192 for pattern) or wait for the primitive to land. On stock OB1, this dashboard's restricted-content toggle is hidden at startup. Generate with `echo -n "your-passphrase" \| shasum -a 256`. |
| `NEXT_PUBLIC_OPTIONAL_NAV` | No | Controls whether the Contacts/Proposals (CRM) and Wiki nav entries show before their schema is installed. Default (unset, or any value other than `auto`): always show them, with a setup card on the page itself. Set to `auto` to restore hide-until-enabled behavior, gated on the login-time probe cached in the session. This is a `NEXT_PUBLIC_*` var, so it's inlined at **build** time — changing it needs a rebuild, not just a restart. |
| `NEXT_PUBLIC_SCHEMA_REPO_BASE` | No | Base URL for the schema-folder links on the setup cards, e.g. `https://github.com/YOUR-ORG/YOUR-REPO/tree/main`. Defaults to the `alanshurafa/OB1` fork, where all the optional schemas currently live (they haven't landed upstream yet). Set it to your own repo/mirror if you maintain one. Build-time, like the other `NEXT_PUBLIC_*` vars. |

Copy `.env.example` to `.env.local` (gitignored) and fill it in.

## Installation

```bash
cd dashboards/open-brain-dashboard-pro
npm install

# Local dev
cp .env.example .env.local   # then edit and fill in values
npm run dev                  # http://localhost:3000

# Production build
npm run build
npm start
```

For Vercel or Netlify, connect this folder and set the same environment variables in the hosting provider's dashboard.

## Authentication

The dashboard uses [`iron-session`](https://github.com/vvo/iron-session) v8 for encrypted HTTP-only session cookies. No API key is ever exposed to the browser.

1. User enters their Open Brain API key at `/login`.
2. The server hits `GET {NEXT_PUBLIC_API_URL}/health` with `x-brain-key: <apiKey>` — if the REST gateway responds `200 OK`, the key is accepted.
3. The key is written into an encrypted session cookie named `open_brain_session` (24 h TTL, `httpOnly`, `secure` in production, `sameSite: lax`).
4. Every server component and API route reads the key from the session and injects it into Open Brain REST calls.
5. `/api/logout` destroys the session and redirects back to `/login`.

If `SESSION_SECRET` is missing or shorter than 32 characters, the app throws at startup so you can't accidentally run with an empty cookie password.

## Expected REST Endpoints

The dashboard calls these endpoints on your Open Brain REST gateway (all authenticated via `x-brain-key`):

| Endpoint | Method | Used by | Required? |
|----------|--------|---------|-----------|
| `/health` | GET | Login validation, Settings status | **Yes** |
| `/count` | GET | Settings status (total + per-type counts) | **Yes** |
| `/stats` | GET | Dashboard stats widget | **Yes** |
| `/thoughts` | GET | Browse, Dashboard recent, Audit (filtered) | **Yes** |
| `/thought/:id` | GET, PUT, DELETE | Detail view, inline edit, delete | **Yes** |
| `/search` | POST | Search page (semantic + full-text) | **Yes** |
| `/capture` | POST | Single-thought "Add to Brain" path | **Yes** |
| `/thought/:id/connections` | GET | Detail page connections panel | Optional — panel hides if it errors |
| `/duplicates`, `/duplicates/resolve` | GET / POST | Duplicates page | Optional — page shows an error otherwise |
| `/ingest`, `/ingestion-jobs`, `/ingestion-jobs/:id`, `/ingestion-jobs/:id/execute` | POST / GET | Ingest page | Optional — page still loads without jobs |
| `/crm/*` (contacts, proposals, notes, tasks, important-dates, timeline, history, …) | GET / POST / PATCH | Contacts, Proposals, contact detail panels | Optional — nav entries show by default; the pages themselves render a setup card until `/crm` is detected |
| `/wiki/*` (pages, pages/:slug, sections/:id/accept-pending, reject-pending, lock, …) | GET / POST / PUT / DELETE | Wiki list, wiki page, section edit / lock / draft review | Optional — nav entry shows by default; the page itself renders a setup card until `/wiki` is detected |

> **On `/reflections/*`:** The ExoCortex upstream dashboard staged a reflections feature. This fork does not yet ship a reflections UI surface, but the architecture is ready: if you add a reflection panel later and your gateway doesn't serve `/reflections/*`, expect a 404 that the UI should swallow. The existing optional endpoints already degrade this way — the Connections panel, Duplicates page, and Ingest history all swallow fetch errors and render an empty/neutral state instead of crashing.

## Adapting

- **Point at a different REST API** — change `NEXT_PUBLIC_API_URL`. Everything else follows.
- **Remove Audit** — delete `app/audit/`, `app/api/audit/`, and the `AuditIcon` nav entry in `components/Sidebar.tsx`.
- **Remove Duplicates** — delete `app/duplicates/`, `app/api/duplicates/`, and the `DuplicatesIcon` nav entry in `components/Sidebar.tsx`.
- **Remove Ingest** — delete `app/ingest/`, `app/api/ingest/`, and the `AddIcon` nav entry. The `AddToBrain` component will no longer be reachable; remove its usage from `app/page.tsx` (the Dashboard).
- **Rebrand** — the wordmark lives in `app/layout.tsx` (`metadata`), `components/Sidebar.tsx` (header), `app/login/page.tsx` (hero), and a few in-page strings (`app/page.tsx`, `app/ingest/page.tsx`). The session cookie name is `open_brain_session` (see `lib/auth.ts` and `proxy.ts`).
- **Change the color palette** — edit `app/globals.css`. The CSS variables under `@theme inline` drive every surface color.
- **Add a new page** — drop a `page.tsx` under `app/` following the existing patterns. For protected pages, call `await requireSessionOrRedirect()` at the top and do REST work from the server.

## Deployment

> **A note on `proxy.ts` vs `middleware.ts` (Cloudflare caveat).** This dashboard uses the Next.js 16 `proxy.ts` convention (the older `middleware.ts` is deprecated). There is a known issue ([vercel/next.js#86122](https://github.com/vercel/next.js/issues/86122)) where `proxy.ts` does not execute in production behind Cloudflare Proxy, while `middleware.ts` does. Auth in this dashboard is enforced server-side on every server component and API route, so `proxy.ts` is defense-in-depth only and the app remains secure if it never runs. If your deploy target is Cloudflare and you want the extra redirect layer active, rename `proxy.ts` back to `middleware.ts` (and rename the exported `proxy` function to `middleware`). You'll get a Next.js deprecation warning at build time, but the redirect logic will fire. Vercel, Netlify, and standalone Node.js hosting work correctly with `proxy.ts` as-shipped.

### Vercel

1. Import the `dashboards/open-brain-dashboard-pro/` folder as a new project (or use `vercel link` from inside it).
2. Set `NEXT_PUBLIC_API_URL` and `SESSION_SECRET` (and optionally `RESTRICTED_PASSPHRASE_HASH`) in Project Settings → Environment Variables.
3. Deploy. Vercel's free tier is sufficient — the dashboard does only lightweight server-side proxy work.

### Netlify

1. Point a new site at the folder. Netlify will detect Next.js automatically.
2. Set the same environment variables.
3. Deploy.

### Self-hosted (Node.js 20+)

```bash
npm ci
npm run build
NODE_ENV=production \
  NEXT_PUBLIC_API_URL=... \
  SESSION_SECRET=... \
  npm start
```

The app listens on port 3000 by default; use `PORT=4000 npm start` to override.

## Tech Stack

- **Next.js 16** (App Router, server components)
- **React 19** + TypeScript
- **Tailwind CSS 4** (dark theme, custom palette)
- **iron-session 8** (encrypted cookies)

## Troubleshooting

1. **"SESSION_SECRET env var is required and must be at least 32 characters"** — generate one with `openssl rand -hex 32` and set it. This is intentional; the app refuses to start without it.
2. **Login says "Could not reach API"** — verify `NEXT_PUBLIC_API_URL` is correct and the REST gateway is live. Test with `curl -H "x-brain-key: YOUR_KEY" $NEXT_PUBLIC_API_URL/health`.
3. **Login says "Invalid API key or service unavailable"** — the REST gateway reached but rejected the key. Check `MCP_ACCESS_KEY` (or whatever secret backs `x-brain-key`) in your Edge Function secrets.
4. **Search returns nothing** — semantic search needs embeddings. Verify `OPENROUTER_API_KEY` (or your embedding provider) is set in Supabase secrets and that the `embedding` column is populated.
5. **Ingest page never finishes extracting** — confirm the `smart-ingest` Edge Function is deployed alongside the REST gateway.
6. **Connections panel empty on Detail page** — the panel requires `topics` or `people` in `metadata`. Thoughts enriched through classification have these; raw captures do not.
