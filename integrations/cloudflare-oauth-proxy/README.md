# Cloudflare OAuth Proxy

A tiny Cloudflare Worker that gives your Supabase-hosted MCP server a clean,
path-less origin URL and serves the OAuth login form, so Claude Desktop
(and other MCP TypeScript SDK clients like `mcp-remote`) can complete
OAuth discovery and sign-in.

## What It Does

The Worker solves two concrete problems with hosting OAuth on a Supabase
Edge Function:

**1. Path-less origin for OAuth discovery.** MCP's OAuth flow is spec'd on
top of RFC 8414 / RFC 9728. When an MCP client needs to discover the
authorization server, the MCP TypeScript SDK composes the metadata URL by
taking the authorization-server URL's **origin only** — it strips any
path. Supabase Edge Functions are mounted under
`/functions/v1/<function-name>/`, so the SDK tries URLs like
`https://<ref>.supabase.co/.well-known/oauth-authorization-server` and
`https://<ref>.supabase.co/register` — both of which hit the Supabase
platform gateway and return 404. OAuth never completes.

**2. Serving HTML.** The OAuth login form (GET `/authorize`) has to render
as HTML in the user's browser. Supabase Edge Functions force
`Content-Type: text/plain` and a `default-src 'none'; sandbox` CSP on every
response at the platform level, regardless of what the function code sets.
Result: the form displays as raw source text and can't submit. Not
overridable from inside the function.

This Worker fixes both by sitting in front of the Edge Function on a clean
origin (`ob-<name>.<your-cf-account>.workers.dev`). It:

- Proxies every request to the Edge Function, prepending
  `/functions/v1/<name>` on the way out — so the client sees no path and
  the SDK can discover OAuth endpoints correctly.
- **Serves GET `/authorize` itself** from Worker code (the one endpoint
  that must return HTML). POST `/authorize` still proxies to Supabase for
  password verification; everything else (discovery, `/register`, `/token`,
  MCP calls) is a pure passthrough.

```
Claude Desktop ──▶ ob-<name>.workers.dev/<anything>
                           │
                           ▼ (Worker)
    GET /authorize  ─── render login form HTML ──▶ user's browser
    everything else ──▶ proxy to Supabase
                           │
                           ▼
    https://<ref>.supabase.co/functions/v1/<name>/<anything>
                           │
                           ▼
                (existing Edge Function runs as-is)
```

Your Edge Function is still the source of truth for password
verification, token issuance, and tool handling; the Worker just gives it
a different advertised origin and renders the one HTML page.

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
| `WORKER_URL` | Filled in after deploy — `https://ob-core.<your-cf-subdomain>.workers.dev` |

(If you're proxying more than one MCP server — e.g. a recipe or extension
that runs as its own Edge Function — you'll record one Worker URL per
server. See [Multiple MCP servers](#multiple-mcp-servers) below.)

## Setup

### Step 1 — Configure

```bash
cd integrations/cloudflare-oauth-proxy
cp wrangler.toml.example wrangler.toml
```

Open `wrangler.toml` and replace `<SUPABASE_REF>` with your Supabase
project ref.

### Step 2 — Deploy

```bash
wrangler deploy --env core
```

`wrangler` prints the published URL. Record it as `WORKER_URL` in the
tracker.

### Step 3 — Tell the Edge Function about its new origin

The MCP server needs to know its public URL is now the Worker, not the
Supabase function. Set a single secret:

```bash
supabase secrets set \
  OAUTH_ISSUER_URL="<WORKER_URL>" \
  --project-ref YOUR_PROJECT_REF
```

No redeploy needed — secrets take effect on the next function
invocation. (The Supabase Dashboard's Edge Function Secrets UI works
too if you'd rather click than type.)

### Step 4 — Verify

```bash
# 1. Discovery document advertises the Worker URL as the issuer
curl -s "${WORKER_URL}/.well-known/oauth-authorization-server" | jq .issuer
# → "https://ob-core.<your-cf-subdomain>.workers.dev"

# 2. WWW-Authenticate points at the Worker-scoped resource_metadata URL
curl -sI "${WORKER_URL}/" | grep -i 'www-authenticate'

# 3. Full OAuth flow end-to-end with mcp-remote
npx mcp-remote "${WORKER_URL}" --debug
# Browser opens to the /authorize form → enter your OAUTH_PASSWORD → tools appear.
```

### Step 5 — Connect Claude Desktop

In Claude Desktop: **Settings → Connectors → Add custom connector**, paste
`WORKER_URL` (no `?key=`, no trailing slash).

## Multiple MCP servers

If you're running more than one MCP server in the same Supabase project
(e.g., the core Open Brain plus a recipe or extension that deploys its
own Edge Function), each server needs its own Worker and its own
issuer-URL secret.

**Add another deploy env to `wrangler.toml`:**

```toml
[env.my-extension]
name = "ob-my-extension"

[env.my-extension.vars]
UPSTREAM_BASE = "https://<SUPABASE_REF>.supabase.co"
FUNCTION_NAME = "my-extension-mcp"
```

**Deploy it:**

```bash
wrangler deploy --env my-extension
```

**Set a per-function secret.** Supabase secrets are project-wide, but the
Edge Function code picks the right value per-function by looking up
`OAUTH_ISSUER_URL_<FUNCTION_NAME>` first (uppercased, dashes replaced
with underscores), then falling back to the plain `OAUTH_ISSUER_URL`.
So the core server uses the plain name and each additional server sets
an override:

```bash
supabase secrets set \
  OAUTH_ISSUER_URL_MY_EXTENSION_MCP="<WORKER_URL_FOR_MY_EXTENSION>" \
  --project-ref YOUR_PROJECT_REF
```

Repeat for as many MCP servers as you're proxying.

## Expected Outcome

- Claude Desktop can connect via OAuth — you type the password once per
  client (and again whenever you rotate `OAUTH_JWT_SECRET`).
- Every OAuth URL (discovery, `/register`, `/authorize`, `/token`) resolves
  to the Worker, which forwards to Supabase transparently.
- The original Supabase URL still works unchanged for any client hitting it
  directly — `?key=` and `x-brain-key` header flows are untouched by the
  Worker.

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
`OAUTH_ISSUER_URL` (or the per-function override) isn't set on the Edge
Function's secrets, or is set to the wrong value. Re-check Step 3, then
make a fresh request. Claude Desktop caches discovery docs per-session,
so remove and re-add the connector after fixing.

**OAuth flow redirects to `claude.ai/...couldn't connect`**
Re-run `npx mcp-remote <worker-url> --debug` and inspect
`/tmp/mcp-remote.log`. A `404` on `<worker-url>/.well-known/...` means the
Worker is routing incorrectly. A `ServerError at registerClient` means the
Worker isn't forwarding POSTs correctly — verify `redirect: "manual"` is
present in `src/index.ts` and that you deployed the latest version.

**Login form displays as raw HTML source in the browser**
The Worker isn't serving `GET /authorize` itself — it's falling through to
Supabase, which forces `Content-Type: text/plain`. Make sure you deployed
the latest `src/index.ts` (it should have a `renderAuthorizeForm` function
and an early return for `GET /authorize`).
