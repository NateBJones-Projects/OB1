# Mintlify docs for Open Brain

A polished documentation site for the OB1 project. The plain-markdown `docs/` folder at the repo root remains the canonical source of truth (it's linked from Executive Circle, Substack, and external posts); this folder is a presentation layer on top.

## Local preview

```bash
npm i -g mint
cd mintlify
mint dev
```

Opens http://localhost:3000.

## Validate config

```bash
mint broken-links
```

## Deploy

Connect this repo + the `mintlify/` subfolder at https://dashboard.mintlify.com. Every push to `main` deploys.

## Structure

- `docs.json` — Mintlify config (theme, nav, footer)
- `introduction.mdx`, `how-it-works.mdx`, `architecture.mdx` — orientation
- `quickstart/*.mdx` — 6-page install walkthrough
- `extend/*.mdx` — extensions, recipes, schemas, dashboards, integrations
- `reference/*.mdx` — MCP tool signatures, `thoughts` table schema
- `faq.mdx`, `contributing.mdx` — community pages

## Editing principle

Don't duplicate content the repo already owns. Most pages link out to the canonical markdown in `docs/`, `CONTRIBUTING.md`, or contribution folder READMEs. The quickstart is the one exception — it's the primary entry point, so it's a full self-contained walkthrough.
