# Open Brain

The infrastructure layer for your thinking. One database, one AI gateway, one chat channel. Any AI you use can plug in. No middleware, no SaaS chains, no Zapier.

This isn't a notes app. It's a database with vector search and an open protocol — built so that every AI tool you use shares the same persistent memory of you. Claude, ChatGPT, Cursor, Claude Code, whatever ships next month. One brain. All of them.

> Open Brain was created by [Nate B. Jones](https://natesnewsletter.substack.com/). Follow the [Substack](https://natesnewsletter.substack.com/) for updates, discussion, and the companion prompt pack.

## Getting Started

Never built an Open Brain? Start here:

1. **[Setup Guide](docs/01-getting-started.md)** — Build the full system (database, AI gateway, Slack capture, MCP server) in about 45 minutes. No coding experience needed.
2. **[Companion Prompts](docs/02-companion-prompts.md)** — Five prompts that help you migrate your memories, discover use cases, and build the capture habit.

**If you hit a wall:** We built a [FAQ](docs/03-faq.md) that covers the most common questions and gotchas. And if you need real-time help, we created dedicated AI assistants that know this system inside and out: a [Claude Skill](https://www.notion.so/product-templates/Open-Brain-Companion-Claude-Skill-31a5a2ccb526802797caeb37df3ba3cb?source=copy_link), a [ChatGPT Custom GPT](https://chatgpt.com/g/g-69a892b6a7708191b00e48ff655d5597-nate-jones-open-brain-assistant), and a [Gemini GEM](https://gemini.google.com/gem/1fDsAENjhdku-3RufY7ystbS1Md8MtDCg?usp=sharing). Use whichever one matches the AI tool you already use.

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

Built by Nate B. Jones's team. Matt Hallett is the first community admin and repo manager. PRs are reviewed by the automated agent + human admins.

## License

[FSL-1.1-MIT](LICENSE.md)
