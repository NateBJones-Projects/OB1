# CLAUDE.md — OB1 Repository Guide

## What This Repo Is

OB1 (Open Brain) is an open-source infrastructure layer for personal AI memory. It uses one Supabase database, one AI gateway, and one chat channel (Slack) so that any AI tool (Claude, ChatGPT, Cursor, etc.) shares a single persistent memory. This repo contains:

- **6 curated extensions** — a progressive learning path where each extension builds on the previous ones
- **2 primitives** — reusable concept guides (Row Level Security, Shared MCP Server)
- **Community contributions** — recipes, schemas, dashboards, and integrations

## Repo Structure

```
extensions/          # Curated, ordered learning path (1-6). Each has SQL + MCP server code.
primitives/          # Reusable concept guides referenced by 2+ extensions
recipes/             # Step-by-step community builds that add capabilities
schemas/             # Database table extensions (SQL files)
dashboards/          # Frontend templates for Vercel/Netlify
integrations/        # MCP extensions, webhooks, capture sources
docs/                # Setup guide, companion prompts, FAQ, AI-assisted setup
resources/           # Companion skill files
```

Each contribution lives in its own subfolder (e.g., `recipes/email-history-import/`) and must contain a `README.md` and `metadata.json`.

## PR Review Checklist

When reviewing a PR — whether triggered automatically or by an `@claude` mention — apply **all 11 rules** below. This matches the automated checks in `.github/workflows/ob1-review.yml`. Flag every failure clearly.

### Rule 1: Folder structure
All changed files must be in allowed directories: `recipes/`, `schemas/`, `dashboards/`, `integrations/`, `primitives/`, `extensions/`, `docs/`, `resources/`, `.github/`. Files outside these directories fail this check.

### Rule 2: Required files
Every contribution folder must contain both `README.md` and `metadata.json`.

### Rule 3: Metadata valid
Each `metadata.json` must be valid JSON with these required fields:
- `name`, `description`, `category`, `version`, `estimated_time`
- `author.name`
- `requires.open_brain` (must be `true`)
- `tags` (at least 1)
- `difficulty` (must be one of: `beginner`, `intermediate`, `advanced`)

Extensions may also have `requires_primitives` (array of primitive slugs) and `learning_order` (integer 1-6).

### Rule 4: No credentials
No API keys, tokens, passwords, or secrets in any code file. Patterns to flag:
- `sk-` followed by 20+ alphanumeric chars (OpenAI keys)
- `AKIA` followed by 16 uppercase chars (AWS keys)
- `ghp_` followed by 36 chars (GitHub tokens)
- `xoxb-` or `xoxp-` (Slack tokens)
- `SUPABASE_SERVICE_ROLE_KEY` set to an actual `ey...` value
- `.env` files with real values (not placeholders)

### Rule 5: SQL safety
No destructive SQL operations:
- No `DROP TABLE`, `DROP DATABASE`, or `TRUNCATE`
- No `DELETE FROM` without a `WHERE` clause
- No `ALTER TABLE thoughts DROP COLUMN` or `ALTER TABLE thoughts ALTER COLUMN` (adding columns to `thoughts` is fine; modifying or dropping existing ones is not)

### Rule 6: Category-specific artifacts
Each category requires specific file types beyond README and metadata:
- **recipes/** — code files (`.sql`, `.ts`, `.js`, `.py`) OR detailed step-by-step instructions (3+ numbered steps) in the README
- **schemas/** — at least one `.sql` file
- **dashboards/** — frontend code (`.html`, `.jsx`, `.tsx`, `.vue`, `.svelte`) or `package.json`
- **integrations/** — code files (`.ts`, `.js`, `.py`)
- **primitives/** — substantial README (200+ words)
- **extensions/** — both SQL files AND code files (`.ts`, `.js`, `.py`)

### Rule 7: PR format
PR title must start with a category tag followed by a space:
`[recipes]`, `[schemas]`, `[dashboards]`, `[integrations]`, `[primitives]`, `[extensions]`, or `[docs]`

Exception: PRs that only touch `docs/`, `.github/`, or repo governance files may use `[docs]`.

### Rule 8: No binary blobs
- No files over 1 MB
- No binary/archive files: `.exe`, `.dmg`, `.zip`, `.tar.gz`, `.tar.bz2`, `.rar`, `.7z`, `.msi`, `.pkg`, `.deb`, `.rpm`

### Rule 9: README completeness
Every contribution README must include:
1. **Prerequisites** — what the user needs before starting
2. **Step-by-step instructions** — numbered steps (at least 3)
3. **Expected outcome** — what the user should see when it works

Extensions additionally require: "Why This Matters", "Learning Path" table, "What You'll Learn", "Cross-Extension Integration", and "Next Steps" sections.

### Rule 10: Primitive dependencies
If a contribution's `metadata.json` declares `requires_primitives`, then:
- Each listed primitive directory must exist in `primitives/`
- The contribution's README must link to each required primitive

### Rule 11: LLM clarity review
This check runs automatically in CI via the Anthropic API (Claude Haiku). When you are invoked via `@claude` on a PR, provide a deeper version of this same review. Read the contribution's README and evaluate:
- Are the instructions clear enough for someone with only the stated prerequisites?
- Are there missing steps, ambiguous references, or assumed knowledge?
- Do code snippets look correct and copy-paste ready?
- Is the expected outcome specific enough to verify success?
- For SQL: do the statements look syntactically correct? Do they reference the right tables?

## Review Output Format

When reviewing a PR, structure your response as:

```
## OB1 Review

[For each rule, report pass/fail with a brief explanation]

✅ **Folder structure** — All files in allowed directories
❌ **SQL safety** — `schemas/foo/001_create.sql` line 12: DELETE FROM without WHERE clause
...

**Result: X/11 checks passed.**

[If all pass]: Ready for human review.
[If any fail]: Please fix the issues above and push again.

### Clarity Notes
[Your detailed feedback on documentation quality, unclear steps, missing context, etc.]
```

## Important Context for Reviews

- The core `thoughts` table is the foundation of Open Brain. Contributions must never destructively modify it.
- Extensions are curated and ordered — they should not be submitted without maintainer discussion first.
- Primitives must be referenced by 2+ extensions to justify their existence.
- Community contributions (recipes, schemas, dashboards, integrations) are open for anyone.
- All contributions should be tested on the contributor's own Open Brain instance before submitting.

## Docs-Only PRs

If a PR only modifies files in `docs/`, `.github/`, or top-level repo governance files (and touches no contribution directories), skip the contribution-specific checks (Rules 2-6, 9-10). Just verify folder structure, PR format, no credentials, no binaries, and provide clarity feedback on the documentation changes.
