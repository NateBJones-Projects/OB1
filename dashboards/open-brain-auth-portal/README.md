# Open Brain Auth Portal

Standalone OAuth consent portal for Open Brain MCP servers.

## What it does

This app is the hosted sign-in and consent surface for the new Open Brain OAuth-based MCP flow. It gives Supabase Auth a real login page, a consent screen, and approve/deny callbacks that redirect back to Claude, ChatGPT, or any other remote MCP client.

## Prerequisites

- Working Open Brain setup ([guide](../../docs/01-getting-started.md))
- Supabase OAuth 2.1 enabled for your project
- A Supabase Auth owner user created for Open Brain
- Node.js 20.9+

## Quick Start

1. Install dependencies:

   ```bash
   cd dashboards/open-brain-auth-portal
   npm install
   ```

2. Copy envs:

   ```bash
   cp .env.example .env.local
   ```

3. Fill in:

   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`

4. Run locally:

   ```bash
   npm run dev
   ```

5. Deploy to Vercel and use the deployed `/oauth/consent` route as your Supabase OAuth authorization URL.

## Expected outcome

After deployment, a remote MCP client that hits your protected Open Brain server and receives `401 + WWW-Authenticate` should be redirected through Supabase Auth and land on this portal for sign-in and approval.

## Troubleshooting

**Issue: Consent screen says `Missing authorization_id`**
Solution: You opened the consent route directly without a real Supabase OAuth request. Use the root page preview or trigger the flow from an MCP client.

**Issue: Sign-in works but consent page loops back to login**
Solution: Verify the same `NEXT_PUBLIC_SUPABASE_URL` and publishable key are configured in both local env and deployed env. Mismatched projects cause session cookies to be ignored.

**Issue: Supabase returns an invalid authorization request**
Solution: Confirm Supabase OAuth 2.1 is enabled and that the authorization URL path points to `/oauth/consent` on this deployed app.
