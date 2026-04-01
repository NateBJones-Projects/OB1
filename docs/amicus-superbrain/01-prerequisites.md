# 01 — Prerequisites

Everything you need before setting up Amicus Superbrain.

---

## Accounts Required

| Service | Purpose | Cost |
|---------|---------|------|
| [Supabase](https://supabase.com) | Database, storage, Edge Functions | Free tier (generous limits) |
| [OpenRouter](https://openrouter.ai) | AI gateway for embeddings and metadata extraction | ~$5 credits (lasts months) |
| [Microsoft Azure AD](https://portal.azure.com) | Outlook email import (optional) | Free |

## Tools Required

| Tool | Purpose | Install |
|------|---------|---------|
| [Supabase CLI](https://supabase.com/docs/guides/cli) | Deploy Edge Functions | `brew install supabase/tap/supabase` |
| [Deno](https://deno.land) | Runtime for import scripts | `curl -fsSL https://deno.land/install.sh \| sh` |
| [GitHub CLI](https://cli.github.com) | (Optional) For contributing back | `brew install gh` |

## AI Clients (connect one or more)

- [Claude](https://claude.ai) — via Settings > Connectors > Add custom connector
- [ChatGPT](https://chat.openai.com) — via MCP plugin/connector
- [Claude Code](https://claude.ai/claude-code) — via MCP configuration
- Any other MCP-compatible AI client

---

## Credential Tracker

You will generate keys across multiple services. Copy this block into a text editor and fill it in as you go.

```text
AMICUS SUPERBRAIN -- CREDENTIAL TRACKER
========================================

SUPABASE
  Project ref:               ____________
  Project URL:               https://____________.supabase.co
  Service Role Key:          ____________
  Database Password:         ____________

OPENROUTER
  API Key:                   sk-or-v1-____________

MCP SERVER
  Access Key:                ____________  (you generate this)
  Default User ID:           ____________  (UUID for your CRM data)
  Server URL:                https://____________.supabase.co/functions/v1/open-brain-mcp

MICROSOFT AZURE AD (for Outlook import)
  Application (Client) ID:  ____________
  Tenant ID:                ____________  (or "common")

========================================
```

---

## Generate Your User ID

Your CRM data is scoped to a user ID. Generate one now and save it in your credential tracker:

```bash
# macOS / Linux
uuidgen | tr '[:upper:]' '[:lower:]'
```

## Generate Your MCP Access Key

This key protects your MCP server endpoint:

```bash
openssl rand -hex 32
```

Save both values — you will need them in the next steps.

---

Next: [02 — Database Setup](02-database-setup.md)
