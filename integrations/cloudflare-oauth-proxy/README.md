# Cloudflare OAuth Proxy

A tiny Cloudflare Worker that gives your Supabase-hosted MCP server a clean,
path-less origin URL so Claude Desktop (and other MCP TypeScript SDK clients
like `mcp-remote`) can complete OAuth discovery.

## What It Does

MCP's OAuth flow is spec'd on top of RFC 8414 / RFC 9728. When an MCP client
needs to discover the authorization server, the MCP TypeScript SDK composes
the metadata URL by taking the authorization-server URL's **origin only** —
it strips any path. Supabase Edge Functions are mounted under
`/functions/v1/<function-name>/`, so the SDK tries URLs like
`https://<ref>.supabase.co/.well-known/oauth-authorization-server` and
`https://<ref>.supabase.co/register` — both of which hit the Supabase
platform gateway and return 404. OAuth never completes.

This Worker fixes it by proxying every request from a clean origin
(`ob-<name>.<your-cf-account>.workers.dev`) to the Supabase Edge Function,
prepending `/functions/v1/<name>` on the way out. The client sees no path,
nothing to strip, OAuth resolves correctly, and the full PKCE flow works.

```
Claude Desktop ──▶ ob-life-crm.workers.dev/<anything>
                           │
                           ▼ (Worker re-fetches)
      https://<ref>.supabase.co/functions/v1/life-crm-mcp/<anything>
                           │
                           ▼
                (existing Edge Function runs as-is)
```

The Worker is a pure path-rewriter — no auth, no cache, no transforms. Your
Edge Function is still the source of truth for authorization and tool
handling; this just gives it a different advertised origin.

## Prerequisites

- A deployed Open Brain MCP server with OAuth enabled — complete Steps 1–7
  and the optional Step 7b in `docs/01-getting-started.md` first.
- A Cloudflare account (free tier works). Sign up at
  [dash.cloudflare.com](https://dash.cloudflare.com).
- `wrangler` CLI installed (`npm install -g wrangler`) and authenticated
  (`wrangler login`).
- Node.js 20+.

## Credential Tracker

| Field | Value |
|-------|-------|
| `SUPABASE_REF` | Your Supabase project ref (Step 1 of main setup) |
| `WORKER_URL_CORE` | Filled in after deploy — `https://ob-core.<your-cf-subdomain>.workers.dev` |
| `WORKER_URL_LIFE_CRM` | Filled in after deploy — `https://ob-life-crm.<your-cf-subdomain>.workers.dev` |

## Setup

### Step 1 — Configure

```bash
cd integrations/cloudflare-oauth-proxy
cp wrangler.toml.example wrangler.toml
```

Open `wrangler.toml` and replace `<SUPABASE_REF>` in both `[env.core.vars]`
and `[env.life-crm.vars]` with your Supabase project ref.

### Step 2 — Deploy both Workers

```bash
wrangler deploy --env core
wrangler deploy --env life-crm
```

Each command prints the published URL. Record them in the credential
tracker.

### Step 3 — Tell the Edge Functions about their new origin

Each MCP server needs to know its public URL is now the Worker, not the
Supabase function. Set `OAUTH_ISSUER_URL` on each function **separately**.
Use the Supabase Dashboard (the CLI sets project-wide secrets, which would
collide between the two functions):

1. Open the dashboard → Project → **Edge Functions** → `open-brain-mcp` → **Secrets**.
2. Add a secret: `OAUTH_ISSUER_URL` = the `WORKER_URL_CORE` from Step 2.
3. Repeat for `life-crm-mcp` with `WORKER_URL_LIFE_CRM`.

No redeploy needed — secrets take effect on the next function invocation.

### Step 4 — Verify

```bash
# 1. Discovery document now advertises the Worker URL as the issuer
curl -s "${WORKER_URL_LIFE_CRM}/.well-known/oauth-authorization-server" | jq .issuer
# → "https://ob-life-crm.<your-cf-subdomain>.workers.dev"

# 2. WWW-Authenticate points at the Worker-scoped resource_metadata URL
curl -sI "${WORKER_URL_LIFE_CRM}/" | grep -i 'www-authenticate'

# 3. Full OAuth flow end-to-end with mcp-remote
npx mcp-remote "${WORKER_URL_LIFE_CRM}" --debug
# Browser opens to the /authorize form → enter your OAUTH_PASSWORD → tools appear.
```

### Step 5 — Connect Claude Desktop

In Claude Desktop: **Settings → Connectors → Add custom connector**, paste
the Worker URL (no `?key=`, no trailing slash).

Repeat for each MCP server you deployed a Worker for.

## Expected Outcome

- Claude Desktop can connect via OAuth — you type the password once per
  client (and again whenever you rotate `OAUTH_JWT_SECRET`).
- Every OAuth URL (discovery, `/register`, `/authorize`, `/token`) resolves
  to the Worker, which forwards to Supabase transparently.
- The original Supabase URL still works unchanged for any client hitting it
  directly — `?key=` and `x-brain-key` / `x-access-key` header flows are
  untouched by the Worker.

## Troubleshooting

**`wrangler deploy` errors with "not authenticated"**
Run `wrangler login` and try again. Deploy won't work against an expired
session.

**Worker deploys but returns 404 on every request**
Check that `UPSTREAM_BASE` and `FUNCTION_NAME` in `wrangler.toml` are
correct. Test directly:
`curl -s "${UPSTREAM_BASE}/functions/v1/${FUNCTION_NAME}/health"` — that
should return JSON. If it doesn't, fix the upstream before worrying about
the Worker.

**`/.well-known/oauth-authorization-server` still shows the Supabase URL as issuer**
`OAUTH_ISSUER_URL` isn't set on the Edge Function's secrets, or is set to the
wrong value. Re-check Step 3, then make a fresh request (no HTTP caching —
Claude Desktop caches discovery docs per-session, so re-open the connector).

**OAuth flow redirects to `claude.ai/...couldn't connect`**
Re-run `npx mcp-remote <worker-url> --debug` and inspect
`/tmp/mcp-remote.log`. A `404` on `<worker-url>/.well-known/...` means the
Worker is routing incorrectly. A `ServerError at registerClient` means the
Worker isn't forwarding POSTs correctly — verify `redirect: "manual"` is
present in `src/index.ts` and that you deployed the latest version.
