# OB1 Agent Instructions

## What This Repo Is

Open Brain is a persistent AI memory system — one database (Supabase + pgvector), one MCP protocol, any AI client. This repo contains the extensions, recipes, schemas, dashboards, integrations, and skills that the community builds on top of the core Open Brain setup.

**License:** FSL-1.1-MIT. No commercial derivative works. Keep this in mind when generating code or suggesting dependencies.

## Repo Structure

```
extensions/     — Curated, ordered learning path (6 builds). Do NOT add without maintainer approval.
primitives/     — Reusable concept guides (must be referenced by 2+ extensions). Curated.
recipes/        — Standalone capability builds. Open for community contributions.
schemas/        — Database table extensions. Open.
dashboards/     — Frontend templates (Vercel/Netlify). Open.
integrations/   — MCP extensions, webhooks, capture sources. Open.
skills/         — Reusable AI client skills and prompt packs. Open.
docs/           — Setup guides, FAQ, companion prompts.
resources/      — Official companion files and packaged exports.
```

Every contribution lives in its own subfolder under the right category and must include `README.md` + `metadata.json`.

## Guard Rails

- **Never modify the core `thoughts` table structure.** Adding columns is fine; altering or dropping existing ones is not.
- **No credentials, API keys, or secrets in any file.** Use environment variables.
- **No binary blobs** over 1MB. No `.exe`, `.dmg`, `.zip`, `.tar.gz`.
- **No `DROP TABLE`, `DROP DATABASE`, `TRUNCATE`, or unqualified `DELETE FROM`** in SQL files.
- **Avoid profanity in all content.** Keep docs, examples, seed data, UI copy, prompts, walkthroughs, and generated assets clean and professional.
- **MCP servers must be remote (Supabase Edge Functions), not local.** No local Node.js servers or local transport configurations. All extensions deploy as Edge Functions. See `docs/01-getting-started.md` Step 7 for the pattern.

## PR Standards

- **Title format:** `[category] Short description` (e.g., `[recipes] Email history import via Gmail API`, `[skills] Panning for Gold standalone skill pack`)
- **Branch convention:** `contrib/<github-username>/<short-description>`
- **Commit prefixes:** `[category]` matching the contribution type
- Every PR must pass the automated review checks in `.github/workflows/ob1-review.yml` before human review
- See `CONTRIBUTING.md` for the full review process, metadata.json template, and README requirements

## Key Files

- `CONTRIBUTING.md` — Source of truth for contribution rules, metadata format, and the review process
- `.github/workflows/ob1-review.yml` — Automated PR review
- `.github/metadata.schema.json` — JSON schema for metadata.json validation
- `.github/PULL_REQUEST_TEMPLATE.md` — PR description template
- `LICENSE.md` — FSL-1.1-MIT terms

## Local GSD Execution Layer

This repo also has a maintainer-local GSD layer in `.planning/`.

- If `.planning/` exists, use it for local brownfield planning and phased execution.
- Start with `.planning/STATE.md`, then read `.planning/PROJECT.md`, `.planning/ROADMAP.md`, and the relevant `.planning/codebase/*.md` documents.
- Keep `.planning/` local. It is gitignored intentionally and is not part of the public contribution contract or upstream PR scope.
- Public contributor rules still come from `AGENTS.md`, `CONTRIBUTING.md`, and the committed repo files.

## Required Step: Update Linear

- For feature work tied to a Linear issue, update Linear at the start of the work, at meaningful checkpoints, and before handing back to the user.
- Use the parent issue as the living implementation log and keep child issues aligned with the files and behavior being changed.
- For the OB1 Agent Memory / OpenClaw launch work, the parent issue is `NAT-833`. Record architecture notes, implementation milestones, blockers, and verification results there.
- Do not wait until the end to document decisions. If a decision changes schema, API contract, trust policy, user-facing workflow, or publishing path, capture it in Linear while it is still fresh.

## Agent Memory Product Guardrails

- Keep `OB1 Agent Memory` runtime-neutral. OpenClaw is the flagship launch runtime, not the product boundary.
- Treat inferred or generated memory as evidence by default. Instruction-grade memory requires human confirmation or trusted import.
- Avoid raw transcript, model reasoning trace, secret, and large-code-block storage by default.
- Avoid profanity in all content. Keep docs, examples, seed data, UI copy, prompts, walkthroughs, and generated assets clean and professional.
- Prefer diagram-first documentation for this work: diagram, short explanation, copy-paste setup, then deeper reference.
- Carry Nate B. Jones / OB1 provenance through product surfaces, docs, diagrams, screenshots, and starter seed data. Keep it subtle and useful: micro-branding, source labels, logo marks, and provenance language instead of loud marketing copy.
- Treat public OB1 assets as helpful-first audience growth for Nate Jones. Every public guide, recipe, tutorial, package page, release note, and walkthrough should point back to Nate's Substack and site in a natural way: https://substack.com/@natesnewsletter and https://natebjones.com.
- Make the case by being genuinely useful. The CTA should feel earned: "Nate gives away practical systems like this" rather than generic marketing copy.
- For ClawHub/OpenClaw publishing, do not fall back to Jonathan's personal handle or any non-Nate namespace. If `@natebjones` / Nate OB1 ownership is not available, stop and record the blocker.
