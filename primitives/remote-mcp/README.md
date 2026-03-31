# Remote MCP Connection

How to connect Open Brain MCP servers to Claude Desktop, ChatGPT, Claude Code, Codex, and other AI clients using OAuth 2.1.

## What Changed

Open Brain used to embed a static access key directly in the MCP URL. That worked, but it pushed a long-lived secret into query strings, screenshots, config files, and browser history.

The new pattern is:

- MCP server URL stays clean
- client receives `401 + WWW-Authenticate`
- client runs OAuth against your Supabase project
- client retries with `Authorization: Bearer <token>`

This is now the canonical OB1 pattern for Supabase-backed remote MCP servers.

## What You Need

- Your MCP server URL
  Example: `https://YOUR_PROJECT_REF.supabase.co/functions/v1/open-brain-mcp`
- Supabase OAuth 2.1 enabled
- The [Open Brain Auth Portal](../../dashboards/open-brain-auth-portal/) deployed
- Your server redeployed with:
  - `SUPABASE_PUBLISHABLE_KEY`
  - `OB1_OWNER_USER_ID`
  - `ALLOW_LEGACY_MCP_KEY` set the way you want

## Claude Desktop / Claude.ai

1. Open Claude → **Settings** → **Connectors**
2. Click **Add custom connector**
3. Name it whatever you want
4. Paste your MCP server URL
5. Save

On the first protected tool call, Claude should trigger the OAuth flow automatically and redirect you to your Open Brain auth portal.

## ChatGPT

1. Open ChatGPT → **Settings** → **Apps & Connectors**
2. Turn on **Developer mode**
3. Create a new MCP app
4. Paste your MCP server URL
5. Choose OAuth when prompted

Do not use "No Authentication" for the new OB1 pattern. If ChatGPT is still configured with an old key-bearing URL, delete that connector and recreate it cleanly.

## Claude Code

Use an OAuth-capable remote transport. The exact bridge depends on the client/runtime, but the important part is the transport must follow the remote server's `401` challenge and complete the OAuth flow instead of trying to stuff a static key into headers.

## Codex / Other Editor Clients

Use the clean MCP server URL and an OAuth-capable remote bridge. If the client only knows how to pass static headers, it is still on the legacy path.

## Troubleshooting

**OAuth discovery fails**
- Verify Supabase OAuth 2.1 is enabled
- Verify your auth portal authorization URL is correct
- Verify your MCP server responds with `401` and `WWW-Authenticate`

**Consent screen never appears**
- The client may still be using an old key-bearing URL
- Remove the connector and re-add it with the clean server URL
- Confirm the MCP server is returning protected-resource metadata

**Authenticated but still forbidden**
- The signed-in Supabase user does not match `OB1_OWNER_USER_ID`

## Legacy Key Migration Appendix

If you already have working key-based connectors in the wild:

- keep `ALLOW_LEGACY_MCP_KEY=true` while you reconnect clients
- migrate each client to OAuth one by one
- disable the fallback only after OAuth is stable

For the full migration sequence, use the [OAuth MCP Upgrade recipe](../../recipes/oauth-mcp-upgrade/).

## Extensions That Use This

- [Household Knowledge Base](../../extensions/household-knowledge/) (Extension 1)
- [Home Maintenance Tracker](../../extensions/home-maintenance/) (Extension 2)
- [Family Calendar](../../extensions/family-calendar/) (Extension 3)
- [Meal Planning](../../extensions/meal-planning/) (Extension 4)
- [Professional CRM](../../extensions/professional-crm/) (Extension 5)
- [Job Hunt Pipeline](../../extensions/job-hunt/) (Extension 6)
