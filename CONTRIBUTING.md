# Contributing to OB1

## Before You Contribute

Read **[SOUL.md](SOUL.md)** first — it defines what Open Brain is, what belongs here, and what doesn't. Every PR and issue gets an automated alignment check against this document.

You need a working Open Brain setup. If you haven't built one yet, start with the [Open Brain guide](docs/01-getting-started.md). Every contribution you submit should be tested against your own instance first — don't submit something you haven't run yourself.

## Not a Developer? You Can Still Contribute.

You don't need to write code to contribute to Open Brain. If you have a workflow, a use case, or an idea — that's a contribution. Here's how it works:

1. **Open a [Non-Technical Contribution](../../issues/new?template=non-technical-contribution.yml) issue.** Describe your idea, workflow, or knowledge in plain language. Screenshots and examples help.
2. **A community mentor picks it up.** They'll work with you to shape your idea into a contribution — writing the code, structuring the README, filling in the metadata.
3. **You get full credit.** Your name goes in the `author` field of `metadata.json` and in CONTRIBUTORS.md. The mentor is credited as a co-author in the PR.

This is a first-class path, not a workaround. Some of the best contributions come from people who use Open Brain daily but don't code. You can also post ideas in the `#non-dev-contributions` channel on [Discord](https://discord.gg/Cgh9WJEkeG).

**Other ways to contribute without code:**
- Report bugs or unclear documentation
- Suggest improvements to existing contributions
- Test someone else's recipe and confirm it works (or report what broke)
- Share use cases that could become future contributions

## What Goes Where

| Category | What belongs here | Examples | Open or Curated? |
| -------- | ----------------- | -------- | ---------------- |
| `extensions/` | Progressive builds that replace SaaS tools with agent-powered infrastructure | Household Knowledge Base, Meal Planning, Professional CRM | **Curated** — discuss with maintainers first |
| `primitives/` | Reusable concept guides referenced by multiple extensions | Row Level Security, Shared MCP Server | **Curated** — must be used by 2+ extensions |
| `recipes/` | Step-by-step builds that add a new capability | Email import, ChatGPT import, daily digest, new capture workflows | Open |
| `schemas/` | Database table extensions and metadata schemas | CRM contacts table, taste tracker, reading list schema | Open |
| `dashboards/` | Frontend templates for Vercel/Netlify hosting | Knowledge dashboard, weekly review, mobile capture UI | Open |
| `integrations/` | MCP extensions, webhooks, capture sources | Discord bot, email handler, browser extension, calendar sync | Open |

### Extensions vs Primitives vs Recipes

- **Extensions** are curated, ordered builds that form a progressive learning path. Each teaches new concepts through practical use. They include database schemas, MCP server code, and step-by-step instructions. If you want to propose a new extension, [open an issue](../../issues/new?template=extension-submission.yml) first.
- **Primitives** are reusable concept guides that get referenced by multiple extensions. They teach a pattern (like RLS or shared access) once, so extensions can link to them instead of re-explaining. A primitive should be referenced by at least 2 extensions. [Propose one here](../../issues/new?template=primitive-submission.yml).
- **Recipes** are standalone builds — they add a capability without being part of the learning path. No ordering, no prerequisites beyond a working Open Brain. Open for community contributions.

Not sure where yours fits? Open a discussion issue first.

## Required Files

Every contribution lives in its own subfolder under the right category (e.g., `recipes/my-cool-recipe/`) and must include:

- **`README.md`** — What it does, prerequisites, step-by-step setup, expected outcome, troubleshooting
- **`metadata.json`** — Structured metadata (see template below)
- **Your actual code** — SQL files, edge function code, frontend code, config files, whatever it takes
- **NO credentials, API keys, or secrets.** The automated review will reject them. Use environment variables and document what the user needs to set.

## README Standards

Your contribution's README must include these sections:

1. **What it does** — 1-2 sentences. What capability does this add to Open Brain?
2. **Prerequisites** — What the user needs before starting (e.g., "Working Open Brain setup," "OpenRouter API key," "Node.js 18+")
3. **Step-by-step instructions** — Numbered steps, copy-paste ready where possible. Don't skip steps. Don't assume knowledge that isn't in the prerequisites.
4. **Expected outcome** — What should the user see when it's working? Be specific.
5. **Troubleshooting** — At least 2-3 common issues and how to fix them.

**Extensions** additionally require:
- **"Why This Matters"** section leading with the human pain point
- **"Learning Path"** table showing position in the 6-extension sequence
- **"What You'll Learn"** listing new concepts introduced
- **"Cross-Extension Integration"** prominently documenting connections to other extensions
- **"Next Steps"** linking to the next extension

**Primitives** additionally require:
- **"Extensions That Use This"** section listing which extensions reference this primitive

Check the `_template/` folder in each category for a starter README.

## metadata.json

Every contribution needs a `metadata.json` file. Here's the template:

```json
{
  "name": "Email History Import",
  "description": "Import your Gmail email history into Open Brain as searchable thoughts with sender, subject, and date metadata.",
  "category": "recipes",
  "author": {
    "name": "Matt Hallett",
    "github": "matthallett"
  },
  "version": "1.0.0",
  "requires": {
    "open_brain": true,
    "services": ["Gmail API"],
    "tools": ["Node.js 18+"]
  },
  "tags": ["email", "gmail", "import", "history"],
  "difficulty": "intermediate",
  "estimated_time": "30 minutes",
  "created": "2026-03-10",
  "updated": "2026-03-10"
}
```

**Required fields:** `name`, `description`, `category`, `author` (with `name`), `version`, `requires.open_brain` (must be `true`), `tags` (at least 1), `difficulty` (one of: `beginner`, `intermediate`, `advanced`), `estimated_time`

**Optional fields:** `author.github`, `requires.services`, `requires.tools`, `created`, `updated`

**Extension/primitive-specific fields:**
- `requires_primitives` — array of primitive slugs this contribution depends on (e.g., `["rls", "shared-mcp"]`)
- `learning_order` — integer position in the extension learning path (1-6)

Example for an extension:

```json
{
  "name": "Meal Planning",
  "description": "Recipes, weekly meal plans, and shared shopping lists with RLS and a dedicated shared MCP server.",
  "category": "extensions",
  "author": {
    "name": "Nate B. Jones",
    "github": "NateBJones"
  },
  "version": "1.0.0",
  "requires": {
    "open_brain": true,
    "services": [],
    "tools": ["Node.js 18+"]
  },
  "requires_primitives": ["rls", "shared-mcp"],
  "learning_order": 4,
  "tags": ["meal-planning", "recipes", "shopping", "sharing", "rls"],
  "difficulty": "intermediate",
  "estimated_time": "1 hour",
  "created": "2026-03-12",
  "updated": "2026-03-12"
}
```

## PR Format

**Title:** `[category] Short description`
- Example: `[recipes] Email history import via Gmail API`
- Example: `[schemas] CRM contacts table with interaction tracking`
- Example: `[extensions] Household Knowledge Base`
- Example: `[primitives] Row Level Security guide`

**Description must include:**
- What the contribution does
- What it requires (services, tools)
- Confirmation that you tested it on your own Open Brain instance

## The Review Process

1. You submit a PR
2. An automated GitHub Action checks 11 machine-readable rules (see below)
3. If the automated check passes, a human admin reviews for quality, clarity, and safety
4. Expect 2-5 business days for human review

## What Gets Rejected

- Contains credentials, API keys, or secrets
- Requires paid services with no free-tier alternative
- Poorly documented (missing README sections, unclear instructions)
- Duplicates an existing contribution without meaningful improvement
- Modifies core Open Brain infrastructure (the `thoughts` table structure, the core MCP server) — that's upstream, not here

## Contributor Ladder

As you contribute, you'll progress through these levels. Every level is achievable through technical or non-technical contributions.

| Level | What it means | How you get here |
| ----- | ------------- | ---------------- |
| **Community Member** | You use Open Brain and participate in discussions | Show up — ask questions, report bugs, share ideas |
| **Contributor** | You've had at least one contribution merged (code or non-code) | Submit a PR (or have a mentor submit one with your attribution) that gets merged |
| **Regular** | You're a consistent, trusted contributor | 3+ merged contributions, or sustained help reviewing/testing others' work |
| **Maintainer** | You help review PRs, mentor new contributors, and shape the project | Invited by existing maintainers based on sustained, quality involvement |

Non-code contributions count at every level. Testing recipes, mentoring non-technical contributors, improving documentation, and triaging issues all count toward progression.

## The Automated Review

Every PR is checked against these rules. All must pass before human review.

1. **Folder structure** — Contribution is in the correct category directory (`recipes/`, `schemas/`, `dashboards/`, `integrations/`, `primitives/`, `extensions/`)
2. **Required files** — Both `README.md` and `metadata.json` exist in the contribution folder
3. **Metadata valid** — `metadata.json` parses as valid JSON and contains all required fields
4. **No credentials** — No API keys, tokens, passwords, or secrets in any file
5. **SQL safety** — No `DROP TABLE`, `DROP DATABASE`, `TRUNCATE`, or unqualified `DELETE FROM`. No modifications to core `thoughts` table columns (adding columns is fine, altering/dropping existing ones is not)
6. **Category-specific artifacts** — `recipes/` have code or detailed instructions, `schemas/` have SQL files, `dashboards/` have frontend code or `package.json`, `integrations/` have code files, `primitives/` have substantial READMEs (200+ words), `extensions/` have both SQL and code files
7. **PR format** — Title starts with `[recipes]`, `[schemas]`, `[dashboards]`, `[integrations]`, `[primitives]`, or `[extensions]`
8. **No binary blobs** — No files over 1MB, no `.exe`, `.dmg`, `.zip`, `.tar.gz`
9. **README completeness** — Contribution README includes Prerequisites, step-by-step instructions, and expected outcome sections
10. **Primitive dependencies** — If a contribution declares `requires_primitives`, the primitives must exist in the repo and be linked in the README
11. **Soul check** — An LLM evaluates whether the contribution aligns with [SOUL.md](SOUL.md) and posts an advisory comment. This check is non-blocking — it flags alignment questions for human reviewers but never prevents a merge.
12. **Scope check** — All changed files must be within the contribution folder
13. **Internal links** — Relative links in READMEs must point to files that exist
