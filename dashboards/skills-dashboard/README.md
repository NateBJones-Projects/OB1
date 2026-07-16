# Skills Dashboard

A localhost dashboard showing which AI skills are installed in which harness on this machine. One row per skill, one column per harness, an `×` where installed — grouped into collapsible categories, searchable, with a per-skill file browser and a static-export path for Vercel.

## Harnesses scanned

| Harness | Where skills are found |
|---|---|
| Claude Code | `~/.claude/skills/` (personal) + enabled plugins resolved via `~/.claude/plugins/installed_plugins.json` |
| Codex | `~/.codex/skills/` + built-in `.system/` skills + plugin cache |
| Grok Build | `~/.grok/skills/` |
| Hermes | `$HERMES_HOME` or `~/.hermes` — pre-wired; the column populates automatically once Hermes is installed |
| Claude Desktop | `~/Library/Application Support/Claude/local-agent-mode-sessions/skills-plugin/**` joined with its `manifest.json` |
| ChatGPT Desktop | no local skill store — the column renders with a note |

Skills are matched across harnesses by their frontmatter `name` (directory name as fallback, with lenient recovery for malformed YAML). The Updated column is the newest `SKILL.md` mtime across harnesses; per-install dates are in the row detail and cell tooltips. Dates within the last 7 days render in signal orange.

Claude Code / Codex **plugin-provided** skills (~250 rows) are hidden by default — enable the "plugin skills" toggle to include them. The toggle works at the install level: a skill installed both personally and via plugin keeps its × either way, sourced accordingly.

## Run

```bash
npm install
npm run dev        # Express scanner on :8788 + Vite client on :5173
```

Open http://localhost:5173. The table rescans on every request; the client refetches every 60 s and has a Refresh button.

Click a **skill name** to open the file browser popup (one tab per install, resizable, Esc/× to close). Click the **+** next to a name for inline install details (source, path, date, per-harness state).

## Descriptions & LLM enrichment (optional)

Descriptions come from SKILL.md frontmatter (or Claude Desktop's manifest). Skills without one get a heuristic (first paragraph of the body). To improve those and re-categorize rows stuck in "Other" with an LLM:

```bash
cp .env.example .env    # set OPENROUTER_API_KEY
npm run enrich          # or use the Enrich button in the toolbar
```

Results are cached in `server/.describe-cache.json` keyed by file content hash, so each skill is only ever summarized once. The polled `/api/skills` route never calls the LLM.

Categories are assigned by an editable keyword rubric in `server/categories.ts` (manual overrides map at the top).

## Deploy to Vercel (static snapshot)

A hosted deployment cannot scan this machine's disk — it serves a baked snapshot:

```bash
npm run export     # writes a sanitized public/skills.json (no absolute paths)
npm run build      # bundles it into dist/
```

Deploy `dist/` as a static site (`vercel deploy dist`). The client detects that `/api` is absent, falls back to the baked `skills.json`, and shows a "snapshot from <date>" badge; the file-browser popup is disabled. Re-run export + build to refresh the snapshot.

## Notes

- Port 8788 (repo-learning-coach uses 8787). Override with `SKILLS_DASH_PORT`.
- The file-browser endpoints only serve paths that `realpath`-resolve inside the scanned skill roots; symlinks are rejected.
- `npm run serve` after a build serves the client and API together on :8788 (production mode).
