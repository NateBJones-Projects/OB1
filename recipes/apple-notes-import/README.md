# Apple Notes Import

> Import your Apple Notes directly into Open Brain — no manual export step.

## What It Does

Pulls every note from Apple Notes.app (iCloud and "On My Mac" accounts), converts the
HTML body to Markdown, captures web links and note-to-note links, chunks long notes at
heading boundaries, and inserts them into your Open Brain `thoughts` table with vector
embeddings and rich metadata.

## Prerequisites

- Working Open Brain setup ([guide](../../docs/01-getting-started.md))
- macOS with Notes.app (built-in on all Macs — no install needed)
- Python 3.10+
- OpenRouter API key (for embeddings)
- Supabase project URL and service role key

## Credential Tracker

```text
APPLE NOTES IMPORT -- CREDENTIAL TRACKER
--------------------------------------
FROM YOUR OPEN BRAIN SETUP
  Supabase Project URL:      ____________
  Supabase service role key: ____________
  OpenRouter API key:        ____________
--------------------------------------
```

## Steps

![Step 1](https://img.shields.io/badge/Step_1-Extract_Your_Notes-1E88E5?style=for-the-badge)

```bash
osascript -l JavaScript extract-notes.js > notes-export.json
```

> [!IMPORTANT]
> macOS will show an automation permission prompt the first time.
> Click **OK** to allow your terminal to control Notes.app.

Verify the extraction:
```bash
python3 -c "import json; d=json.load(open('notes-export.json')); print(f'{len(d)-1} notes extracted')"
```

✅ **Done when:** `notes-export.json` exists and reports your note count.

---

![Step 2](https://img.shields.io/badge/Step_2-Install_Dependencies-1E88E5?style=for-the-badge)

```bash
pip install -r requirements.txt
```

✅ **Done when:** all packages install without errors.

---

![Step 3](https://img.shields.io/badge/Step_3-Configure_Credentials-1E88E5?style=for-the-badge)

```bash
cp .env.example .env
```

Edit `.env` with your Supabase URL, service role key, and OpenRouter API key.
Find Supabase credentials at **Dashboard → Settings → API**.

✅ **Done when:** `.env` contains real values.

---

![Step 4](https://img.shields.io/badge/Step_4-Dry_Run-1E88E5?style=for-the-badge)

```bash
python import-apple-notes.py --dry-run --verbose
```

✅ **Done when:** you see a note count and chunk preview with no errors.

---

![Step 5](https://img.shields.io/badge/Step_5-Small_Batch_Test-1E88E5?style=for-the-badge)

```bash
python import-apple-notes.py --limit 10 --verbose
```

Check **Supabase → Table Editor → thoughts** for rows with `"source": "apple-notes"`.

✅ **Done when:** imported thoughts appear in Supabase.

---

![Step 6](https://img.shields.io/badge/Step_6-Full_Import-1E88E5?style=for-the-badge)

```bash
python import-apple-notes.py --verbose --report
```

✅ **Done when:** `import-report.md` is written and you see "Import complete".

---

## Options

| Flag | Description |
|------|-------------|
| `--dry-run` | Preview without uploading |
| `--limit N` | Process first N notes |
| `--folder NAME` | Only import from this folder (case-insensitive) |
| `--account NAME` | Only import from this account, e.g. `--account iCloud` |
| `--after YYYY-MM-DD` | Only notes modified after this date |
| `--no-llm` | Skip LLM chunking — heading splits only |
| `--verbose` | Detailed per-note progress |
| `--report` | Write `import-report.md` summary |

## Re-running

The sync log (`apple-notes-sync-log.json`) tracks imported notes by ID and modification
date. Re-runs skip unchanged notes automatically.

For database-level deduplication, add a unique index:
```sql
ALTER TABLE thoughts ADD COLUMN IF NOT EXISTS content_fingerprint TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS thoughts_content_fingerprint_idx
  ON thoughts (content_fingerprint);
```

## Expected Outcome

Each imported thought has metadata like:
```json
{
  "source": "apple-notes",
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

Filter Apple Notes thoughts in Supabase:
```sql
SELECT content, metadata->>'title', metadata->>'folder'
FROM thoughts
WHERE metadata->>'source' = 'apple-notes'
ORDER BY created_at DESC;
```

## Troubleshooting

**Issue: `notes-export.json` is empty or has only 1 entry**
Solution: Notes.app may not have finished loading. Quit it, reopen, wait 10 seconds, then re-run the extractor. If you only see "On My Mac" notes, check that iCloud sync is enabled in Notes preferences (Notes → Settings → iCloud).

**Issue: Automation permission denied**
Solution: Open **System Settings → Privacy & Security → Automation** and enable your terminal app to control Notes.

**Issue: Password-protected notes are missing**
Solution: Expected — Apple Notes does not expose protected note content via automation. The extractor counts and skips them silently.

**Issue: Import is slow**
Solution: Embedding generation requires one API call per chunk. Use `--limit` to import in batches — the sync log lets you resume where you left off. Use `--no-llm` to skip LLM chunking and halve API calls.

**Issue: Chunks flagged as containing secrets**
Solution: The note contains a string matching a credential pattern. The chunk is skipped and never uploaded. If this is a false positive, open an issue — the scanner patterns are conservative by design.

## See Also

- [MCP Tool Audit & Optimization Guide](../../docs/05-tool-audit.md)
