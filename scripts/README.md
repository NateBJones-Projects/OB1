# Maintenance Scripts

These dependency-free Node.js scripts support repository maintenance and contribution checks. Run them from the repository root with Node.js 18 or newer.

## Scaffold a New Contribution

`new-contribution.mjs` copies the selected category's `_template/` directory, fills in its README and metadata, and adds category-specific starter artifacts. Dashboard scaffolds include `index.html`, integrations include `index.ts`, and extensions include both `schema.sql` and `index.ts`. Generated primitive READMEs include a submission checklist that keeps them above the category's minimum detail threshold. Template-only maintainer files are excluded from generated contributions. The `_template/` directories remain the source of truth.

```bash
node scripts/new-contribution.mjs \
  --category recipes \
  --slug demo-recipe \
  --name "Demo Recipe" \
  --description "Adds a demonstration workflow to Open Brain." \
  --author "Your Name" \
  --github your-github-username \
  --difficulty beginner \
  --estimated-time "20 minutes" \
  --tags demo,workflow \
  --yes
```

Omit required flags in a terminal to answer interactive prompts. Use `--yes` for non-interactive runs; missing required values then fail instead of prompting.

Available flags:

- `--category`: `recipes`, `schemas`, `dashboards`, `integrations`, `skills`, `primitives`, or `extensions`
- `--slug`: Lowercase, hyphenated destination folder name
- `--name`, `--description`, `--author`, `--github`
- `--difficulty`: `beginner`, `intermediate`, or `advanced`
- `--estimated-time`, `--tags`
- `--requires-skills`, `--requires-primitives`: Comma-separated dependency slugs
- `--learning-order`: Positive integer required for extensions
- `--yes`: Disable interactive prompting

The command exits `0` after creating and checking the scaffold, `1` for invalid or missing input, and `2` when the destination already exists. It never overwrites an existing contribution.

## Update Recent Contributions

`update-readme-contributions.mjs` refreshes the recent contributions table in the root README from merged GitHub pull requests:

```bash
node scripts/update-readme-contributions.mjs
```
