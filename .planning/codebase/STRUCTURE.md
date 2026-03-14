# Codebase Structure

**Analysis Date:** 2026-03-13

## Directory Layout

```
ob1/
├── .github/                    # GitHub workflows and templates
│   ├── workflows/
│   │   └── ob1-review.yml     # Automated PR review for contributions
│   ├── ISSUE_TEMPLATE/         # Issue templates
│   └── PULL_REQUEST_TEMPLATE/  # PR template
├── .planning/                  # Planning and analysis documents
│   └── codebase/              # Generated architecture docs (ARCHITECTURE.md, STRUCTURE.md, etc.)
├── docs/                       # Setup guides and documentation
│   ├── 01-getting-started.md  # Full setup guide (45 min to working system)
│   ├── 02-companion-prompts.md # AI prompts for migration, discovery, habits
│   ├── 03-faq.md              # FAQ and troubleshooting
│   └── 04-ai-assisted-setup.md # Guide for using AI tools to build
├── extensions/                 # Curated 6-step learning path (⭐ start here)
│   ├── _template/             # Template for new extensions
│   │   └── README.md, index.ts, schema.sql, metadata.json
│   ├── household-knowledge/    # Extension 1: Home facts database
│   ├── home-maintenance/       # Extension 2: Maintenance scheduling
│   ├── family-calendar/        # Extension 3: Multi-person scheduling
│   ├── meal-planning/          # Extension 4: Recipes, meal plans, shopping
│   ├── professional-crm/       # Extension 5: Contact + interaction tracking
│   └── job-hunt/              # Extension 6: Application pipeline
├── primitives/                 # Reusable concept guides (2+ references required)
│   ├── _template/
│   │   └── README.md
│   ├── rls/                    # Row Level Security patterns
│   ├── shared-mcp/             # Shared MCP server with scoped access
│   ├── deploy-edge-function/   # Deploy an Edge Function guide
│   ├── remote-mcp/             # Connect remote MCP to Claude Desktop
│   └── troubleshooting/        # Common errors and fixes
├── recipes/                    # Standalone capability adds (open for contributions)
│   ├── _template/
│   │   └── README.md, metadata.json
│   ├── email-history-import/   # Import Gmail into thoughts
│   ├── chatgpt-conversation-import/ # Import ChatGPT export, distill to thoughts
│   ├── daily-digest/           # Automated summary of recent thoughts
│   ├── panning-for-gold/       # Tools for finding valuable thoughts
│   └── source-filtering/       # Filter search by thought source
├── schemas/                    # Database table extensions (open for contributions)
│   ├── _template/
│   │   └── README.md, metadata.json
│   └── crm-contacts/           # Contacts + interactions tables
├── dashboards/                 # Frontend templates (open for contributions)
│   ├── _template/
│   │   └── README.md, package.json, etc.
│   └── [dashboards hosted on Vercel/Netlify]
├── integrations/               # Capture sources & service bridges (open for contributions)
│   ├── _template/
│   │   └── README.md, metadata.json
│   ├── discord-capture/        # Discord bot for message capture
│   └── slack-capture/          # Slack bot for message capture
├── resources/                  # Pre-built AI assistant companions
│   ├── open-brain-companion.skill    # Claude Skill file
│   ├── open-brain-companion.zip      # Claude Skill archive
│   └── README.md
├── .claude/                    # AI tool configuration
│   └── skills/                 # Claude Code skills for this project
├── .husky/                     # Git hooks
├── .planning/                  # Planning and decisions
├── CLAUDE.md                   # Agent instructions for AI tools
├── CONTRIBUTING.md             # Contribution guidelines
├── CODE_OF_CONDUCT.md          # Community code of conduct
├── CONTRIBUTORS.md             # List of contributors
├── README.md                   # Project overview (START HERE)
├── LICENSE.md                  # FSL-1.1-MIT license
├── SECURITY.md                 # Security policy
└── package.json, tsconfig.json, .gitignore, etc.
```

## Directory Purposes

**`extensions/`:**
- Purpose: Curated, progressive 6-step learning path. Each extension builds on earlier ones, teaching new concepts through practical builds.
- Contains: Database schema (`schema.sql`), MCP server code (`index.ts`), optional shared server code (`shared-server.ts`), comprehensive README, `metadata.json`
- Key files: `extensions/{name}/README.md` (prerequisites, step-by-step instructions, expected outcome), `extensions/{name}/index.ts` (MCP tool definitions), `extensions/{name}/schema.sql` (PostgreSQL DDL)
- Order matters: 1→2→3→4→5→6. Each one references earlier extensions in "Cross-Extension Integration" section

**`primitives/`:**
- Purpose: Reusable concept guides extracted because 2+ extensions need them. Teach a pattern once, link many times.
- Contains: Detailed README guides (200+ words), no code (documentation only)
- Key files: `primitives/{name}/README.md` (when to use, security model, prerequisites, step-by-step, troubleshooting)
- Examples: RLS (used by extensions 4-6), shared-mcp (used by extensions 4+), deploy-edge-function (used by all extensions)

**`recipes/`:**
- Purpose: Standalone capability adds. No ordering, no prerequisites beyond "working Open Brain". Community contributions welcome.
- Contains: Implementation code (Python, TypeScript, SQL, Node.js), comprehensive README, `metadata.json`
- Key files: `recipes/{name}/README.md` (what it does, prerequisites, step-by-step, troubleshooting)
- Examples: `chatgpt-conversation-import/` uses Python to distill ChatGPT conversations into thoughts; `email-history-import/` pulls Gmail into thoughts

**`schemas/`:**
- Purpose: Database table extensions and metadata schemas. Add new tables, don't modify core `thoughts` table.
- Contains: SQL migration files, README with setup steps, `metadata.json`
- Key files: `schemas/{name}/001_create_contacts.sql`, `schemas/{name}/002_create_interactions.sql` (versioned migrations), `schemas/{name}/README.md`
- Examples: `crm-contacts/` adds `contacts` and `contact_interactions` tables linked to thoughts

**`dashboards/`:**
- Purpose: Frontend templates for displaying and interacting with Open Brain data. Deployed on Vercel/Netlify.
- Contains: React/Next.js code, `package.json`, environment configuration, deployment instructions, README
- Key files: `dashboards/{name}/package.json` (dependencies), `dashboards/{name}/README.md` (what it shows, how to deploy)
- Note: Most are placeholders; actual implementations would have `src/`, `public/`, `next.config.js`, etc.

**`integrations/`:**
- Purpose: Capture sources and external service connections. MCP extensions, webhook receivers, bots.
- Contains: Edge Function code, bot code, webhook handlers, README, `metadata.json`
- Key files: `integrations/{name}/README.md` (what it captures, prerequisites, setup)
- Examples: `discord-capture/` is an Edge Function listening for Discord messages; `slack-capture/` is a Slack bot

**`docs/`:**
- Purpose: Setup guides, FAQ, companion prompts, AI-assisted setup.
- Key files:
  - `docs/01-getting-started.md`: Full setup guide (build entire system in 45 min)
  - `docs/02-companion-prompts.md`: AI prompts for migrating memories, discovering use cases, building habits
  - `docs/03-faq.md`: FAQ and common troubleshooting
  - `docs/04-ai-assisted-setup.md`: Guide for using Claude Code / Cursor to build Open Brain

**`resources/`:**
- Purpose: Pre-built AI assistant companions (Claude Skill, ChatGPT Custom GPT, Gemini GEM).
- Key files: `.skill` files and zips (Notion links to hosted companions)

**`.github/`:**
- Purpose: GitHub automation and templates.
- Key files:
  - `workflows/ob1-review.yml`: Automated review agent that checks 11+ rules on every PR
  - `ISSUE_TEMPLATE/`: Issue templates for extensions, primitives, non-technical contributions
  - `PULL_REQUEST_TEMPLATE/`: PR template requiring description format

## Key File Locations

**Entry Points:**
- `README.md` (root): Project overview, getting started, extension learning path
- `docs/01-getting-started.md`: Full setup guide (start here for new users)
- `CONTRIBUTING.md`: Contribution guidelines and PR process
- `CLAUDE.md`: Agent instructions for AI tools (you are here)

**Configuration:**
- `package.json`: Node.js dependencies (minimal; most code is TypeScript/Deno in Edge Functions)
- `.github/metadata.schema.json`: JSON schema validating `metadata.json` format
- `.github/workflows/ob1-review.yml`: Automated PR checks

**Core Logic:**
- `extensions/household-knowledge/index.ts`: Example simple MCP server (start here to understand pattern)
- `extensions/meal-planning/index.ts`: More complex MCP server with shared access
- `extensions/professional-crm/index.ts`: Advanced CRM tools, cross-extension integration
- `recipes/chatgpt-conversation-import/import-chatgpt.py`: Example data import script
- `recipes/source-filtering/backfill-metadata.ts`: Example Deno utility for metadata enrichment

**Database Schemas:**
- `extensions/household-knowledge/schema.sql`: Simple extension with 2 tables (start here)
- `extensions/meal-planning/schema.sql`: More complex with relationships
- `schemas/crm-contacts/001_create_contacts.sql`: Schema-only contribution

**Templates:**
- `extensions/_template/README.md`: Template for new extensions (copy and fill in)
- `primitives/_template/README.md`: Template for new primitives
- `recipes/_template/README.md`: Template for new recipes
- `schemas/_template/README.md`: Template for new schemas

## Naming Conventions

**Files:**
- `README.md`: Standard in every contribution folder
- `metadata.json`: Structured metadata (name, author, version, tags, difficulty, time)
- `schema.sql`: Database DDL for extensions/schemas
- `index.ts`: MCP server code (Hono + @modelcontextprotocol/sdk)
- `shared-server.ts`: Optional shared MCP server for multi-user access (meal-planning example)
- `*.py`: Python scripts for data import (Python 3.10+)
- Documentation: Numbered guide files (`01-getting-started.md`, `02-companion-prompts.md`)

**Directories:**
- `{category}/{contribution-name}/`: Kebab-case names for contribution folders (e.g., `recipes/email-history-import/`)
- `_template/`: Template folder in each category (not a real contribution, just a starting point)

**Functions/Tools in MCP Servers:**
- Snake_case: `add_household_item`, `search_recipes`, `add_professional_contact`, `search_thoughts`
- Verb-first: `add_`, `search_`, `list_`, `update_`, `delete_`
- Domain-specific prefix: `add_recipe` (meal-planning), `add_contact` (professional-crm), `add_household_item` (household-knowledge)

**Database Tables:**
- Snake_case: `household_items`, `household_vendors`, `recipes`, `meal_plans`, `contacts`, `contact_interactions`
- User-scoped: Most tables have `user_id UUID REFERENCES auth.users(id)` for RLS
- Timestamps: `created_at TIMESTAMPTZ DEFAULT now()` and optionally `updated_at TIMESTAMPTZ DEFAULT now()`
- Metadata: Flexible `JSONB` columns for unstructured fields (e.g., `details JSONB`, `metadata JSONB`)

**Environment Variables:**
- `SUPABASE_URL`: Project URL (e.g., `https://xxx.supabase.co`)
- `SUPABASE_SERVICE_ROLE_KEY`: For server-to-server auth (never expose to client)
- `SUPABASE_ANON_KEY`: For client-side, RLS-scoped access (public)
- `MCP_ACCESS_KEY`: Random string for authenticating MCP endpoint
- `OPENROUTER_API_KEY`: For LLM embeddings and metadata extraction
- External service tokens: `SLACK_BOT_TOKEN`, `DISCORD_BOT_TOKEN`, `GMAIL_API_KEY`, etc.

## Where to Add New Code

**New Extension (curated, requires discussion):**
- Primary code: `extensions/{name}/index.ts` (MCP server)
- Database schema: `extensions/{name}/schema.sql`
- Optional shared access: `extensions/{name}/shared-server.ts`
- Documentation: `extensions/{name}/README.md` (450+ words with learning path table, cross-extension integration, next steps)
- Metadata: `extensions/{name}/metadata.json` (with `learning_order`, `requires_primitives`)
- Process: Open an issue first to discuss placement in learning path

**New Primitive (reused by 2+ extensions):**
- Documentation: `primitives/{name}/README.md` (200+ words, when to use, prerequisites, step-by-step, troubleshooting)
- Metadata: `primitives/{name}/metadata.json`
- Code: None (primitives are pure guides; code lives in extensions that use them)
- Reference: Add `requires_primitives: ["name"]` to extension `metadata.json` and link in README

**New Recipe (open for community):**
- Implementation: `recipes/{name}/` with code (Python, TypeScript, SQL, Node.js)
- Documentation: `recipes/{name}/README.md` (prerequisites, step-by-step, troubleshooting, expected outcome)
- Metadata: `recipes/{name}/metadata.json`
- PR: Submit with `[recipes]` title prefix, PR must pass automated checks

**New Schema (open for community):**
- SQL: `schemas/{name}/001_create_table.sql`, `002_add_column.sql` (versioned)
- Documentation: `schemas/{name}/README.md` (what tables it adds, prerequisites, troubleshooting)
- Metadata: `schemas/{name}/metadata.json`
- PR: Submit with `[schemas]` title prefix

**New Dashboard (open for community):**
- Frontend: `dashboards/{name}/` (React/Next.js or plain HTML)
- Package: `dashboards/{name}/package.json` with dependencies
- Documentation: `dashboards/{name}/README.md` (what it displays, how to deploy)
- Metadata: `dashboards/{name}/metadata.json`
- PR: Submit with `[dashboards]` title prefix

**New Integration (open for community):**
- Code: `integrations/{name}/` (Edge Function, bot, webhook handler)
- Documentation: `integrations/{name}/README.md` (what it captures, prerequisites, setup)
- Metadata: `integrations/{name}/metadata.json`
- PR: Submit with `[integrations]` title prefix

**Shared Utilities:**
- Currently no shared code library (each extension/recipe is self-contained)
- If you find yourself duplicating code, propose extracting it as a primitive

## Special Directories

**`_template/`:**
- Purpose: Template starting point for new contributions (exists in each category)
- Generated: No (committed to repo)
- Committed: Yes (part of the repo structure)
- Usage: Copy folder, rename it, fill in the README and code

**`.planning/codebase/`:**
- Purpose: Architecture and structure analysis documents generated by GSD mapping tool
- Generated: Yes (by `/gsd:map-codebase` command)
- Committed: Yes (checked into repo for reference)
- Contains: `ARCHITECTURE.md`, `STRUCTURE.md`, `CONVENTIONS.md`, `TESTING.md`, `STACK.md`, `INTEGRATIONS.md`, `CONCERNS.md`

**`.github/workflows/`:**
- Purpose: GitHub Actions automation
- Key: `ob1-review.yml` runs on every PR to check 11+ rules (folder structure, metadata, no secrets, SQL safety, primitive references, etc.)
- Generated: No (manually written)
- Committed: Yes

**`.claude/skills/`:**
- Purpose: Claude Code skills for this project (enhance AI assistant knowledge)
- Generated: No (manually written)
- Committed: Yes (patterns and utilities for building in this project)

**`.husky/`:**
- Purpose: Git hooks (e.g., pre-commit linting)
- Generated: No (setup via `husky install`)
- Committed: Yes (hook scripts)

## Contribution File Structure Rules

Every contribution must follow this structure:

```
{category}/{contribution-name}/
├── README.md              # REQUIRED (400+ words for extensions/recipes)
├── metadata.json          # REQUIRED (structured metadata)
├── [your code files]      # REQUIRED (varies by category)
└── [optional extras]      # Optional (examples, tests, data files)
```

**Automated checks verify:**
1. Contribution is in the correct category directory
2. Both `README.md` and `metadata.json` exist
3. `metadata.json` is valid JSON with all required fields
4. No credentials, API keys, or secrets in any file
5. No dangerous SQL (`DROP TABLE`, `TRUNCATE`, unqualified `DELETE FROM`)
6. No modifications to core `thoughts` table structure
7. Category-specific artifacts present (extensions have schema.sql + index.ts, recipes have code, etc.)
8. PR title starts with `[category]`
9. No binary files over 1MB
10. README includes Prerequisites, step-by-step instructions, expected outcome
11. If `requires_primitives` is declared, those primitives exist and are linked in README

---

*Structure analysis: 2026-03-13*
