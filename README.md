# OB1 — Open Brain Community Extensions

OB1 is where people share what they've built on top of [Open Brain](docs/getting-started.md). Not core infrastructure — extensions, integrations, and tools that make your brain do more. Browse what's here, grab what you need, contribute what you've built.

## Getting Started

New to Open Brain? The complete setup guide is in this repo:

**[Build Your Open Brain: Complete Setup Guide](docs/getting-started.md)**

It walks you through the full setup — database, AI gateway, Slack capture, MCP server — in about 45 minutes. No coding experience needed.

## What's Inside

### [`/recipes`](recipes/) — Step-by-step builds
Each recipe teaches you how to add a new capability to your Open Brain. Follow the instructions, run the code, get a new feature.
- Email history import (pull your Gmail archive into searchable thoughts)
- ChatGPT conversation import (ingest your ChatGPT data export)
- Daily digest generator (automated summary of recent thoughts via email or Slack)

### [`/schemas`](schemas/) — Database extensions
New tables, metadata schemas, and column extensions for your Supabase database. Drop them in alongside your existing `thoughts` table.
- CRM contact layer (track people, interactions, and relationship context)
- Taste preferences tracker
- Reading list with rating metadata

### [`/dashboards`](dashboards/) — Frontend templates
Host these on Vercel or Netlify, pointed at your Supabase backend. Instant UI for your brain.
- Personal knowledge dashboard
- Weekly review view
- Mobile-friendly capture UI

### [`/integrations`](integrations/) — New connections
MCP server extensions, webhook receivers, and capture sources beyond Slack.
- Discord capture bot
- Email forwarding handler
- Browser extension connector

## Using a Contribution

1. Browse the category folders above
2. Find what you want and open its folder
3. Read the README — it has prerequisites, step-by-step instructions, and troubleshooting
4. Most contributions involve running SQL against your Supabase database, deploying an edge function, or hosting frontend code. The README will tell you exactly what to do.

## Contributing

Read [CONTRIBUTING.md](CONTRIBUTING.md) for the full details. The short version:

- Every PR runs through an automated review agent that checks 10 rules (file structure, no secrets, SQL safety, etc.)
- If the agent passes, a human admin reviews for quality and clarity
- Your contribution needs a README with real instructions and a `metadata.json` with structured info

## Community

Questions, ideas, help with contributions — the [Substack community chat](https://natebjones.substack.com/) is where it happens.

## Who Maintains This

Built and maintained by Nate B. Jones's team. Matt Hallett is the first community admin. PRs are reviewed by the automated agent + human admins.

## License

[MIT](LICENSE)
