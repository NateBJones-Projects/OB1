# Apple Notes Import Recipe — Design Spec

**Date:** 2026-04-15
**Author:** David Oliver / davidroliver
**Status:** Approved — ready for implementation

---

## Overview

A recipe that imports Apple Notes directly into Open Brain via macOS automation, with no manual export step. Notes are extracted as raw content, chunked at heading boundaries, converted to Markdown, and ingested with embeddings and rich metadata including web URLs and note-to-note links.

**Fills a gap in OB1:** No Apple Notes recipe exists. Apple Notes is the most common default note-taking app for the Mac-first users who make up the OB1 audience.

---

## File Structure

```
recipes/apple-notes-import/
├── extract-notes.js        ← JXA (JavaScript for Automation) extraction script
├── import-apple-notes.py   ← Main importer: HTML→Markdown, chunk, embed, upload
├── requirements.txt
├── .env.example
├── metadata.json
└── README.md
```

---

## Extraction Layer (`extract-notes.js`)

**Technology:** JXA (JavaScript for Automation), run via `osascript -l JavaScript`.

**Rationale for JXA over AppleScript language:** AppleScript has no native JSON serialiser. Note bodies are HTML containing quotes, newlines, and special characters that make custom AppleScript serialisation fragile. JXA uses the same macOS Notes object model but supports `JSON.stringify` natively, producing clean, parseable output.

**Usage:**
```bash
osascript -l JavaScript extract-notes.js > notes-export.json
```

The user inspects `notes-export.json` before running the importer — this is the key benefit of the two-file split.

**Per-note fields extracted:**
| Field | Type | Notes |
|-------|------|-------|
| `id` | string | Apple internal note identifier (used for dedup + link resolution) |
| `title` | string | Note name |
| `body` | string | Raw HTML body |
| `folder` | string | Folder name |
| `account` | string | Account name (e.g. "iCloud", "On My Mac") |
| `created` | ISO8601 | Creation timestamp |
| `modified` | ISO8601 | Last modification timestamp |

All accounts and folders are iterated. Filtering is handled in the importer via CLI flags.

---

## Processing Pipeline (`import-apple-notes.py`)

### Step 1: Load & filter
Read `notes-export.json`. Apply CLI filters (`--folder`, `--account`, `--after`, `--limit`). Check sync log — skip notes whose `id` + `modified` timestamp match a previous run.

### Step 2: Link extraction (from raw HTML)
Using BeautifulSoup, before Markdown conversion strips the tags:

- **Web URLs:** all `<a href="...">` where href starts with `http://` or `https://` → stored as `urls[]` in metadata
- **Note-to-note links:** `<a href="...">` where href starts with `notelinks://` (macOS 14+) or `x-coredata://` (older) → stored as `note_links[]` in metadata

### Step 3: HTML → Markdown
Using `markdownify`. Handles the Apple Notes HTML conventions:
- `<h1>` / `<h2>` → `#` / `##`
- `<ul>` / `<li>` → `-`
- `<li data-done="true">` → `- [x]` (checklists)
- `<strong>` / `<em>` → `**` / `_`
- `<a href="...">text</a>` → `[text](url)` (preserves inline links in content)

### Step 4: Chunking
Mirrors the Obsidian recipe strategy:

| Note length | Strategy |
|-------------|----------|
| < 500 words | Single thought |
| Has `##` headings | Split per section — each becomes one thought |
| Section > 1000 words | Optional LLM distillation via `gpt-4o-mini` (skip with `--no-llm`) |

Each thought gets the prefix: `[Apple Notes: {title} | {folder}]`

### Step 5: Secret scan
Scan each thought for API keys, tokens, connection strings before embedding. Flag and skip — never upload to Supabase. Log skipped thoughts.

### Step 6: Embed + insert
- Embed via OpenRouter `text-embedding-3-small`
- Insert directly into Supabase `thoughts` table (Python recipes use direct insert, not the MCP RPC)
- `content_fingerprint` (SHA-256) included in the insert payload; unique index on that column provides database-level dedup
- 150ms delay between embedding calls; exponential backoff on 429/5xx

### Step 7: Update sync log
Write `apple-notes-sync-log.json` with `{note_id: modified_timestamp}` for every successfully imported note.

---

## Metadata Schema

```json
{
  "source": "apple-notes",
  "note_id": "x-coredata://ABC123/...",
  "title": "Meeting with Alex",
  "folder": "Work",
  "account": "iCloud",
  "created": "2026-01-15",
  "modified": "2026-03-20",
  "urls": ["https://example.com/doc"],
  "note_links": ["notelinks://ABC123"],
  "type": "observation"
}
```

`type` is auto-classified by the same LLM metadata extraction used in the core OB1 server (observation / task / idea / reference / person_note).

---

## CLI Flags

| Flag | Description |
|------|-------------|
| `--dry-run` | Parse and preview without uploading |
| `--limit N` | Process first N notes only |
| `--folder NAME` | Only import from this folder (case-insensitive match) |
| `--account NAME` | Only import from this account (e.g. "iCloud") |
| `--after YYYY-MM-DD` | Only notes modified after this date |
| `--no-llm` | Skip LLM chunking — heading splits only, zero LLM cost beyond embeddings |
| `--verbose` | Detailed per-note progress output |
| `--report` | Write `import-report.md` summary after run |

---

## Environment Variables

```
SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY
OPENROUTER_API_KEY
```

Same as every other OB1 import recipe.

---

## Dependencies (`requirements.txt`)

```
supabase
markdownify
beautifulsoup4
python-dotenv
```

All well-maintained, pip-installable, no C extensions.

---

## Deduplication

Two levels:
1. **Sync log** (`apple-notes-sync-log.json`) — keyed on note ID + modification timestamp. Re-runs skip unchanged notes without API calls.
2. **Content fingerprint** — SHA-256 of normalised content stored in `metadata`. If the `thoughts` table has a unique index on `content_fingerprint`, database-level dedup applies even if the sync log is deleted.

---

## OB1 Contribution Compliance

- `README.md` with Prerequisites, numbered steps, Expected Outcome, Troubleshooting ✓
- `metadata.json` with all required fields ✓
- No credentials (`.env.example` only) ✓
- No `DROP TABLE` / `TRUNCATE` / destructive SQL ✓
- No binary blobs ✓
- No local MCP server (this is a script recipe, not an extension) ✓
- Secret scanner before any data upload ✓
- Category: `recipes` — requires code files (.py, .js) ✓

---

## Out of Scope

- macOS Shortcuts / Automator integration
- Incremental real-time sync (run-on-demand only)
- Attachments / images embedded in notes (text content only)
- Password-protected notes (skipped with a warning)
