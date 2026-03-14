# Obsidian Vault Import

> Parse your Obsidian vault and import notes into Open Brain as searchable, embedded thoughts.

## What It Does

Takes any Obsidian vault directory, parses every markdown note (including frontmatter tags, dates, and wikilinks), chunks long notes into atomic thoughts, generates vector embeddings, and inserts everything into your Open Brain `thoughts` table. Your entire vault becomes semantically searchable through any MCP-connected AI.

## Vault Compatibility

This recipe works with any Obsidian vault regardless of organizational method. It parses standard markdown, frontmatter, wikilinks, and tags — features common to all major patterns.

| Pattern | Structure | Import notes |
|---------|-----------|--------------|
| **BASB / PARA** | Folders: Projects, Areas, Resources, Archives | Works out of the box. Use `--skip-folders` to exclude Archives if desired. |
| **LYT / Ideaverse** | Maps of Content (MOCs) as hub notes, emergent linking | MOCs import as thoughts; wikilinks are captured in metadata. |
| **LifeHQ** | Full life OS with dashboards, tasks, planning workflows | Use `--skip-folders Templates` to exclude Templater files. Tested on 500+ note vault. |
| **FLAP** | Pipeline: Fleeting → Literature → Atomic → Permanent | Atomic notes import cleanly. Literature notes chunk well via heading splits. |
| **Zettelkasten** | Atomic notes with dense linking, bottom-up structure | Ideal fit — small atomic notes map 1:1 to thoughts. |
| **MOC-centric hubs** | Curated hub notes per topic, domain, or role | Hub notes import with all wikilinks preserved in metadata for graph traversal. |

No special configuration is needed for any of these — the script handles them all with the same parsing pipeline. Use `--dry-run` to preview your vault before importing.

## Prerequisites

- Working Open Brain setup ([guide](../../docs/01-getting-started.md))
- Python 3.10+
- Your Supabase project URL and service role key
- OpenRouter API key (for embeddings and optional LLM chunking)

## Credential Tracker

Copy this block into a text editor and fill it in as you go.

```text
OBSIDIAN VAULT IMPORT -- CREDENTIAL TRACKER
--------------------------------------

FROM YOUR OPEN BRAIN SETUP
  Supabase Project URL:  ____________
  Supabase service_role key (JWT, starts with eyJ...):  ____________
  OpenRouter API key:    ____________

FILE LOCATION
  Path to Obsidian vault:  ____________

--------------------------------------
```

## Steps

1. **Clone or copy this recipe folder** to your local machine.

2. **Install Python dependencies:**
   ```bash
   cd recipes/obsidian-vault-import
   pip install -r requirements.txt
   ```

3. **Create your `.env` file** from the example:
   ```bash
   cp .env.example .env
   ```
   Edit `.env` and fill in your Supabase URL, service role key, and OpenRouter API key.

   **Important:** The `SUPABASE_SERVICE_ROLE_KEY` must be the **legacy JWT token** (starts with `eyJ...`). Find it in your Supabase dashboard under Settings → API → scroll down to "Legacy anon, service_role API keys" and click Reveal next to `service_role`. The newer `sb_secret_` format does not work with the REST API.

4. **Run a dry run first** to see what would be imported:
   ```bash
   python import-obsidian.py /path/to/your/vault --dry-run --verbose
   ```
   This scans your vault, shows how many notes pass filters, and how many thoughts would be generated — without inserting anything.

5. **Start with a small batch** to verify everything works:
   ```bash
   python import-obsidian.py /path/to/your/vault --limit 20 --verbose
   ```

6. **Run the full import** once you're satisfied:
   ```bash
   python import-obsidian.py /path/to/your/vault --verbose
   ```

7. **Verify in Supabase.** Open your Supabase dashboard → Table Editor → `thoughts`. You should see rows with:
   - `content` — your note text with an `[Obsidian: Title | Folder]` prefix
   - `embedding` — a 1536-dimensional vector
   - `metadata` — JSON with source, title, folder, tags, date, and wikilinks

## Options

| Flag | Description |
|------|-------------|
| `--dry-run` | Preview without inserting (shows what would be imported) |
| `--limit N` | Process only the first N notes |
| `--min-words N` | Skip notes with fewer than N words (default: 50) |
| `--skip-folders X` | Comma-separated additional folder names to skip |
| `--after DATE` | Only import notes modified after this date (YYYY-MM-DD) |
| `--no-llm` | Disable LLM chunking — heading splits only, zero API cost beyond embeddings |
| `--verbose` | Show detailed progress for each note |
| `--report` | Generate an `import-report.md` summary file |

## What Gets Filtered

The script automatically skips notes that wouldn't make useful thoughts. Run with `--dry-run --verbose` to preview exactly what gets included and excluded.

**Always-skipped folders** (Obsidian internals, not your content):
- `.obsidian/` — plugin configs, themes, workspace state
- `.trash/` — Obsidian's soft-delete folder
- `.git/`, `node_modules/` — version control and dependencies
- Any folder starting with `.` (hidden directories)

**Template files** — notes inside any folder with "templates" in its name (case-insensitive). These contain Templater syntax (`<% %>`) and placeholder variables, not real content. Applies to `Templates/`, `8_Reference/Templates/`, etc.

**Short notes** — notes with fewer than 50 words (default). These are typically stubs, empty MOCs, or link-only index files. Adjust with `--min-words`:
- `--min-words 20` to include shorter notes
- `--min-words 100` to be more selective

**Already-imported notes** — the sync log tracks content hashes so re-runs skip unchanged notes automatically.

**Date-filtered notes** — when using `--after YYYY-MM-DD`, notes not modified after that date are skipped.

**Additional folder exclusions** — use `--skip-folders` for vault-specific directories you don't want imported:
```bash
# Skip framework reference materials, archive, and attachments
python import-obsidian.py /path/to/vault --skip-folders "Archive,Files,patterns"
```

## How Chunking Works

The script uses a hybrid chunking strategy to turn notes into atomic thoughts:

1. **Short notes** (under 500 words) become a single thought.
2. **Notes with headings** are split at `## ` boundaries — each section becomes one thought.
3. **Long sections** (over 1000 words) are sent to an LLM (gpt-4o-mini via OpenRouter) which distills them into 1-3 standalone thoughts.

Use `--no-llm` to skip step 3 if you want to avoid LLM costs. Heading-based splitting still works.

## Re-running and Updates

The script maintains a sync log (`obsidian-sync-log.json`) that tracks which notes have been imported and their content hashes. If you re-run the import:
- Notes that haven't changed are skipped automatically
- Notes with new content are re-imported
- New notes are imported

To do a clean re-import, delete `obsidian-sync-log.json` and clear your `thoughts` table.

## Expected Outcome

After a successful import, searching your Open Brain for topics from your vault returns relevant results. The metadata on each thought includes:

```json
{
  "source": "obsidian",
  "title": "Note Title",
  "folder": "Projects/My Project",
  "tags": ["project", "active"],
  "date": "2026-01-15",
  "wikilinks": ["Related Note", "Another Note"]
}
```

You can filter by source to find only Obsidian-imported thoughts: search with `{"source": "obsidian"}` as a metadata filter.

## Troubleshooting

**Issue: `python-frontmatter` not found**
Solution: Make sure you ran `pip install -r requirements.txt`. If using a virtual environment, activate it first.

**Issue: Import is slow on large vaults (1000+ notes)**
Solution: Embedding generation is the bottleneck — each note requires an API call. Use `--limit` to import in batches, or `--no-llm` to skip LLM chunking and reduce API calls. The script rate-limits itself to avoid hitting OpenRouter quotas.

**Issue: Some notes are skipped unexpectedly**
Solution: Run with `--verbose` to see which notes are filtered and why. Common reasons: notes under 50 words (adjust with `--min-words`), notes in a `Templates/` folder, or notes already in the sync log. Check `--dry-run` output first.

**Issue: Encoding errors on some notes**
Solution: The parser handles encoding errors gracefully — problematic files are skipped with a warning. If you see many parse errors, your vault may contain non-UTF-8 files. The script will continue processing the rest.

**Issue: Duplicate thoughts after re-running**
Solution: The sync log prevents duplicates on re-runs. If you see duplicates, the sync log may have been deleted. To clean up, delete duplicates from the `thoughts` table in Supabase and re-run the import.
