<p align="center">
  <img src=".github/ob1-logo-wide.png" alt="Open Brain" width="600">
</p>

<h1 align="center">Open Brain</h1>

The infrastructure layer for your thinking. One database, one AI gateway, one chat channel. Any AI you use can plug in. No middleware, no SaaS chains, no Zapier.

This isn't a notes app. It's a database with vector search and an open protocol — built so that every AI tool you use shares the same persistent memory of you. Claude, ChatGPT, Cursor, Claude Code, whatever ships next month. One brain. All of them.

> Open Brain was created by [Nate B. Jones](https://natesnewsletter.substack.com/). Follow the [Substack](https://natesnewsletter.substack.com/) for updates, discussion, and the companion prompt pack. Join the [Discord](https://discord.gg/Cgh9WJEkeG) for real-time help and community.

https://github.com/user-attachments/assets/80a79b09-f323-42c6-b11b-de10bb6fa36f

## Getting Started

https://github.com/user-attachments/assets/85208d73-112b-4204-82fd-d03b6c397a8b

Never built an Open Brain? Start here:

1. **[Setup Guide](docs/01-getting-started.md)** — Build the full system (database, AI gateway, Slack capture, MCP server) in about 45 minutes. No coding experience needed. Or watch the [video walkthrough](https://vimeo.com/1174979042/f883f6489a) (~27 min).
2. **[AI-Assisted Setup](docs/04-ai-assisted-setup.md)** — Prefer building with Cursor, Claude Code, or another AI coding tool? Point it at this repo and go. Same system, different workflow.
3. **[Companion Prompts](docs/02-companion-prompts.md)** — Five prompts that help you migrate your memories, discover use cases, and build the capture habit.
4. **Then pick Extension 1** and start building.

**If you hit a wall:** We built a [FAQ](docs/03-faq.md) that covers the most common questions and gotchas. And if you need real-time help, we created dedicated AI assistants that know this system inside and out: a [Claude Skill](https://www.notion.so/product-templates/Open-Brain-Companion-Claude-Skill-31a5a2ccb526802797caeb37df3ba3cb?source=copy_link), a [ChatGPT Custom GPT](https://chatgpt.com/g/g-69a892b6a7708191b00e48ff655d5597-nate-jones-open-brain-assistant), and a [Gemini GEM](https://gemini.google.com/gem/1fDsAENjhdku-3RufY7ystbS1Md8MtDCg?usp=sharing). Use whichever one matches the AI tool you already use.

## Extensions — The Learning Path

https://github.com/user-attachments/assets/cc477f00-bb6b-4f96-9f7d-a6bcd0cf8b60

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

https://github.com/user-attachments/assets/f488e495-fe2a-4ccc-a834-fc6ab5a0ed41

Some concepts show up in multiple extensions. Learn them once, apply them everywhere.

| Primitive | What It Teaches | Used By |
| --------- | --------------- | ------- |
| [Row Level Security](primitives/rls/) | PostgreSQL policies for multi-user data isolation | Extensions 4, 5, 6 |
| [Shared MCP Server](primitives/shared-mcp/) | Giving others scoped access to parts of your brain | Extension 4 |

## Community Contributions

https://github.com/user-attachments/assets/9454662f-2648-4928-8723-f7d52e94e9b8

Beyond the curated learning path, the community builds and shares real tools that real people use. Every contribution below was reviewed, approved, and merged by the maintainer team. Look for the **Community Contribution** badge in each README.

### [`/recipes`](recipes/) — Import Your Data

Pull your digital life into Open Brain. Each recipe handles a specific data source — parsing, deduplication, embedding, and ingestion included.

| Recipe | What It Does | Contributor |
| ------ | ------------ | ----------- |
| [ChatGPT Import](recipes/chatgpt-conversation-import/) | Parse ChatGPT data exports, filter trivial conversations, summarize via LLM | [@matthallett1](https://github.com/matthallett1) |
| [Perplexity Import](recipes/perplexity-conversation-import/) | Import Perplexity AI search history and memory entries | [@demarant](https://github.com/demarant) |
| [Obsidian Vault Import](recipes/obsidian-vault-import/) | Parse and import Obsidian vault notes with full metadata | [@snapsynapse](https://github.com/snapsynapse) |
| [X/Twitter Import](recipes/x-twitter-import/) | Import tweets, DMs, and Grok chats from X data exports | [@alanshurafa](https://github.com/alanshurafa) |
| [Instagram Import](recipes/instagram-import/) | Import DMs, comments, and captions from Instagram exports | [@alanshurafa](https://github.com/alanshurafa) |
| [Google Activity Import](recipes/google-activity-import/) | Import Google Search, Gmail, Maps, YouTube, Chrome history from Takeout | [@alanshurafa](https://github.com/alanshurafa) |
| [Grok (xAI) Import](recipes/grok-export-import/) | Import Grok conversation exports with MongoDB-style date handling | [@alanshurafa](https://github.com/alanshurafa) |
| [Journals/Blogger Import](recipes/journals-blogger-import/) | Import Atom XML blog archives from Blogger/Journals | [@alanshurafa](https://github.com/alanshurafa) |
| [Email History Import](recipes/email-history-import/) | Pull your Gmail archive into searchable thoughts | [@matthallett1](https://github.com/matthallett1) |

### [`/recipes`](recipes/) — Tools & Workflows

Standalone capabilities that make your Open Brain smarter.

| Recipe | What It Does | Contributor |
| ------ | ------------ | ----------- |
| [Auto-Capture Protocol](recipes/auto-capture/) | Stores ACT NOW items and session summaries in Open Brain at session close using the reusable Auto-Capture skill | [@jaredirish](https://github.com/jaredirish) |
| [Panning for Gold](recipes/panning-for-gold/) | Mine brain dumps and voice transcripts for actionable ideas — battle-tested across 13+ sessions | [@jaredirish](https://github.com/jaredirish) |
| [Claudeception](recipes/claudeception/) | Self-improving system that creates new skills from work sessions — skills that create other skills | [@jaredirish](https://github.com/jaredirish) |
| [Schema-Aware Routing](recipes/schema-aware-routing/) | LLM-powered routing that distributes unstructured text across multiple database tables | [@claydunker-yalc](https://github.com/claydunker-yalc) |
| [Fingerprint Dedup Backfill](recipes/fingerprint-dedup-backfill/) | Backfill content fingerprints and safely remove duplicate thoughts | [@alanshurafa](https://github.com/alanshurafa) |
| [Source Filtering](recipes/source-filtering/) | Filter thoughts by source and backfill missing metadata for early imports | [@matthallett1](https://github.com/matthallett1) |
| [Life Engine](recipes/life-engine/) | Self-improving personal assistant — calendar, habits, health, proactive briefings via Telegram or Discord | [@justfinethanku](https://github.com/justfinethanku) |
| [Life Engine Video](recipes/life-engine-video/) | Add-on that renders Life Engine briefings as short animated videos with voiceover | [@justfinethanku](https://github.com/justfinethanku) |
| [Daily Digest](recipes/daily-digest/) | Automated daily summary of recent thoughts delivered via email or Slack | OB1 Team |
| [Research-to-Decision Workflow](recipes/research-to-decision-workflow/) | Composition recipe that chains canonical skills into operator and investor research, synthesis, meeting, and memo workflows | [@NateBJones](https://github.com/NateBJones) |

### [`/skills`](skills/) — Agent Skills

Plain-text skill packs you can drop into Claude Code, Codex, or other AI clients that support reusable prompts/rules. These are the canonical reusable building blocks that recipes and other contributions can depend on.

| Skill | What It Does | Contributor |
| ----- | ------------ | ----------- |
| [Auto-Capture Skill Pack](skills/auto-capture/) | Captures ACT NOW items and session summaries to Open Brain when a session ends | [@jaredirish](https://github.com/jaredirish) |
| [Competitive Analysis Skill Pack](skills/competitive-analysis/) | Builds competitor briefs, pricing comparisons, market maps, and strategic recommendations | [@NateBJones](https://github.com/NateBJones) |
| [Financial Model Review Skill Pack](skills/financial-model-review/) | Reviews an existing model for assumption quality, structural risk, and scenario gaps | [@NateBJones](https://github.com/NateBJones) |
| [Deal Memo Drafting Skill Pack](skills/deal-memo-drafting/) | Turns existing diligence materials into structured deal, IC, or partnership memos | [@NateBJones](https://github.com/NateBJones) |
| [Research Synthesis Skill Pack](skills/research-synthesis/) | Synthesizes source sets into findings, contradictions, confidence markers, and next questions | [@NateBJones](https://github.com/NateBJones) |
| [Meeting Synthesis Skill Pack](skills/meeting-synthesis/) | Converts meeting notes or transcripts into decisions, action items, risks, and follow-up artifacts | [@NateBJones](https://github.com/NateBJones) |
| [Panning for Gold Skill Pack](skills/panning-for-gold/) | Turns brain dumps and transcripts into evaluated idea inventories | [@jaredirish](https://github.com/jaredirish) |
| [Claudeception Skill Pack](skills/claudeception/) | Extracts reusable lessons from work sessions into new skills | [@jaredirish](https://github.com/jaredirish) |

### [`/dashboards`](dashboards/) — Frontend Templates

Host on Vercel or Netlify, pointed at your Supabase backend. Two community-built options — pick the framework you prefer.

| Dashboard | What It Does | Contributor |
| --------- | ------------ | ----------- |
| [Open Brain Dashboard](dashboards/open-brain-dashboard/) | SvelteKit dashboard with MCP proxy and Supabase auth | [@headcrest](https://github.com/headcrest) |
| [Open Brain Dashboard (Next.js)](dashboards/open-brain-dashboard-next/) | Full-featured Next.js dashboard — 8 pages, dark theme, smart ingest, quality auditing | [@alanshurafa](https://github.com/alanshurafa) |

### [`/integrations`](integrations/) — New Connections

MCP server extensions, alternative deployment targets, and capture sources beyond Slack.

| Integration | What It Does | Contributor |
| ----------- | ------------ | ----------- |
| [Kubernetes Deployment](integrations/kubernetes-deployment/) | Fully self-hosted K8s deployment with PostgreSQL + pgvector — no Supabase required | [@velo](https://github.com/velo) |
| [Slack Capture](integrations/slack-capture/) | Quick-capture thoughts via Slack messages with auto-embedding and classification | Core |
| [Discord Capture](integrations/discord-capture/) | Discord bot that captures messages into Open Brain, mirroring the Slack pattern | Core |

### [`/primitives`](primitives/) — Reusable Patterns

| Primitive | What It Does | Contributor |
| --------- | ------------ | ----------- |
| [Content Fingerprint Dedup](primitives/content-fingerprint-dedup/) | SHA-256 deduplication for thought ingestion — prevents duplicates across all import recipes | [@alanshurafa](https://github.com/alanshurafa) |

## Using a Contribution

1. Browse the category tables above or the folders in the repo
2. Open the contribution's folder and read the README
3. Every README has prerequisites, step-by-step instructions, expected outcomes, and troubleshooting
4. Most contributions involve running SQL, deploying an edge function, or hosting frontend code — the README tells you exactly what to do

## Contributing

Read [CONTRIBUTING.md](CONTRIBUTING.md) for the full details. The short version:

- **Extensions** are curated — discuss with maintainers before submitting
- **Primitives** should be referenced by 2+ extensions to justify extraction
- **Recipes, schemas, dashboards, integrations, and skills** are open for community contributions
- Every PR runs through an automated review agent that checks structure, secrets, SQL safety, dependencies, and documentation quality
- If the agent passes, a human admin reviews for quality and clarity
- Your contribution needs a README with real instructions and a `metadata.json` with structured info

## Community

- **[Discord](https://discord.gg/Cgh9WJEkeG)** — Real-time help, show-and-tell, contributor discussion
- **[Substack](https://natesnewsletter.substack.com/)** — Updates, deep dives, and the story behind Open Brain

## Who Maintains This

Built by Nate B. Jones's team. Matt Hallett is the first community admin and repo manager. PRs are reviewed by the automated agent + human admins.

## License

[FSL-1.1-MIT](LICENSE.md)
