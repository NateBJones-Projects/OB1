# OB1 — Open Brain Community

OB1 is the community home for [Open Brain](https://natesnewsletter.substack.com/) — the open-source personal memory layer for AI. Set up your brain, learn how to use it, and find extensions other people have built on top of it.

## Getting Started

Never built an Open Brain? Start here:

1. **[Setup Guide](docs/getting-started.md)** — Build the full system (database, AI gateway, Slack capture, MCP server) in about 45 minutes. No coding experience needed.
2. **[Companion Prompts](docs/companion-prompts.md)** — Five prompts that help you migrate your memories, discover use cases, and build the capture habit.

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

Questions, ideas, help with contributions — the [Substack community chat](https://natesnewsletter.substack.com/) is where it happens.

## Who Maintains This

Built and maintained by Nate B. Jones's team. Matt Hallett is the first community admin. PRs are reviewed by the automated agent + human admins.

## License

[MIT](LICENSE.md)
