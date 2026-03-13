<p align="center">
  <img src=".github/ob1-logo.png" alt="Open Brain" width="300">
</p>

<h1 align="center">Open Brain</h1>

The infrastructure layer for your thinking. One database, one AI gateway, one chat channel. Any AI you use can plug in. No middleware, no SaaS chains, no Zapier.

This isn't a notes app. It's a database with vector search and an open protocol — built so that every AI tool you use shares the same persistent memory of you. Claude, ChatGPT, Cursor, Claude Code, whatever ships next month. One brain. All of them.

> Open Brain was created by [Nate B. Jones](https://natesnewsletter.substack.com/). Follow the [Substack](https://natesnewsletter.substack.com/) for updates, discussion, and the companion prompt pack.

<p align="center">
  <video src=".github/videos/ob1-philosophy.mp4" width="640" controls>
    Your browser does not support the video tag. <a href="https://vimeo.com/1173109837">Watch on Vimeo</a>.
  </video>
  <br>
  <em>The Open Brain Philosophy (25 sec)</em>
</p>

## Getting Started

Never built an Open Brain? Start here:

1. **[Setup Guide](docs/01-getting-started.md)** — Build the full system (database, AI gateway, Slack capture, MCP server) in about 45 minutes. No coding experience needed.
2. **[Companion Prompts](docs/02-companion-prompts.md)** — Five prompts that help you migrate your memories, discover use cases, and build the capture habit.
3. **Then pick Extension 1** and start building.

**If you hit a wall:** We built a [FAQ](docs/03-faq.md) that covers the most common questions and gotchas. And if you need real-time help, we created dedicated AI assistants that know this system inside and out: a [Claude Skill](https://www.notion.so/product-templates/Open-Brain-Companion-Claude-Skill-31a5a2ccb526802797caeb37df3ba3cb?source=copy_link), a [ChatGPT Custom GPT](https://chatgpt.com/g/g-69a892b6a7708191b00e48ff655d5597-nate-jones-open-brain-assistant), and a [Gemini GEM](https://gemini.google.com/gem/1fDsAENjhdku-3RufY7ystbS1Md8MtDCg?usp=sharing). Use whichever one matches the AI tool you already use.

## Extensions — The Learning Path

Build these in order. Each one teaches new concepts through something you'll actually use. By the end, your agent manages your household, your schedule, your meals, your professional network, and your career — all interconnected.

| # | Extension | What You Build | Difficulty |
| --- | --------- | -------------- | ---------- |
| 1 | [Household Knowledge Base](extensions/household-knowledge/) | Home facts your agent can recall instantly | Beginner |
| 2 | [Home Maintenance Tracker](extensions/home-maintenance/) | Scheduling and history for home upkeep | Beginner |
| 3 | [Family Calendar](extensions/family-calendar/) | Multi-person schedule coordination | Intermediate |
| 4 | [Meal Planning](extensions/meal-planning/) | Recipes, meal plans, shared grocery lists | Intermediate |
| 5 | [Professional CRM](extensions/professional-crm/) | Contact tracking wired into your thoughts | Intermediate |
| 6 | [Job Hunt Pipeline](extensions/job-hunt/) | Application tracking and interview pipeline | Advanced |

Extensions compound. Your CRM knows about thoughts you've captured. Your meal planner checks who's home this week. Your job hunt contacts automatically become professional network contacts. This is what happens when your agent can see across your whole system.

## Primitives: Concepts That Compound

Some concepts show up in multiple extensions. Learn them once, apply them everywhere.

| Primitive | What It Teaches | Used By |
| --------- | --------------- | ------- |
| [Row Level Security](primitives/rls/) | PostgreSQL policies for multi-user data isolation | Extensions 4, 5, 6 |
| [Shared MCP Server](primitives/shared-mcp/) | Giving others scoped access to parts of your brain | Extension 4 |

## Community Contributions

Beyond the curated learning path, the community builds and shares:

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

- **Extensions** are curated — discuss with maintainers before submitting
- **Primitives** should be referenced by 2+ extensions to justify extraction
- **Recipes, schemas, dashboards, integrations** are open for community contributions
- Every PR runs through an automated review agent that checks 11 rules (file structure, no secrets, SQL safety, primitive dependencies, etc.)
- If the agent passes, a human admin reviews for quality and clarity
- Your contribution needs a README with real instructions and a `metadata.json` with structured info

## Community

- **[Discord](https://discord.gg/Cgh9WJEkeG)** — Real-time help, show-and-tell, contributor discussion
- **[Substack](https://natesnewsletter.substack.com/)** — Updates, deep dives, and the story behind Open Brain

## Who Maintains This

Built by Nate B. Jones's team. Matt Hallett is the first community admin and repo manager. PRs are reviewed by the automated agent + human admins.

## License

[FSL-1.1-MIT](LICENSE.md)
