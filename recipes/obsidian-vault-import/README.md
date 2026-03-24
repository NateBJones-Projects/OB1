# Obsidian Vault Import

<div align="center">

![Community Contribution](https://img.shields.io/badge/OB1_COMMUNITY-Approved_Contribution-2ea44f?style=for-the-badge&logo=github)

**Created by [@snapsynapse](https://github.com/snapsynapse)**

*Reviewed and merged by the Open Brain maintainer team — thank you for building the future of AI memory!*

</div>

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
- Your Supabase project URL and API key
- OpenRouter API key (for embeddings and optional LLM chunking)
- Recommended: add a `content_fingerprint` column and unique index for database-level dedup (see [Re-running and Deduplication](#re-running-and-deduplication))

## Credential Tracker

Copy this block into a text editor and fill it in as you go.

```text
OBSIDIAN VAULT IMPORT -- CREDENTIAL TRACKER
--------------------------------------

FROM YOUR OPEN BRAIN SETUP
  Supabase Project URL:  ____________
  Supabase API key:      ____________
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
   Edit `.env` and fill in your Supabase URL, API key, and OpenRouter API key. Find your Supabase credentials in the dashboard under Settings → API.

4. **Run a dry run first** to see what would be imported:
   ```bash
   python import-obsidian.py /path/to/your/vault --dry-run --verbose
   ```
   This scans your vault, shows how many notes pass filters, how many thoughts would be generated, and flags any notes containing potential secrets — without inserting anything.

5. **Start with a small batch** to verify everything works:
   ```bash
   python import-obsidian.py /path/to/your/vault --limit 20 --verbose
   ```
   The script runs a preflight check before any import — it verifies your Supabase connection and OpenRouter API key before spending time on chunking or embeddings.

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
| `--no-embed` | Skip embedding generation (insert thoughts without vectors) |
| `--no-secret-scan` | Disable secret detection (not recommended) |
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

## Secret Detection

The script scans each thought for potential secrets before embedding or inserting. Thoughts containing API keys, tokens, passwords, or connection strings are skipped and logged — they never reach your database.

Detected patterns include:
- API keys (OpenAI, OpenRouter, AWS, GitHub, Supabase)
- JWT tokens
- Private key blocks
- Connection strings with embedded credentials
- Generic secret assignments (`password=`, `token=`, `api_key=`, etc.)

The dry run (`--dry-run`) also runs the scanner, so you can review what would be flagged before a live import. If the scanner flags a false positive, use `--no-secret-scan` to disable it.

## How Chunking Works

The script uses a hybrid chunking strategy to turn notes into atomic thoughts:

1. **Short notes** (under 500 words) become a single thought.
2. **Notes with headings** are split at `## ` boundaries — each section becomes one thought.
3. **Long sections** (over 1000 words) are sent to an LLM (gpt-4o-mini via OpenRouter) which distills them into 1-3 standalone thoughts.

Use `--no-llm` to skip step 3 if you want to avoid LLM costs. Heading-based splitting still works.

## Cost Estimate

Costs depend on vault size and whether LLM chunking is enabled. Embeddings use `text-embedding-3-small` and LLM chunking uses `gpt-4o-mini`, both via OpenRouter.

| Vault size | Embeddings only (`--no-llm`) | With LLM chunking |
|------------|------------------------------|---------------------|
| 100 notes  | ~$0.02                       | ~$0.15              |
| 500 notes  | ~$0.10                       | ~$0.75              |
| 1000+ notes | ~$0.20                      | ~$1.50              |

Use `--dry-run` to see how many thoughts your vault would generate before committing to a full run. Use `--no-embed` to skip embeddings entirely (zero API cost) if you plan to generate them separately.

**Time estimate:** Roughly 1 second per thought or 16 minutes per 1,000 thoughts. A 700-note vault producing ~2,700 thoughts takes about 45 minutes. The bottleneck is embedding generation — each thought requires a round-trip API call.

## Rate Limiting

The script self-throttles to respect upstream API limits:
- **150ms delay** between embedding API calls to avoid flooding OpenRouter
- **1-second pause** every 50 inserts to give Supabase breathing room
- **Exponential backoff** on 429/5xx errors (2s → 4s → 8s, up to 3 retries)

For large vaults (1000+ notes), use `--limit` to import in batches if you encounter rate limit errors. The sync log ensures you can resume where you left off.

See also: [Graceful Boundaries](https://github.com/snapsynapse/graceful-boundaries) — a spec for how services communicate operational limits to humans and agents.

## Re-running and Deduplication

The script prevents duplicates at two levels:

**Local sync log** (`obsidian-sync-log.json`) — tracks content hashes of imported notes. On re-runs, unchanged notes are skipped entirely (saving embedding API calls). Modified notes are re-imported, and new notes are added.

**Database-level fingerprinting** — each thought includes a `content_fingerprint` (SHA-256 of normalized content). If your `thoughts` table has a unique index on `content_fingerprint`, the insert automatically skips duplicates even if the sync log is deleted or a different machine imports overlapping content. To add the index:

```sql
CREATE UNIQUE INDEX IF NOT EXISTS thoughts_content_fingerprint_idx
  ON thoughts (content_fingerprint);
```

Without the index, the fingerprint is stored but dedup relies on the sync log only.

To do a clean re-import, delete `obsidian-sync-log.json` and remove the imported thoughts from your `thoughts` table (filter by `metadata->>'source' = 'obsidian'`).

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
Solution: The sync log prevents duplicates on re-runs. For stronger protection, add the `content_fingerprint` unique index (see "Re-running and Deduplication" above) — this catches duplicates even if the sync log is deleted or another machine imports the same content. To clean up existing duplicates, filter by `metadata->>'source' = 'obsidian'` in the Supabase Table Editor.

**Issue: Import aborts after "10 consecutive insert failures"**
Solution: The script stops early if 10 inserts fail in a row to avoid wasting embedding credits. Check your Supabase connection, verify the `thoughts` table exists, and confirm your API key is correct. The preflight check catches most of these, but a connection drop mid-import can also trigger this.

**Issue: Notes flagged as containing secrets (false positive)**
Solution: Review the flagged content. If it's a false positive (e.g., a note discussing API key formats without containing real keys), re-run with `--no-secret-scan`. The scanner is intentionally conservative — it's better to flag and skip than to store a real secret in your database.
