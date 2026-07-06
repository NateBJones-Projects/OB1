<p align="center">
  <img src=".github/ob1-logo-wide.png" alt="Open Brain" width="600">
</p>

<h1 align="center">Open Brain</h1>

The infrastructure layer for your thinking. One database, one AI gateway, one chat channel. Any AI you use can plug in. No middleware, no SaaS chains, no Zapier.

This isn't a notes app. It's a database with vector search and an open protocol — built so that every AI tool you use shares the same persistent memory of you. Claude, ChatGPT, Cursor, Claude Code, whatever ships next month. One brain. All of them.

> Open Brain was created by [Nate B. Jones](https://natesnewsletter.substack.com/). Follow the [Substack](https://natesnewsletter.substack.com/) for updates, discussion, and the companion prompt pack. Join the [Discord](https://discord.gg/Cgh9WJEkeG) for real-time help and community.

## Getting Started

Never built an Open Brain? Start here:

1. **[Setup Guide](docs/01-getting-started.md)** — Build the full system (database, AI gateway, Slack capture, MCP server) in about 45 minutes. No coding experience needed. Or watch the [video walkthrough](https://vimeo.com/1174979042/f883f6489a) (~27 min).
2. **[AI-Assisted Setup](docs/04-ai-assisted-setup.md)** — Prefer building with Cursor, Claude Code, or another AI coding tool? Point it at this repo and go. Same system, different workflow.
3. **[Companion Prompts](docs/02-companion-prompts.md)** — Five prompts that help you migrate your memories, discover use cases, and build the capture habit.
4. **Then pick Extension 1** and start building.

**If you hit a wall:** We built a [FAQ](docs/03-faq.md) that covers the most common questions and gotchas. And if you need real-time help, we created dedicated AI assistants that know this system inside and out: a [Claude Skill](https://www.notion.so/product-templates/Open-Brain-Companion-Claude-Skill-31a5a2ccb526802797caeb37df3ba3cb?source=copy_link), a [ChatGPT Custom GPT](https://chatgpt.com/g/g-69a892b6a7708191b00e48ff655d5597-nate-jones-open-brain-assistant), and a [Gemini GEM](https://gemini.google.com/gem/1fDsAENjhdku-3RufY7ystbS1Md8MtDCg?usp=sharing). Use whichever one matches the AI tool you already use.

## Recent Contributions

The 20 most recent merged PRs. This list is generated from GitHub and refreshes daily. Last updated: 2026-05-22.

<!-- recent-contributions:start -->

| Contribution | What changed | Creator |
| ------------ | ------------ | ------- |
| [Provenance chains — derivation tracking](recipes/provenance-chains/) | Provenance chains — derivation tracking. | [@alanshurafa](https://github.com/alanshurafa) |
| [Open Brain Dashboard Pro — Next.js 16 + iron-session](dashboards/open-brain-dashboard-pro/) | Open Brain Dashboard Pro — Next.js 16 + iron-session. | [@alanshurafa](https://github.com/alanshurafa) |
| [Atomizer — generic + Gmail re-atomization toolkit](recipes/atomizer/) | Atomizer — generic + Gmail re-atomization toolkit. | [@alanshurafa](https://github.com/alanshurafa) |
| [Brain smoke test — install verification harness](recipes/brain-smoke-test/) | Brain smoke test — install verification harness. | [@alanshurafa](https://github.com/alanshurafa) |
| [CRM improvements: crm_ prefix, FTS search, meeting prep, stale detection](extensions/professional-crm/) | CRM improvements: crm_ prefix, FTS search, meeting prep, stale detection. | [@pintomatic](https://github.com/pintomatic) |
| [Edge function cost optimization — 73% invocation reduction](recipes/edge-function-cost-optimization/) | Edge function cost optimization — 73% invocation reduction. | [@JustinTSmith](https://github.com/JustinTSmith) |
| [Obsidian-vault-import: --source-label to override metadata.source](recipes/obsidian-vault-import/) | Obsidian-vault-import: --source-label to override metadata.source. | [@dhanjit](https://github.com/dhanjit) |
| [Preserve full frontmatter in obsidian-vault-import metadata](recipes/obsidian-vault-import/) | Preserves full frontmatter in obsidian-vault-import metadata. | [@dhanjit](https://github.com/dhanjit) |
| [Load .env into wiki-compiler child processes](recipes/wiki-compiler/) | Loads .env into wiki-compiler child processes. | [@mlava](https://github.com/mlava) |
| [Enable standalone output for Docker builds](dashboards/open-brain-dashboard-next/) | Enables standalone output for Docker builds. | [@Mavrick-F](https://github.com/Mavrick-F) |
| [Fix outdated primitives section in README](README.md) | Fixes outdated primitives section in README. | [@jjshanks](https://github.com/jjshanks) |
| [Document Edge Function redeploy step in OpenRouter rotation FAQ](docs/03-faq.md) | Documents Edge Function redeploy step in OpenRouter rotation FAQ. | [@Silverhawk-bit](https://github.com/Silverhawk-bit) |
| [Return JSON-RPC error envelopes on auth failure](server/index.ts) | Returns JSON-RPC error envelopes on auth failure. | [@txcfi-scott](https://github.com/txcfi-scott) |
| [Markdownlint sweep for existing recipe/schema docs](schemas/workflow-status/) | Markdownlint sweep for existing recipe/schema docs. | [@alanshurafa](https://github.com/alanshurafa) |
| [Improve ChatGPT MCP compatibility](primitives/remote-mcp/) | Improves ChatGPT MCP compatibility. | [@justfinethanku](https://github.com/justfinethanku) |
| [Add wiki compiler orchestration recipe](recipes/wiki-compiler/) | Adds wiki compiler orchestration recipe. | [@justfinethanku](https://github.com/justfinethanku) |
| [Wiki synthesis + autobiography pipeline](recipes/wiki-synthesis/) | Wiki synthesis + autobiography pipeline. | [@alanshurafa](https://github.com/alanshurafa) |
| [Entity wiki pages from knowledge graph](recipes/entity-wiki/) | Entity wiki pages from knowledge graph. | [@alanshurafa](https://github.com/alanshurafa) |
| [Typed reasoning edges + Opus/Haiku classifier](schemas/typed-reasoning-edges/) | Typed reasoning edges + Opus/Haiku classifier. | [@alanshurafa](https://github.com/alanshurafa) |
| [Entity extraction worker](integrations/entity-extraction-worker/) | Entity extraction worker. | [@alanshurafa](https://github.com/alanshurafa) |

<!-- recent-contributions:end -->

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
| [Deploy an Edge Function](primitives/deploy-edge-function/) | Deploying any extension as a Supabase Edge Function | All extensions |
| [Remote MCP Connection](primitives/remote-mcp/) | Connecting to Claude Desktop, ChatGPT, Claude Code, Cursor, and other clients | All extensions |
| [Common Troubleshooting](primitives/troubleshooting/) | Solutions for connection, deployment, and database issues | All extensions |
| [Row Level Security](primitives/rls/) | PostgreSQL policies for multi-user data isolation | Extensions 4, 5, 6 |
| [Shared MCP Server](primitives/shared-mcp/) | Giving others scoped access to parts of your brain | Extension 4 |

## Community Contributions

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
| [Aiception (formerly Claudeception)](recipes/claudeception/) | Self-improving system that creates new skills from work sessions — skills that create other skills | [@jaredirish](https://github.com/jaredirish) |
| [Schema-Aware Routing](recipes/schema-aware-routing/) | LLM-powered routing that distributes unstructured text across multiple database tables | [@claydunker-yalc](https://github.com/claydunker-yalc) |
| [Fingerprint Dedup Backfill](recipes/fingerprint-dedup-backfill/) | Backfill content fingerprints and safely remove duplicate thoughts | [@alanshurafa](https://github.com/alanshurafa) |
| [Source Filtering](recipes/source-filtering/) | Filter thoughts by source and backfill missing metadata for early imports | [@matthallett1](https://github.com/matthallett1) |
| [Life Engine](recipes/life-engine/) | Self-improving personal assistant — calendar, habits, health, proactive briefings via Telegram or Discord | [@justfinethanku](https://github.com/justfinethanku) |
| [Life Engine Video](recipes/life-engine-video/) | Add-on that renders Life Engine briefings as short animated videos with voiceover | [@justfinethanku](https://github.com/justfinethanku) |
| [Daily Digest](recipes/daily-digest/) | Automated daily summary of recent thoughts delivered via email or Slack | OB1 Team |
| [Bring Your Own Context](recipes/bring-your-own-context/) | Portable context workflow that packages extraction prompts, profile generation, and remote MCP deployment into one entrypoint | [@jonathanedwards](https://github.com/jonathanedwards) |
| [Work Operating Model Activation](recipes/work-operating-model-activation/) | Conversation-first workflow that turns tacit work patterns into structured Open Brain records and agent-ready operating files | [@jonathanedwards](https://github.com/jonathanedwards) |
| [World Model Diagnostic Activation](recipes/world-model-diagnostic-activation/) | Ship-now activation path for a 20-minute world-model readiness diagnostic that compounds through core Open Brain capture | [@jonathanedwards](https://github.com/jonathanedwards) |
| [Research-to-Decision Workflow](recipes/research-to-decision-workflow/) | Composition recipe that chains canonical skills into operator and investor research, synthesis, meeting, and memo workflows | [@NateBJones](https://github.com/NateBJones) |
| [OpenClaw Agent Memory for OB1](recipes/openclaw-agent-memory/) | Canonical recipe for using OB1 Agent Memory as the governed continuity layer for OpenClaw workflows | OB1 Team |
| [OpenClaw Code Review Memory](recipes/openclaw-code-review-memory/) | Flagship workflow for compounding repo-specific review lessons, maintainer corrections, and false positives | OB1 Team |
| [OpenClaw TaskFlow Work Log](recipes/openclaw-taskflow-work-log/) | Durable handoff recipe for long-running OpenClaw TaskFlows across agents, models, and channels | OB1 Team |

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
| [Aiception Skill Pack (formerly Claudeception)](skills/claudeception/) | Extracts reusable lessons from work sessions into new skills | [@jaredirish](https://github.com/jaredirish) |
| [Work Operating Model Skill Pack](skills/work-operating-model/) | Runs a five-layer elicitation interview and saves the approved operating model into Open Brain | [@jonathanedwards](https://github.com/jonathanedwards) |
| [World Model Readiness Diagnostic](skills/world-model-diagnostic/) | Runs a 20-minute world-model diagnostic that maps paradigm fit, audits the boundary layer, and labels findings by confidence | [@jonathanedwards](https://github.com/jonathanedwards) |
| [OpenClaw Agent Memory Skill Pack](skills/openclaw-agent-memory/) | Teaches OpenClaw agents to recall, write back, report usage, and respect OB1 provenance/use-policy rules | OB1 Team |

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
| [Agent Memory API](integrations/agent-memory-api/) | Runtime-neutral recall, write-back, review, inspector, and recall-trace API for OB1 Agent Memory | OB1 Team |
| [OpenClaw Agent Memory](integrations/openclaw-agent-memory/) | OpenClaw plugin and publishing package for using OB1 Agent Memory from OpenClaw workflows | OB1 Team |
| [Slack Capture](integrations/slack-capture/) | Quick-capture thoughts via Slack messages with auto-embedding and classification | Core |
| [Discord Capture](integrations/discord-capture/) | Discord bot that captures messages into Open Brain, mirroring the Slack pattern | Core |

### [`/schemas`](schemas/) — Database Extensions

Tables and sidecars that extend the base `thoughts` model without replacing it.

| Schema | What It Does | Contributor |
| ------ | ------------ | ----------- |
| [Agent Memory](schemas/agent-memory/) | Provenance, review, use-policy, source-reference, relation, recall-trace, and audit sidecars for agent workflow memory | OB1 Team |

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
- If the agent passes, a human maintainer reviews for quality and clarity
- Your contribution needs a README with real instructions and a `metadata.json` with structured info

## Community

- **[Discord](https://discord.gg/Cgh9WJEkeG)** — Real-time help, show-and-tell, contributor discussion
- **[Substack](https://natesnewsletter.substack.com/)** — Updates, deep dives, and the story behind Open Brain

## Who Maintains This

Created by [Nate B. Jones](https://github.com/NateBJones).

The OB1 repo team: [Jonathan Edwards](https://github.com/justfinethanku), Repo Manager; [Matt Hallett](https://github.com/matthallett1), Community Admin; [Alan Shurafa](https://github.com/alanshurafa), Community Maintainer. PRs are reviewed by the automated agent + human maintainers.

## License

[FSL-1.1-MIT](LICENSE.md)
