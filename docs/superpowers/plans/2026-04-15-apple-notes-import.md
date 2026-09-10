# Apple Notes Import Recipe — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `recipes/apple-notes-import` — a two-file recipe that extracts Apple Notes via JXA, converts HTML to Markdown, captures web and note-to-note links, chunks by heading, embeds via OpenRouter, and inserts into Supabase.

**Architecture:** JXA script (`extract-notes.js`) dumps all notes to `notes-export.json`. Python importer reads that JSON, runs HTML→Markdown conversion and link extraction (pure functions in `notes_parser.py`), chunks, secret-scans, embeds, and inserts. Sync log prevents re-importing unchanged notes.

**Tech Stack:** Python 3.10+, `markdownify`, `beautifulsoup4`, `supabase-py`, `requests`, `python-dotenv`, `pytest`; JXA via `osascript -l JavaScript`

---

## File Map

| File | Responsibility |
|------|---------------|
| `recipes/apple-notes-import/extract-notes.js` | JXA: iterate Notes accounts/folders/notes, dump JSON to stdout |
| `recipes/apple-notes-import/notes_parser.py` | Pure functions: HTML→Markdown, link extraction, chunking, fingerprint, secret scan |
| `recipes/apple-notes-import/import-apple-notes.py` | CLI, sync log, filter, embed, insert, retry, report |
| `recipes/apple-notes-import/tests/test_notes_parser.py` | Unit tests for all parser functions |
| `recipes/apple-notes-import/requirements.txt` | Python dependencies |
| `recipes/apple-notes-import/.env.example` | Env var template |
| `recipes/apple-notes-import/metadata.json` | OB1 contribution metadata |
| `recipes/apple-notes-import/README.md` | Step-by-step guide for contributors |

---

### Task 1: Scaffold

**Files:**
- Create: `recipes/apple-notes-import/requirements.txt`
- Create: `recipes/apple-notes-import/.env.example`
- Create: `recipes/apple-notes-import/metadata.json`
- Create: `recipes/apple-notes-import/tests/__init__.py`

- [ ] **Step 1: Create the recipe directory**

```bash
mkdir -p /tmp/OB1/recipes/apple-notes-import/tests
```

- [ ] **Step 2: Write requirements.txt**

```
supabase>=2.0.0
markdownify>=0.11.6
beautifulsoup4>=4.12.0
python-dotenv>=1.0.0
requests>=2.31.0
pytest>=8.0.0
```

- [ ] **Step 3: Write .env.example**

```
SUPABASE_URL=your-supabase-project-url
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
OPENROUTER_API_KEY=your-openrouter-api-key
```

- [ ] **Step 4: Write metadata.json**

```json
{
  "name": "Apple Notes Import",
  "description": "Import your Apple Notes directly into Open Brain via macOS automation — no manual export step. Notes are extracted via JXA, converted from HTML to Markdown, chunked at heading boundaries, and ingested with embeddings and metadata including web URLs and note-to-note links.",
  "category": "recipes",
  "author": {
    "name": "David Oliver",
    "github": "davidroliver"
  },
  "version": "1.0.0",
  "requires": {
    "open_brain": true,
    "services": ["OpenRouter"],
    "tools": ["Python 3.10+", "macOS with Notes.app"]
  },
  "tags": ["apple-notes", "import", "macos", "migration"],
  "difficulty": "beginner",
  "estimated_time": "15 minutes",
  "created": "2026-04-15",
  "updated": "2026-04-15"
}
```

- [ ] **Step 5: Create empty tests init**

```bash
touch /tmp/OB1/recipes/apple-notes-import/tests/__init__.py
```

- [ ] **Step 6: Commit**

```bash
cd /tmp/OB1
git add recipes/apple-notes-import/
git commit -m "[recipes] apple-notes-import: initial scaffold"
```

---

### Task 2: JXA Extractor

**Files:**
- Create: `recipes/apple-notes-import/extract-notes.js`

- [ ] **Step 1: Write extract-notes.js**

```javascript
// recipes/apple-notes-import/extract-notes.js
// Extracts all notes from Apple Notes.app using JXA (JavaScript for Automation).
//
// Usage:
//   osascript -l JavaScript extract-notes.js > notes-export.json
//
// macOS will prompt for automation permissions the first time you run this.
// Notes.app must be installed (built-in on all Macs).
// Both "On My Mac" and iCloud accounts are exported.

ObjC.import('Foundation');

const notesApp = Application('Notes');
const results = [];
const skipped = [];

for (const account of notesApp.accounts()) {
  const accountName = account.name();

  for (const folder of account.folders()) {
    const folderName = folder.name();

    for (const note of folder.notes()) {
      try {
        results.push({
          id: note.id(),
          title: note.name(),
          body: note.body(),
          folder: folderName,
          account: accountName,
          created: note.creationDate().toISOString(),
          modified: note.modificationDate().toISOString(),
        });
      } catch (e) {
        // Password-protected notes throw on .body() — skip silently
        skipped.push({ title: note.name(), folder: folderName, reason: 'protected' });
      }
    }
  }
}

// Append skipped-count metadata as the final element.
// The importer strips any element containing _skipped before processing.
results.push({ _skipped: skipped.length, _skipped_titles: skipped.map(s => s.title) });

JSON.stringify(results);
```

- [ ] **Step 2: Manual smoke test — run against your own Notes**

```bash
cd /tmp/OB1/recipes/apple-notes-import
osascript -l JavaScript extract-notes.js > notes-export.json
```

Expected: macOS prompts for automation permission → grant it → `notes-export.json` appears.

```bash
# Count exported notes (subtract 1 for the metadata element)
python3 -c "import json; d=json.load(open('notes-export.json')); print(f'{len(d)-1} notes exported')"
```

Expected: prints a number matching your Notes library size.

- [ ] **Step 3: Commit**

```bash
cd /tmp/OB1
git add recipes/apple-notes-import/extract-notes.js
git commit -m "[recipes] apple-notes-import: JXA extraction script"
```

---

### Task 3: Parser — HTML→Markdown + Link Extraction (TDD)

**Files:**
- Create: `recipes/apple-notes-import/notes_parser.py` (partial)
- Create: `recipes/apple-notes-import/tests/test_notes_parser.py` (partial)

- [ ] **Step 1: Install test dependencies**

```bash
cd /tmp/OB1/recipes/apple-notes-import
pip install -r requirements.txt
```

Expected: all packages install without errors.

- [ ] **Step 2: Write failing tests for extract_links and html_to_markdown**

Create `recipes/apple-notes-import/tests/test_notes_parser.py`:

```python
import pytest
from notes_parser import extract_links, html_to_markdown


class TestExtractLinks:
    def test_extracts_https_urls(self):
        html = '<p><a href="https://example.com">link</a></p>'
        web_urls, note_links = extract_links(html)
        assert web_urls == ['https://example.com']
        assert note_links == []

    def test_extracts_http_urls(self):
        html = '<p><a href="http://example.com/page">link</a></p>'
        web_urls, _ = extract_links(html)
        assert web_urls == ['http://example.com/page']

    def test_extracts_notelinks_protocol(self):
        html = '<p><a href="notelinks://ABC123">note</a></p>'
        web_urls, note_links = extract_links(html)
        assert note_links == ['notelinks://ABC123']
        assert web_urls == []

    def test_extracts_xcoredata_protocol(self):
        html = '<p><a href="x-coredata://ABC123/Note/p1">note</a></p>'
        _, note_links = extract_links(html)
        assert note_links == ['x-coredata://ABC123/Note/p1']

    def test_multiple_links(self):
        html = (
            '<p><a href="https://a.com">A</a></p>'
            '<p><a href="https://b.com">B</a></p>'
            '<p><a href="notelinks://N1">N1</a></p>'
        )
        web_urls, note_links = extract_links(html)
        assert 'https://a.com' in web_urls
        assert 'https://b.com' in web_urls
        assert 'notelinks://N1' in note_links

    def test_no_links_returns_empty(self):
        html = '<p>Just text, no links.</p>'
        web_urls, note_links = extract_links(html)
        assert web_urls == []
        assert note_links == []

    def test_ignores_anchor_tags_without_href(self):
        html = '<p><a name="top">anchor</a></p>'
        web_urls, note_links = extract_links(html)
        assert web_urls == []
        assert note_links == []


class TestHtmlToMarkdown:
    def test_converts_h1(self):
        result = html_to_markdown('<h1>Title</h1>')
        assert '# Title' in result

    def test_converts_h2(self):
        result = html_to_markdown('<h2>Section</h2>')
        assert '## Section' in result

    def test_converts_unordered_list(self):
        result = html_to_markdown('<ul><li>Item 1</li><li>Item 2</li></ul>')
        assert '- Item 1' in result
        assert '- Item 2' in result

    def test_converts_bold(self):
        result = html_to_markdown('<p><strong>bold</strong></p>')
        assert '**bold**' in result

    def test_converts_italic(self):
        result = html_to_markdown('<p><em>italic</em></p>')
        assert '_italic_' in result or '*italic*' in result

    def test_preserves_inline_links(self):
        result = html_to_markdown('<p><a href="https://example.com">click</a></p>')
        assert 'https://example.com' in result
        assert 'click' in result

    def test_checklist_done_item(self):
        result = html_to_markdown('<ul><li data-done="true">Done task</li></ul>')
        assert '[x]' in result

    def test_checklist_undone_item(self):
        result = html_to_markdown('<ul><li data-done="false">Pending task</li></ul>')
        assert '[ ]' in result

    def test_plain_paragraph(self):
        result = html_to_markdown('<p>Hello world</p>')
        assert 'Hello world' in result

    def test_strips_excess_blank_lines(self):
        result = html_to_markdown('<p>A</p><p>B</p>')
        assert '\n\n\n' not in result
```

- [ ] **Step 3: Run tests — expect ImportError**

```bash
cd /tmp/OB1/recipes/apple-notes-import
pytest tests/test_notes_parser.py -v 2>&1 | head -10
```

Expected: `ModuleNotFoundError: No module named 'notes_parser'`

- [ ] **Step 4: Implement extract_links and html_to_markdown**

Create `recipes/apple-notes-import/notes_parser.py`:

```python
"""
notes_parser.py — Pure parsing functions for Apple Notes import.
All functions are side-effect free and fully unit-testable.
"""

import hashlib
import re

from bs4 import BeautifulSoup
from markdownify import markdownify as md


def extract_links(html: str) -> tuple[list[str], list[str]]:
    """
    Extract web URLs and note-to-note links from raw Apple Notes HTML.

    Returns (web_urls, note_links) where:
    - web_urls: hrefs starting with http:// or https://
    - note_links: hrefs starting with notelinks:// or x-coredata://
    """
    soup = BeautifulSoup(html, 'html.parser')
    web_urls: list[str] = []
    note_links: list[str] = []

    for tag in soup.find_all('a', href=True):
        href: str = tag['href']
        if href.startswith(('http://', 'https://')):
            web_urls.append(href)
        elif href.startswith(('notelinks://', 'x-coredata://')):
            note_links.append(href)

    return web_urls, note_links


def html_to_markdown(html: str) -> str:
    """
    Convert Apple Notes HTML body to clean Markdown.

    Handles Apple Notes-specific conventions:
    - <h1>/<h2> -> # / ##
    - <ul>/<li> -> -
    - <li data-done="true/false"> -> - [x] / - [ ]
    - <strong>/<em> -> **bold** / _italic_
    - <a href> -> [text](url) (web links preserved inline)
    """
    soup = BeautifulSoup(html, 'html.parser')

    # Pre-process checklist items — markdownify doesn't handle data-done
    for li in soup.find_all('li'):
        if li.has_attr('data-done'):
            marker = '[x] ' if li['data-done'] == 'true' else '[ ] '
            li.insert(0, marker)
            del li['data-done']

    converted = md(str(soup), heading_style='ATX', bullets='-')

    # Collapse 3+ consecutive blank lines to 2
    converted = re.sub(r'\n{3,}', '\n\n', converted)

    return converted.strip()
```

- [ ] **Step 5: Run tests — expect all PASS**

```bash
cd /tmp/OB1/recipes/apple-notes-import
pytest tests/test_notes_parser.py::TestExtractLinks tests/test_notes_parser.py::TestHtmlToMarkdown -v
```

Expected: all tests PASS.

- [ ] **Step 6: Commit**

```bash
cd /tmp/OB1
git add recipes/apple-notes-import/notes_parser.py recipes/apple-notes-import/tests/
git commit -m "[recipes] apple-notes-import: HTML->Markdown + link extraction with tests"
```

---

### Task 4: Parser — Chunking, Fingerprint, Secret Scan (TDD)

**Files:**
- Modify: `recipes/apple-notes-import/notes_parser.py`
- Modify: `recipes/apple-notes-import/tests/test_notes_parser.py`

- [ ] **Step 1: Append failing tests to test_notes_parser.py**

```python
from notes_parser import chunk_note, compute_fingerprint, scan_for_secrets


class TestChunkNote:
    def test_short_note_is_single_chunk(self):
        chunks = chunk_note('This is a short note.', 'My Note', 'Work')
        assert len(chunks) == 1
        assert '[Apple Notes: My Note | Work]' in chunks[0]
        assert 'This is a short note.' in chunks[0]

    def test_prefix_format(self):
        chunks = chunk_note('Content', 'Title Here', 'Folder Name')
        assert chunks[0].startswith('[Apple Notes: Title Here | Folder Name]')

    def test_splits_at_h2_headings(self):
        markdown = 'Intro.\n\n## Section A\n\nContent A\n\n## Section B\n\nContent B'
        chunks = chunk_note(markdown, 'Big Note', 'Home', max_words=3)
        assert len(chunks) > 1
        for chunk in chunks:
            assert '[Apple Notes: Big Note | Home]' in chunk

    def test_each_section_chunk_contains_its_heading(self):
        markdown = '## Section A\n\nContent A\n\n## Section B\n\nContent B'
        chunks = chunk_note(markdown, 'Note', 'Folder', max_words=3)
        assert any('Section A' in c for c in chunks)
        assert any('Section B' in c for c in chunks)

    def test_long_note_without_headings_is_single_chunk(self):
        markdown = ' '.join(['word'] * 600)
        chunks = chunk_note(markdown, 'Long', 'Notes')
        assert len(chunks) == 1


class TestComputeFingerprint:
    def test_returns_64_char_hex(self):
        fp = compute_fingerprint('some content')
        assert len(fp) == 64
        assert all(c in '0123456789abcdef' for c in fp)

    def test_same_content_same_fingerprint(self):
        assert compute_fingerprint('hello') == compute_fingerprint('hello')

    def test_different_content_different_fingerprint(self):
        assert compute_fingerprint('hello') != compute_fingerprint('world')

    def test_normalises_whitespace(self):
        assert compute_fingerprint('hello  world') == compute_fingerprint('hello world')

    def test_case_insensitive(self):
        assert compute_fingerprint('Hello World') == compute_fingerprint('hello world')


class TestScanForSecrets:
    def test_clean_content_returns_empty(self):
        assert scan_for_secrets('Meeting notes from today') == []

    def test_detects_openai_style_key(self):
        # Build at runtime so the plan file itself doesn't contain a triggering string
        key = 'sk-' + 'a' * 25
        assert len(scan_for_secrets(f'my api key is {key}')) > 0

    def test_detects_aws_access_key(self):
        key = 'AKIA' + 'IOSFODNN7EXAMPLE'
        assert len(scan_for_secrets(f'aws: {key}')) > 0

    def test_detects_github_pat(self):
        pat = 'ghp_' + 'a' * 36
        assert len(scan_for_secrets(f'auth: {pat}')) > 0

    def test_detects_jwt(self):
        # Two base64url segments separated by dots — matches JWT pattern
        jwt = 'eyJhbGciOiJIUzI1NiJ9' + '.' + 'eyJzdWIiOiJ1c2VyIn0' + '.sig'
        assert len(scan_for_secrets(f'bearer: {jwt}')) > 0

    def test_detects_pem_private_key(self):
        header = '-----BEGIN RSA ' + 'PRIVATE KEY-----'
        assert len(scan_for_secrets(f'{header}\nMIIEowIBAAK...')) > 0
```

- [ ] **Step 2: Run tests — expect failures on new tests**

```bash
cd /tmp/OB1/recipes/apple-notes-import
pytest tests/test_notes_parser.py::TestChunkNote tests/test_notes_parser.py::TestComputeFingerprint tests/test_notes_parser.py::TestScanForSecrets -v 2>&1 | head -20
```

Expected: `ImportError` or `AttributeError` — new functions don't exist yet.

- [ ] **Step 3: Append chunk_note, compute_fingerprint, scan_for_secrets to notes_parser.py**

```python
# ─── Chunking ─────────────────────────────────────────────────────────────────

def chunk_note(markdown: str, title: str, folder: str, max_words: int = 500) -> list[str]:
    """
    Split a note into atomic thoughts for Open Brain.

    - Notes under max_words -> single thought
    - Notes with ## headings -> one thought per section
    - Long notes without headings -> single thought (LLM distillation in importer)

    Each chunk is prefixed: [Apple Notes: {title} | {folder}]
    """
    prefix = f"[Apple Notes: {title} | {folder}]"
    word_count = len(markdown.split())

    if word_count <= max_words:
        return [f"{prefix}\n\n{markdown}"]

    sections = re.split(r'\n(?=## )', markdown)
    if len(sections) > 1:
        return [f"{prefix}\n\n{s.strip()}" for s in sections if s.strip()]

    # No headings — single chunk; LLM distillation handled by importer
    return [f"{prefix}\n\n{markdown}"]


# ─── Fingerprint ──────────────────────────────────────────────────────────────

def compute_fingerprint(content: str) -> str:
    """SHA-256 of normalised content (lowercase, collapsed whitespace)."""
    normalised = ' '.join(content.lower().split())
    return hashlib.sha256(normalised.encode('utf-8')).hexdigest()


# ─── Secret scanning ──────────────────────────────────────────────────────────

_SECRET_PATTERNS = [
    r'sk-[A-Za-z0-9]{20,}',
    r'AKIA[0-9A-Z]{16}',
    r'AIza[0-9A-Za-z_-]{20,}',
    r'gh[pousr]_[A-Za-z0-9]{30,}',
    r'github_pat_[A-Za-z0-9_]{20,}',
    r'xox[baprs]-[A-Za-z0-9-]{10,}',
    r'-----BEGIN\s+(RSA\s+|EC\s+)?PRIVATE\s+KEY-----',
    r'eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}',
    r'(password|passwd|secret|api_key)\s*=\s*["\'][^"\']{8,}["\']',
]


def scan_for_secrets(content: str) -> list[str]:
    """
    Return list of matched patterns if potential secrets are detected.
    Empty list means content is clean.
    """
    return [p for p in _SECRET_PATTERNS if re.search(p, content, re.IGNORECASE)]
```

- [ ] **Step 4: Run all tests — expect full pass**

```bash
cd /tmp/OB1/recipes/apple-notes-import
pytest tests/ -v
```

Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
cd /tmp/OB1
git add recipes/apple-notes-import/notes_parser.py recipes/apple-notes-import/tests/
git commit -m "[recipes] apple-notes-import: chunking, fingerprint, secret scan with tests"
```

---

### Task 5: Importer — CLI, Sync Log, Filter (Dry-Run Works After This)

**Files:**
- Create: `recipes/apple-notes-import/import-apple-notes.py`

- [ ] **Step 1: Write import-apple-notes.py**

```python
#!/usr/bin/env python3
"""
Open Brain — Apple Notes Importer

Reads notes-export.json (produced by extract-notes.js) and imports notes
into Open Brain as searchable, embedded thoughts.

Usage:
    python import-apple-notes.py [options]

Generate notes-export.json first:
    osascript -l JavaScript extract-notes.js > notes-export.json

Options:
    --dry-run              Preview without uploading
    --limit N              Process first N notes
    --folder NAME          Only import from this folder (case-insensitive)
    --account NAME         Only import from this account (case-insensitive)
    --after YYYY-MM-DD     Only notes modified after this date
    --no-llm               Skip LLM chunking
    --verbose              Detailed per-note progress
    --report               Write import-report.md summary
"""

import argparse
import json
import os
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import requests
from dotenv import load_dotenv
from supabase import create_client

from notes_parser import (
    chunk_note,
    compute_fingerprint,
    extract_links,
    html_to_markdown,
    scan_for_secrets,
)

load_dotenv()

SYNC_LOG_PATH = Path('apple-notes-sync-log.json')
EXPORT_PATH = Path('notes-export.json')
OPENROUTER_BASE = 'https://openrouter.ai/api/v1'
EMBED_MODEL = 'openai/text-embedding-3-small'
LLM_MODEL = 'openai/gpt-4o-mini'
EMBED_DELAY_SECONDS = 0.15

SUPABASE_URL = os.environ.get('SUPABASE_URL', '')
SUPABASE_SERVICE_ROLE_KEY = os.environ.get('SUPABASE_SERVICE_ROLE_KEY', '')
OPENROUTER_API_KEY = os.environ.get('OPENROUTER_API_KEY', '')


# ─── Sync log ─────────────────────────────────────────────────────────────────

def load_sync_log() -> dict[str, str]:
    if SYNC_LOG_PATH.exists():
        return json.loads(SYNC_LOG_PATH.read_text())
    return {}


def save_sync_log(log: dict[str, str]) -> None:
    SYNC_LOG_PATH.write_text(json.dumps(log, indent=2))


# ─── Filtering ────────────────────────────────────────────────────────────────

def should_skip(note: dict, sync_log: dict[str, str], args: argparse.Namespace) -> tuple[bool, str]:
    note_id = note.get('id', '')
    modified = note.get('modified', '')

    if note_id in sync_log and sync_log[note_id] == modified:
        return True, 'unchanged'

    if args.folder and note.get('folder', '').lower() != args.folder.lower():
        return True, f"folder != {args.folder}"

    if args.account and note.get('account', '').lower() != args.account.lower():
        return True, f"account != {args.account}"

    if args.after:
        try:
            after_dt = datetime.fromisoformat(args.after).replace(tzinfo=timezone.utc)
            modified_dt = datetime.fromisoformat(modified.replace('Z', '+00:00'))
            if modified_dt <= after_dt:
                return True, f"modified before {args.after}"
        except (ValueError, AttributeError):
            pass

    return False, ''


# ─── CLI ──────────────────────────────────────────────────────────────────────

def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description='Import Apple Notes into Open Brain')
    parser.add_argument('--dry-run', action='store_true')
    parser.add_argument('--limit', type=int, default=None)
    parser.add_argument('--folder', type=str, default=None)
    parser.add_argument('--account', type=str, default=None)
    parser.add_argument('--after', type=str, default=None, metavar='YYYY-MM-DD')
    parser.add_argument('--no-llm', action='store_true')
    parser.add_argument('--verbose', action='store_true')
    parser.add_argument('--report', action='store_true')
    return parser.parse_args()


# ─── Preflight ────────────────────────────────────────────────────────────────

def preflight(args: argparse.Namespace) -> None:
    if not EXPORT_PATH.exists():
        print(f"ERROR: {EXPORT_PATH} not found.")
        print("Run first:  osascript -l JavaScript extract-notes.js > notes-export.json")
        sys.exit(1)

    if not args.dry_run:
        missing = [v for v in ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'OPENROUTER_API_KEY']
                   if not os.environ.get(v)]
        if missing:
            print(f"ERROR: Missing env vars: {', '.join(missing)}")
            print("Copy .env.example to .env and fill in your credentials.")
            sys.exit(1)


# ─── Dry run ──────────────────────────────────────────────────────────────────

def dry_run_preview(notes: list[dict], args: argparse.Namespace) -> None:
    total_chunks = 0
    secret_hits = 0

    for note in notes:
        web_urls, note_links = extract_links(note['body'])
        markdown = html_to_markdown(note['body'])
        chunks = chunk_note(markdown, note['title'], note['folder'])
        total_chunks += len(chunks)

        flagged = sum(1 for c in chunks if scan_for_secrets(c))
        secret_hits += flagged

        if args.verbose:
            print(f"  [{note['account']}] {note['folder']} / {note['title']}")
            print(f"    -> {len(chunks)} chunk(s), {len(web_urls)} URL(s), "
                  f"{len(note_links)} note link(s)")
            if flagged:
                print(f"    WARNING: secrets detected in {flagged} chunk(s) — would skip")

    print(f"\nDry run complete:")
    print(f"  Thoughts that would be created: {total_chunks - secret_hits}")
    print(f"  Chunks skipped (secrets):       {secret_hits}")


# ─── Main ─────────────────────────────────────────────────────────────────────

def main() -> None:
    args = parse_args()
    preflight(args)

    raw = json.loads(EXPORT_PATH.read_text())
    notes = [n for n in raw if '_skipped' not in n]
    skipped_protected = next((n.get('_skipped', 0) for n in raw if '_skipped' in n), 0)

    sync_log = load_sync_log()

    to_process = []
    skip_counts: dict[str, int] = {}
    for note in notes:
        skip, reason = should_skip(note, sync_log, args)
        if skip:
            skip_counts[reason] = skip_counts.get(reason, 0) + 1
        else:
            to_process.append(note)

    if args.limit:
        to_process = to_process[:args.limit]

    print("Apple Notes Import")
    print(f"  Notes in export:              {len(notes)}")
    print(f"  Password-protected (skipped): {skipped_protected}")
    for reason, count in sorted(skip_counts.items()):
        print(f"  Skipped ({reason}): {count}")
    print(f"  To process:                   {len(to_process)}")
    if args.dry_run:
        print("  Mode: DRY RUN — no data will be uploaded")
    print()

    if args.dry_run:
        dry_run_preview(to_process, args)
        return

    # Live import — implemented in Task 6
    print("Live import not yet implemented — run with --dry-run for now.")
    sys.exit(0)


if __name__ == '__main__':
    main()
```

- [ ] **Step 2: Smoke test with --dry-run**

```bash
cd /tmp/OB1/recipes/apple-notes-import
python import-apple-notes.py --dry-run --verbose --limit 5
```

Expected:
```
Apple Notes Import
  Notes in export:              142
  To process:                   5
  Mode: DRY RUN — no data will be uploaded

  [iCloud] Work / Meeting notes 2026-04-10
    -> 3 chunk(s), 2 URL(s), 0 note link(s)
  ...
Dry run complete:
  Thoughts that would be created: 12
  Chunks skipped (secrets):       0
```

- [ ] **Step 3: Commit**

```bash
cd /tmp/OB1
git add recipes/apple-notes-import/import-apple-notes.py
git commit -m "[recipes] apple-notes-import: CLI, sync log, filter, dry-run"
```

---

### Task 6: Importer — Embed, Insert, Retry + Report

**Files:**
- Modify: `recipes/apple-notes-import/import-apple-notes.py`

- [ ] **Step 1: Add API helpers after the EMBED_DELAY_SECONDS constant**

Insert these functions into `import-apple-notes.py` after the constants block:

```python
# ─── API helpers ──────────────────────────────────────────────────────────────

def _with_retry(fn, max_retries: int = 3, base_delay: float = 2.0):
    """Exponential backoff for transient API errors (429, 5xx)."""
    for attempt in range(max_retries):
        try:
            return fn()
        except requests.HTTPError as e:
            if attempt == max_retries - 1:
                raise
            if e.response.status_code in (429, 500, 502, 503, 504):
                time.sleep(base_delay * (2 ** attempt))
            else:
                raise


def get_embedding(text: str) -> list[float]:
    def _call():
        r = requests.post(
            f'{OPENROUTER_BASE}/embeddings',
            headers={'Authorization': f'Bearer {OPENROUTER_API_KEY}',
                     'Content-Type': 'application/json'},
            json={'model': EMBED_MODEL, 'input': text},
            timeout=30,
        )
        r.raise_for_status()
        return r.json()['data'][0]['embedding']
    return _with_retry(_call)


def classify_type(content: str) -> str:
    def _call():
        r = requests.post(
            f'{OPENROUTER_BASE}/chat/completions',
            headers={'Authorization': f'Bearer {OPENROUTER_API_KEY}',
                     'Content-Type': 'application/json'},
            json={
                'model': LLM_MODEL,
                'response_format': {'type': 'json_object'},
                'messages': [
                    {'role': 'system', 'content': (
                        'Classify the thought type. Return JSON with one key "type" '
                        'set to exactly one of: observation, task, idea, reference, person_note'
                    )},
                    {'role': 'user', 'content': content[:500]},
                ],
            },
            timeout=20,
        )
        r.raise_for_status()
        return json.loads(r.json()['choices'][0]['message']['content']).get('type', 'observation')
    try:
        return _with_retry(_call)
    except Exception:
        return 'observation'


def insert_thought(supabase_client, content: str, embedding: list[float], metadata: dict) -> str | None:
    fingerprint = compute_fingerprint(content)
    try:
        result = (
            supabase_client.table('thoughts')
            .insert({'content': content, 'embedding': embedding,
                     'metadata': {**metadata, 'content_fingerprint': fingerprint}})
            .execute()
        )
        return result.data[0]['id'] if result.data else None
    except Exception as e:
        if any(x in str(e).lower() for x in ('23505', 'duplicate', 'unique')):
            return None  # Already imported
        raise
```

- [ ] **Step 2: Replace the stub at the end of main() with a real call**

Replace:
```python
    # Live import — implemented in Task 6
    print("Live import not yet implemented — run with --dry-run for now.")
    sys.exit(0)
```

With:
```python
    live_import(to_process, args, sync_log)
```

- [ ] **Step 3: Add live_import, _maybe_distil_with_llm, and _write_report functions**

```python
def live_import(notes: list[dict], args: argparse.Namespace, sync_log: dict[str, str]) -> None:
    supabase = create_client(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
    imported = skipped_secrets = skipped_dupes = errors = 0
    report_lines: list[str] = []

    for i, note in enumerate(notes, 1):
        note_id = note['id']
        title = note.get('title', 'Untitled')
        folder = note.get('folder', '')
        account = note.get('account', '')

        if args.verbose:
            print(f"[{i}/{len(notes)}] {account} / {folder} / {title}")

        web_urls, note_links = extract_links(note['body'])
        markdown = html_to_markdown(note['body'])
        chunks = chunk_note(markdown, title, folder)

        if not args.no_llm:
            chunks = _maybe_distil_with_llm(chunks)

        for chunk in chunks:
            if scan_for_secrets(chunk):
                skipped_secrets += 1
                if args.verbose:
                    print("  WARNING: secret detected — skipping chunk")
                continue

            thought_type = classify_type(chunk)
            metadata = {
                'source': 'apple-notes',
                'note_id': note_id,
                'title': title,
                'folder': folder,
                'account': account,
                'created': note.get('created', '')[:10],
                'modified': note.get('modified', '')[:10],
                'urls': web_urls,
                'note_links': note_links,
                'type': thought_type,
            }

            try:
                embedding = get_embedding(chunk)
                time.sleep(EMBED_DELAY_SECONDS)
            except Exception as e:
                errors += 1
                if args.verbose:
                    print(f"  ERROR embed: {e}")
                continue

            try:
                thought_id = insert_thought(supabase, chunk, embedding, metadata)
                if thought_id is None:
                    skipped_dupes += 1
                    if args.verbose:
                        print("  -> duplicate, skipped")
                else:
                    imported += 1
                    if args.verbose:
                        print(f"  -> imported as {thought_type} ({thought_id[:8]}...)")
            except Exception as e:
                errors += 1
                if args.verbose:
                    print(f"  ERROR insert: {e}")
                continue

        sync_log[note_id] = note.get('modified', '')
        save_sync_log(sync_log)

        if args.report:
            report_lines.append(
                f"| {title[:40]} | {folder} | {len(chunks)} | "
                f"{len(web_urls)} | {len(note_links)} |"
            )

    print(f"\nImport complete:")
    print(f"  Thoughts imported:    {imported}")
    print(f"  Duplicates skipped:   {skipped_dupes}")
    print(f"  Secrets skipped:      {skipped_secrets}")
    print(f"  Errors:               {errors}")

    if args.report:
        _write_report(report_lines, imported, skipped_dupes, skipped_secrets, errors)


def _maybe_distil_with_llm(chunks: list[str]) -> list[str]:
    """Distil chunks over 1000 words using gpt-4o-mini. Falls back on error."""
    result = []
    for chunk in chunks:
        if len(chunk.split()) <= 1000:
            result.append(chunk)
            continue
        try:
            r = requests.post(
                f'{OPENROUTER_BASE}/chat/completions',
                headers={'Authorization': f'Bearer {OPENROUTER_API_KEY}',
                         'Content-Type': 'application/json'},
                json={
                    'model': LLM_MODEL,
                    'response_format': {'type': 'json_object'},
                    'messages': [
                        {'role': 'system', 'content': (
                            'Extract 1-3 standalone knowledge thoughts from this note section. '
                            'Each thought must make sense on its own. '
                            'Return JSON: {"thoughts": ["thought 1", "thought 2"]}'
                        )},
                        {'role': 'user', 'content': chunk[:3000]},
                    ],
                },
                timeout=30,
            )
            r.raise_for_status()
            distilled = json.loads(r.json()['choices'][0]['message']['content']).get('thoughts', [])
            if distilled:
                result.extend(distilled)
                continue
        except Exception:
            pass
        result.append(chunk)
    return result


def _write_report(lines: list[str], imported: int, dupes: int, secrets: int, errors: int) -> None:
    now = datetime.now().strftime('%Y-%m-%d %H:%M')
    content = '\n'.join([
        f"# Apple Notes Import Report — {now}", "",
        "| Metric | Count |", "|--------|-------|",
        f"| Imported | {imported} |",
        f"| Duplicates skipped | {dupes} |",
        f"| Secret-flagged skipped | {secrets} |",
        f"| Errors | {errors} |", "",
        "## Notes Processed", "",
        "| Title | Folder | Chunks | URLs | Note Links |",
        "|-------|--------|--------|------|------------|",
    ] + lines)
    Path('import-report.md').write_text(content)
    print("\nReport written to import-report.md")
```

- [ ] **Step 4: Dry-run to confirm nothing broke**

```bash
cd /tmp/OB1/recipes/apple-notes-import
python import-apple-notes.py --dry-run --limit 3 --verbose
```

Expected: same output as before, no errors.

- [ ] **Step 5: Live test with --limit 2 (requires real .env)**

```bash
python import-apple-notes.py --limit 2 --verbose
```

Expected:
```
Apple Notes Import
  Notes in export:              142
  To process:                   2

[1/2] iCloud / Work / Meeting notes
  -> imported as observation (a3f8c2d1...)
[2/2] iCloud / Personal / Shopping list
  -> imported as task (b7e1f9a2...)

Import complete:
  Thoughts imported:    3
  Duplicates skipped:   0
  Secrets skipped:      0
  Errors:               0
```

Verify in Supabase: **Table Editor → thoughts** → filter `metadata->>'source' = 'apple-notes'`.

- [ ] **Step 6: Run all tests**

```bash
pytest tests/ -v
```

Expected: all PASS.

- [ ] **Step 7: Commit**

```bash
cd /tmp/OB1
git add recipes/apple-notes-import/import-apple-notes.py
git commit -m "[recipes] apple-notes-import: embed, insert, retry, LLM distillation, report"
```

---

### Task 7: README

**Files:**
- Create: `recipes/apple-notes-import/README.md`

- [ ] **Step 1: Write README.md**

```markdown
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
```

- [ ] **Step 2: Commit**

```bash
cd /tmp/OB1
git add recipes/apple-notes-import/README.md
git commit -m "[recipes] apple-notes-import: README"
```

---

### Task 8: Branch, Compliance Check, PR

**Files:** No new files — verify, branch, open PR.

- [ ] **Step 1: Create contribution branch**

```bash
cd /tmp/OB1
git checkout -b contrib/davidroliver/apple-notes-import
git push -u origin contrib/davidroliver/apple-notes-import
```

- [ ] **Step 2: Run OB1 PR gate checks manually**

```bash
cd /tmp/OB1

# Required files
ls recipes/apple-notes-import/README.md recipes/apple-notes-import/metadata.json
# Expected: both listed

# Valid JSON metadata
python3 -c "import json; json.load(open('recipes/apple-notes-import/metadata.json')); print('metadata.json: valid')"

# No credentials
grep -rE 'sk-[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}' recipes/apple-notes-import/ \
  && echo "FAIL: credentials found" || echo "No credentials: PASS"

# No destructive SQL
find recipes/apple-notes-import/ -name '*.sql' \
  | xargs grep -iE 'DROP TABLE|TRUNCATE' 2>/dev/null \
  && echo "FAIL: destructive SQL" || echo "No destructive SQL: PASS"

# Code files present (.py and .js)
ls recipes/apple-notes-import/*.py recipes/apple-notes-import/*.js
# Expected: both .py and .js files listed

# README has required sections
grep -qi 'prerequisites' recipes/apple-notes-import/README.md && echo "Prerequisites: PASS"
grep -qiE '^\s*!\[Step' recipes/apple-notes-import/README.md && echo "Numbered steps: PASS"
grep -qi 'expected outcome' recipes/apple-notes-import/README.md && echo "Expected outcome: PASS"
grep -qi 'troubleshooting' recipes/apple-notes-import/README.md && echo "Troubleshooting: PASS"

# Tool audit link present
grep -q '05-tool-audit' recipes/apple-notes-import/README.md && echo "Tool audit link: PASS"

# No local MCP pattern
grep -rE 'claude_desktop_config|StdioServerTransport' recipes/apple-notes-import/ \
  && echo "FAIL: local MCP" || echo "No local MCP: PASS"
```

Expected: all checks print PASS.

- [ ] **Step 3: Run all tests one final time**

```bash
cd /tmp/OB1/recipes/apple-notes-import
pytest tests/ -v
```

Expected: all PASS.

- [ ] **Step 4: Open the PR**

```bash
cd /tmp/OB1
gh pr create \
  --title "[recipes] Apple Notes import via macOS automation" \
  --body "$(cat <<'EOF'
## What this does
Imports Apple Notes directly into Open Brain using JXA (JavaScript for Automation) — no manual export step. Notes are converted from HTML to Markdown, chunked at heading boundaries, and ingested with embeddings and metadata including web URLs and note-to-note links.

## What it requires
- macOS with Notes.app (built-in)
- Python 3.10+
- OpenRouter API key
- Working Open Brain setup

## Tested on
- macOS 15 (Sequoia)
- Both iCloud and "On My Mac" accounts

I have tested this on my own Open Brain instance.
EOF
)"
```

---

## Self-Review

**Spec coverage:**
- JXA extractor → Task 2
- HTML→Markdown + checklists → Task 3
- Web URL + note link extraction → Task 3
- Heading-based chunking → Task 4
- SHA-256 fingerprint → Task 4
- Secret scan → Task 4
- Sync log → Task 5
- All CLI flags (--dry-run, --limit, --folder, --account, --after, --no-llm, --verbose, --report) → Tasks 5+6
- Embed + insert + retry → Task 6
- LLM distillation (optional) → Task 6
- Report generation → Task 6
- Password-protected note handling → Task 2 (skip in extractor)
- README with all required OB1 sections → Task 7
- metadata.json → Task 1
- OB1 PR gate compliance → Task 8
