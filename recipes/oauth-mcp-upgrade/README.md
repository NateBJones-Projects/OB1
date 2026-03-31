# OAuth MCP Upgrade

Move an existing Open Brain install from static `?key=` MCP auth to owner-bound OAuth 2.1, with a temporary legacy fallback while you test the new flow.

## What It Does

This recipe upgrades an already-working Open Brain to the new OAuth-based MCP pattern. You keep your data, redeploy your MCP server with bearer-token validation, host a small consent portal, reconnect Claude/ChatGPT through OAuth, then disable the old key-based path once you trust the new flow.

## Prerequisites

- Working Open Brain setup ([guide](../../docs/01-getting-started.md))
- Your existing MCP server already deployed and working
- Supabase Auth enabled in your project
- Node.js 20.9+ for the auth portal
- A host for the auth portal (Vercel is the default in this guide)

## Credential Tracker

Copy this block into a text editor and fill it in as you go.

```text
OAUTH MCP UPGRADE -- CREDENTIAL TRACKER
--------------------------------------

FROM YOUR OPEN BRAIN SETUP
  Project URL:                     ____________
  Secret key:                      ____________
  Publishable key:                 ____________
  Existing MCP server URL:         ____________
  Existing MCP access key:         ____________

GENERATED DURING UPGRADE
  Owner auth user email:           ____________
  Owner auth user password:        ____________
  Owner user ID:                   ____________
  Auth portal deploy URL:          ____________
  OAuth authorization URL:         ____________

--------------------------------------
```

![Step 1](https://img.shields.io/badge/Step_1-Create_Your_Owner_User-C65D2D?style=for-the-badge)

In Supabase Dashboard → Authentication → Users:

1. Create one email/password user for your Open Brain owner account if you do not already have one.
2. Open that user and copy the UUID. Save it as your `OB1_OWNER_USER_ID`.

✅ **Done when:** You have an owner email, password, and user ID saved.

![Step 2](https://img.shields.io/badge/Step_2-Deploy_the_Auth_Portal-C65D2D?style=for-the-badge)

Use the new [Open Brain Auth Portal](../../dashboards/open-brain-auth-portal/).

```bash
cd dashboards/open-brain-auth-portal
npm install
cp .env.example .env.local
```

Fill in:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`

Test locally:

```bash
npm run dev
```

Then deploy that folder to Vercel and copy the deploy URL.

✅ **Done when:** You have a working deployed auth portal URL.

![Step 3](https://img.shields.io/badge/Step_3-Configure_Supabase_OAuth-C65D2D?style=for-the-badge)

In Supabase Dashboard, enable OAuth 2.1 for your project and point the authorization URL to:

```text
https://YOUR_AUTH_PORTAL_DOMAIN/oauth/consent
```

Use the same project as your Open Brain database. The portal and the MCP server both need to talk to the same Supabase Auth instance.

✅ **Done when:** Supabase OAuth 2.1 is enabled and your authorization URL points to the auth portal.

![Step 4](https://img.shields.io/badge/Step_4-Set_New_Server_Secrets-C65D2D?style=for-the-badge)

In your Open Brain project folder:

```bash
supabase secrets set SUPABASE_PUBLISHABLE_KEY=your-publishable-key
supabase secrets set OB1_OWNER_USER_ID=your-owner-user-id
supabase secrets set ALLOW_LEGACY_MCP_KEY=true
```

Keep your existing `MCP_ACCESS_KEY` in place for the first rollout pass. That gives you a clean fallback while you reconnect clients and test.

✅ **Done when:** Your server has the publishable key, owner user ID, and legacy fallback flag set.

![Step 5](https://img.shields.io/badge/Step_5-Redeploy_Your_MCP_Server-C65D2D?style=for-the-badge)

Pull the latest server files from this repo and redeploy:

```bash
curl -o supabase/functions/open-brain-mcp/index.ts https://raw.githubusercontent.com/NateBJones-Projects/OB1/main/server/index.ts
curl -o supabase/functions/open-brain-mcp/deno.json https://raw.githubusercontent.com/NateBJones-Projects/OB1/main/server/deno.json
supabase functions deploy open-brain-mcp --no-verify-jwt
```

At this point your server accepts:

- `Authorization: Bearer <supabase-access-token>` as the new default
- `x-brain-key`, `x-access-key`, or `?key=` only while `ALLOW_LEGACY_MCP_KEY=true`

✅ **Done when:** The redeploy succeeds and the server health endpoint responds.

![Step 6](https://img.shields.io/badge/Step_6-Reconnect_Your_AI_Clients-C65D2D?style=for-the-badge)

Reconnect your clients using the new [Remote MCP Connection](../../primitives/remote-mcp/) guide.

- Claude Desktop / Claude.ai custom connectors should now follow the OAuth flow instead of using a key in the URL.
- ChatGPT custom MCP apps should use the OAuth flow instead of “No Authentication”.
- CLI/editor bridges should send bearer tokens or use an OAuth-capable bridge.

While `ALLOW_LEGACY_MCP_KEY=true`, your old key-based clients keep working if you need to roll back quickly.

✅ **Done when:** Claude or ChatGPT can connect through OAuth and call `search_thoughts` successfully.

![Step 7](https://img.shields.io/badge/Step_7-Disable_Legacy_Fallback-C65D2D?style=for-the-badge)

Once the OAuth clients are working, turn off the legacy path:

```bash
supabase secrets set ALLOW_LEGACY_MCP_KEY=false
supabase functions deploy open-brain-mcp --no-verify-jwt
```

Now the server will reject:

- `?key=...`
- `x-brain-key`
- `x-access-key`

and require bearer tokens from the OAuth flow.

✅ **Done when:** Old key-based calls fail with `401`, and OAuth-based calls still succeed.

## Expected Outcome

Your Open Brain MCP server now authenticates remote MCP clients through Supabase-backed OAuth 2.1. Existing data remains untouched. During the transition window, legacy key auth still works. After cutover, only OAuth bearer tokens work.

## Troubleshooting

**Issue: Connector says OAuth discovery failed**
Solution: Verify Supabase OAuth 2.1 is enabled and your MCP server is returning `401` with `WWW-Authenticate` pointing to its protected-resource metadata.

**Issue: Login works but MCP still returns `Forbidden`**
Solution: The signed-in Supabase user does not match `OB1_OWNER_USER_ID`. Copy the correct owner UUID from Supabase Auth and set that exact value in your Edge Function secrets.

**Issue: OAuth flow works in one client but not another**
Solution: Keep `ALLOW_LEGACY_MCP_KEY=true` while testing, confirm the client really supports remote MCP OAuth, then cut legacy off only after both Claude and ChatGPT succeed.
