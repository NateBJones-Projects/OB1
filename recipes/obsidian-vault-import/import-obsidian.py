#!/usr/bin/env python3
"""
import-obsidian.py — Import an Obsidian vault into Open Brain as searchable thoughts.

Parses markdown files with frontmatter, chunks long notes into atomic thoughts,
generates embeddings via OpenRouter, and inserts into Supabase.

Usage:
  python import-obsidian.py /path/to/vault
  python import-obsidian.py /path/to/vault --dry-run
  python import-obsidian.py /path/to/vault --limit 20 --verbose

Parsing logic adapted from the OpenBrainBeta MCP server (vaultprime_build.py),
battle-tested on 4,600+ Obsidian notes.
"""

import argparse
import hashlib
import json
import os
import re
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

try:
    import frontmatter
except ImportError:
    print("Missing dependency: python-frontmatter")
    print("Run: pip install -r requirements.txt")
    sys.exit(1)

try:
    import requests
except ImportError:
    print("Missing dependency: requests")
    print("Run: pip install -r requirements.txt")
    sys.exit(1)


# ── Config ───────────────────────────────────────────────────────────────────

# Folders always skipped (Obsidian internals)
ALWAYS_SKIP = {".obsidian", ".trash", ".git", "node_modules"}

# Default minimum word count to include a note
DEFAULT_MIN_WORDS = 50

# Chunking thresholds
WHOLE_NOTE_THRESHOLD = 500      # notes under this word count → 1 thought
LLM_CHUNK_THRESHOLD = 1000     # sections over this → LLM distillation

# Embedding model
EMBEDDING_MODEL = "openai/text-embedding-3-small"
EMBEDDING_DIMS = 1536

# LLM model for chunking long sections
LLM_MODEL = "openai/gpt-4o-mini"

# API retry settings
MAX_RETRIES = 3
RETRY_BACKOFF = 2  # seconds, doubles each retry

# Summarization prompt for long sections
SUMMARIZATION_PROMPT = """You are extracting atomic thoughts from an Obsidian note section.

Given the following section from a note titled "{title}", distill it into 1-3 standalone thoughts.
Each thought must make sense to someone with ZERO prior context — not compressed notes, but full
standalone statements.

Rules:
- Each thought should capture ONE distinct idea, fact, or insight
- Include relevant context (who, what, when) so the thought stands alone
- Keep each thought under 300 words
- Return valid JSON: {{"thoughts": ["thought 1 text", "thought 2 text"]}}

Section content:
{content}"""


# ── Obsidian Parsing (from vaultprime_build.py) ─────────────────────────────

WIKILINK_RE = re.compile(r'\[\[([^\]|#]+?)(?:\|[^\]]+)?\]\]')
INLINE_TAG_RE = re.compile(r'(?<!\w)#([A-Za-z0-9_/-]+)')
HEADING_RE = re.compile(r'^(#{1,6})\s+(.+)$', re.MULTILINE)

# Patterns to strip before inline tag extraction (avoid false positives)
_CODE_FENCE_RE = re.compile(r'```[\s\S]*?```')
_INLINE_CODE_RE = re.compile(r'`[^`]+`')
_HTML_COMMENT_RE = re.compile(r'<!--[\s\S]*?-->')
_HTML_TAG_RE = re.compile(r'<[^>]+>')


def _strip_non_tag_regions(text: str) -> str:
    """Remove code blocks, inline code, HTML comments, and HTML tags."""
    text = _CODE_FENCE_RE.sub('', text)
    text = _INLINE_CODE_RE.sub('', text)
    text = _HTML_COMMENT_RE.sub('', text)
    text = _HTML_TAG_RE.sub('', text)
    return text


def iter_notes(vault_root: Path, skip_folders: set):
    """Yield (full_path, relative_path, folder, title) for every .md file."""
    all_skip = ALWAYS_SKIP | skip_folders
    for root, dirs, files in os.walk(vault_root):
        dirs[:] = [d for d in dirs if d not in all_skip and not d.startswith('.')]
        for fname in sorted(files):
            if not fname.endswith('.md'):
                continue
            full = Path(root) / fname
            rel = full.relative_to(vault_root)
            folder = str(rel.parent) if str(rel.parent) != '.' else ''
            title = fname[:-3]
            yield full, str(rel), folder, title


def parse_note(path: Path):
    """Return (metadata_dict, body_text, wikilinks, inline_tags)."""
    try:
        post = frontmatter.load(str(path))
        meta = dict(post.metadata)
        body = post.content
    except Exception:
        meta = {}
        try:
            body = path.read_text(errors='replace')
        except Exception:
            body = ''

    # Extract wikilinks from body + frontmatter values
    wikilinks = WIKILINK_RE.findall(body)
    for v in meta.values():
        if isinstance(v, str):
            wikilinks += WIKILINK_RE.findall(v)
        elif isinstance(v, list):
            for item in v:
                if isinstance(item, str):
                    wikilinks += WIKILINK_RE.findall(item)
    wikilinks = list(dict.fromkeys(w.strip() for w in wikilinks))

    # Extract inline tags with false-positive stripping
    clean_body = _strip_non_tag_regions(body)
    inline_tags = list(dict.fromkeys(INLINE_TAG_RE.findall(clean_body)))

    return meta, body, wikilinks, inline_tags


def extract_date(meta: dict, path: Path) -> str:
    """Extract date from frontmatter or file mtime. Returns ISO date string."""
    for key in ('date', 'created', 'created_at', 'date_created'):
        val = meta.get(key)
        if val:
            if isinstance(val, datetime):
                return val.strftime('%Y-%m-%d')
            s = str(val).strip()[:10]
            # Basic validation: looks like YYYY-MM-DD
            if re.match(r'^\d{4}-\d{2}-\d{2}$', s):
                return s
    # Fallback to file modification time
    try:
        mtime = path.stat().st_mtime
        return datetime.fromtimestamp(mtime, tz=timezone.utc).strftime('%Y-%m-%d')
    except Exception:
        return datetime.now(tz=timezone.utc).strftime('%Y-%m-%d')


def word_count(text: str) -> int:
    return len(text.split())


# ── Chunking ─────────────────────────────────────────────────────────────────

def chunk_by_headings(body: str, title: str) -> list[dict]:
    """Split note body on ## headings. Returns list of {section, content}."""
    # Find all headings
    parts = re.split(r'^(#{1,6}\s+.+)$', body, flags=re.MULTILINE)

    chunks = []
    current_section = title  # content before first heading
    current_content = []

    for part in parts:
        heading_match = re.match(r'^#{1,6}\s+(.+)$', part.strip())
        if heading_match:
            # Save previous section if it has content
            text = '\n'.join(current_content).strip()
            if text and word_count(text) > 10:
                chunks.append({'section': current_section, 'content': text})
            current_section = heading_match.group(1).strip()
            current_content = []
        else:
            current_content.append(part)

    # Save last section
    text = '\n'.join(current_content).strip()
    if text and word_count(text) > 10:
        chunks.append({'section': current_section, 'content': text})

    return chunks


def chunk_note(note: dict, use_llm: bool, openrouter_key: str,
               verbose: bool = False) -> list[dict]:
    """Chunk a parsed note into atomic thoughts.

    Returns list of dicts: {content, section, was_llm_chunked}
    """
    body = note['body']
    title = note['title']
    wc = word_count(body)

    # Short note → one thought
    if wc <= WHOLE_NOTE_THRESHOLD:
        return [{'content': body.strip(), 'section': None, 'was_llm_chunked': False}]

    # Has headings → split on them
    chunks = chunk_by_headings(body, title)

    # If no headings produced useful chunks, treat as single thought
    if len(chunks) <= 1:
        return [{'content': body.strip(), 'section': None, 'was_llm_chunked': False}]

    # Process each chunk — LLM fallback for long sections
    results = []
    for chunk in chunks:
        if word_count(chunk['content']) > LLM_CHUNK_THRESHOLD and use_llm and openrouter_key:
            if verbose:
                print(f"    LLM chunking section: {chunk['section']} "
                      f"({word_count(chunk['content'])} words)")
            llm_thoughts = llm_distill(title, chunk['content'], openrouter_key)
            for thought in llm_thoughts:
                results.append({
                    'content': thought,
                    'section': chunk['section'],
                    'was_llm_chunked': True,
                })
        else:
            results.append({
                'content': chunk['content'],
                'section': chunk['section'],
                'was_llm_chunked': False,
            })

    return results


def llm_distill(title: str, content: str, api_key: str) -> list[str]:
    """Use LLM to distill a long section into 1-3 atomic thoughts."""
    # Truncate content to avoid token limits
    if len(content) > 8000:
        content = content[:8000] + "\n[... truncated]"

    prompt = SUMMARIZATION_PROMPT.format(title=title, content=content)

    for attempt in range(MAX_RETRIES):
        try:
            resp = requests.post(
                "https://openrouter.ai/api/v1/chat/completions",
                headers={
                    "Authorization": f"Bearer {api_key}",
                    "Content-Type": "application/json",
                },
                json={
                    "model": LLM_MODEL,
                    "messages": [{"role": "user", "content": prompt}],
                    "temperature": 0.3,
                    "response_format": {"type": "json_object"},
                },
                timeout=30,
            )
            resp.raise_for_status()
            data = resp.json()
            text = data["choices"][0]["message"]["content"]
            parsed = json.loads(text)
            thoughts = parsed.get("thoughts", [])
            if thoughts and isinstance(thoughts, list):
                return [t for t in thoughts if isinstance(t, str) and t.strip()]
        except (requests.RequestException, json.JSONDecodeError, KeyError) as e:
            if attempt < MAX_RETRIES - 1:
                wait = RETRY_BACKOFF * (2 ** attempt)
                print(f"    LLM retry in {wait}s: {e}")
                time.sleep(wait)
            else:
                print(f"    LLM failed after {MAX_RETRIES} attempts, using raw content")

    # Fallback: return content as-is
    return [content.strip()]


# ── Embeddings ───────────────────────────────────────────────────────────────

def generate_embedding(text: str, api_key: str) -> list[float] | None:
    """Generate embedding via OpenRouter."""
    for attempt in range(MAX_RETRIES):
        try:
            resp = requests.post(
                "https://openrouter.ai/api/v1/embeddings",
                headers={
                    "Authorization": f"Bearer {api_key}",
                    "Content-Type": "application/json",
                },
                json={
                    "model": EMBEDDING_MODEL,
                    "input": text[:8000],  # respect token limits
                },
                timeout=30,
            )
            resp.raise_for_status()
            data = resp.json()
            return data["data"][0]["embedding"]
        except (requests.RequestException, KeyError, IndexError) as e:
            if attempt < MAX_RETRIES - 1:
                wait = RETRY_BACKOFF * (2 ** attempt)
                time.sleep(wait)
            else:
                print(f"  Embedding failed: {e}")
                return None
    return None


# ── Supabase ─────────────────────────────────────────────────────────────────

def insert_thought(content: str, embedding: list[float] | None, metadata: dict,
                   supabase_url: str, supabase_key: str,
                   created_at: str | None = None) -> bool:
    """Insert a thought into the Supabase thoughts table."""
    payload = {
        "content": content,
        "metadata": metadata,
    }
    if embedding:
        payload["embedding"] = embedding
    if created_at:
        payload["created_at"] = created_at

    for attempt in range(MAX_RETRIES):
        try:
            resp = requests.post(
                f"{supabase_url}/rest/v1/thoughts",
                headers={
                    "apikey": supabase_key,
                    "Authorization": f"Bearer {supabase_key}",
                    "Content-Type": "application/json",
                    "Prefer": "return=minimal",
                },
                json=payload,
                timeout=15,
            )
            resp.raise_for_status()
            return True
        except requests.RequestException as e:
            if attempt < MAX_RETRIES - 1:
                status = getattr(e.response, 'status_code', None) if hasattr(e, 'response') else None
                if status in (429, 500, 502, 503, 504):
                    wait = RETRY_BACKOFF * (2 ** attempt)
                    time.sleep(wait)
                    continue
            print(f"  Insert failed: {e}")
            return False
    return False


# ── Sync Log ─────────────────────────────────────────────────────────────────

SYNC_LOG_FILE = "obsidian-sync-log.json"


def load_sync_log(recipe_dir: Path) -> dict:
    log_path = recipe_dir / SYNC_LOG_FILE
    if log_path.exists():
        try:
            return json.loads(log_path.read_text())
        except Exception:
            pass
    return {"vault_path": "", "last_run": "", "notes": {}}


def save_sync_log(recipe_dir: Path, log: dict):
    log_path = recipe_dir / SYNC_LOG_FILE
    log_path.write_text(json.dumps(log, indent=2))


def content_hash(body: str) -> str:
    return hashlib.sha256(body.encode()).hexdigest()[:16]


# ── Main Pipeline ────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(
        description="Import an Obsidian vault into Open Brain as searchable thoughts."
    )
    parser.add_argument("vault_path", help="Path to the Obsidian vault root directory")
    parser.add_argument("--dry-run", action="store_true",
                        help="Preview what would be imported without inserting")
    parser.add_argument("--limit", type=int, default=0,
                        help="Process only the first N notes (0 = all)")
    parser.add_argument("--min-words", type=int, default=DEFAULT_MIN_WORDS,
                        help=f"Skip notes with fewer than N words (default: {DEFAULT_MIN_WORDS})")
    parser.add_argument("--skip-folders", type=str, default="",
                        help="Comma-separated additional folder names to skip")
    parser.add_argument("--after", type=str, default="",
                        help="Only import notes modified after this date (YYYY-MM-DD)")
    parser.add_argument("--no-llm", action="store_true",
                        help="Disable LLM chunking (heading splits only, no API cost)")
    parser.add_argument("--no-embed", action="store_true",
                        help="Skip embedding generation (insert thoughts without vectors)")
    parser.add_argument("--verbose", action="store_true",
                        help="Show detailed progress")
    parser.add_argument("--report", action="store_true",
                        help="Generate a markdown summary report")
    args = parser.parse_args()

    vault_root = Path(args.vault_path).expanduser().resolve()
    if not vault_root.is_dir():
        print(f"Error: vault not found at {vault_root}", file=sys.stderr)
        sys.exit(1)
    if not (vault_root / ".obsidian").is_dir():
        print(f"Warning: {vault_root} doesn't have a .obsidian/ folder — "
              "are you sure this is an Obsidian vault?", file=sys.stderr)

    # Load env vars
    env_file = Path(__file__).parent / ".env"
    if env_file.exists():
        for line in env_file.read_text().splitlines():
            line = line.strip()
            if line and not line.startswith('#') and '=' in line:
                key, _, value = line.partition('=')
                os.environ.setdefault(key.strip(), value.strip())

    supabase_url = os.environ.get("SUPABASE_URL", "")
    supabase_key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
    openrouter_key = os.environ.get("OPENROUTER_API_KEY", "")

    if not args.dry_run:
        if not supabase_url or not supabase_key:
            print("Error: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY required", file=sys.stderr)
            print("Set them in .env or as environment variables", file=sys.stderr)
            sys.exit(1)
        if not openrouter_key and not args.no_embed:
            print("Error: OPENROUTER_API_KEY required for embeddings", file=sys.stderr)
            print("Or use --no-embed to skip embedding generation", file=sys.stderr)
            sys.exit(1)

    use_llm = not args.no_llm and bool(openrouter_key)

    # Parse skip folders
    skip_folders = set()
    if args.skip_folders:
        skip_folders = {f.strip() for f in args.skip_folders.split(",") if f.strip()}

    # Parse --after date
    after_ts = 0.0
    if args.after:
        try:
            after_ts = datetime.strptime(args.after, "%Y-%m-%d").replace(
                tzinfo=timezone.utc
            ).timestamp()
        except ValueError:
            print(f"Error: invalid date format '{args.after}', use YYYY-MM-DD",
                  file=sys.stderr)
            sys.exit(1)

    # Load sync log
    recipe_dir = Path(__file__).parent
    sync_log = load_sync_log(recipe_dir)

    print(f"Vault:    {vault_root}")
    print(f"Mode:     {'DRY RUN' if args.dry_run else 'LIVE IMPORT'}")
    if use_llm:
        print(f"Chunking: hybrid (headings + LLM fallback)")
    else:
        print(f"Chunking: headings only (--no-llm)")
    print()

    # ── Stage 1+2: Walk + Parse ──────────────────────────────────────────────

    print("Scanning vault...")
    notes = []
    parse_errors = 0

    for full_path, rel_path, folder, title in iter_notes(vault_root, skip_folders):
        try:
            meta, body, wikilinks, inline_tags = parse_note(full_path)
        except Exception as e:
            parse_errors += 1
            if parse_errors <= 5:
                print(f"  Parse error: {rel_path}: {e}")
            continue

        # Normalize tags from frontmatter
        raw_tags = meta.get('tags', [])
        if isinstance(raw_tags, str):
            raw_tags = [raw_tags]
        tags = [str(t) for t in (raw_tags or [])]

        # Combine frontmatter + inline tags
        all_tags = list(dict.fromkeys(tags + inline_tags))

        try:
            mtime = full_path.stat().st_mtime
        except Exception:
            mtime = 0.0

        notes.append({
            'title': title,
            'path': rel_path,
            'folder': folder,
            'body': body,
            'tags': all_tags,
            'wikilinks': wikilinks,
            'meta': meta,
            'mtime': mtime,
            'full_path': full_path,
        })

    print(f"  Found {len(notes)} notes ({parse_errors} parse errors)")

    # ── Stage 3: Filter ──────────────────────────────────────────────────────

    filtered = []
    skip_reasons = {"short": 0, "duplicate": 0, "date_filter": 0, "template": 0}

    for note in notes:
        # Skip short notes
        if word_count(note['body']) < args.min_words:
            skip_reasons["short"] += 1
            continue

        # Skip if already imported with same content
        c_hash = content_hash(note['body'])
        existing = sync_log.get("notes", {}).get(note['path'])
        if existing and existing.get("content_hash") == c_hash:
            skip_reasons["duplicate"] += 1
            continue

        # Skip by date
        if after_ts and note['mtime'] < after_ts:
            skip_reasons["date_filter"] += 1
            continue

        # Skip template files (heuristic: in Templates/ folder or has templater syntax)
        if "templates" in note['folder'].lower():
            skip_reasons["template"] += 1
            continue

        note['_hash'] = c_hash
        filtered.append(note)

    if args.limit and args.limit > 0:
        filtered = filtered[:args.limit]

    print(f"  After filtering: {len(filtered)} notes to import")
    for reason, count in skip_reasons.items():
        if count:
            print(f"    Skipped ({reason}): {count}")
    print()

    if not filtered:
        print("Nothing to import.")
        return

    # ── Stage 4: Chunk ───────────────────────────────────────────────────────

    print("Chunking notes into thoughts...")
    all_thoughts = []

    for i, note in enumerate(filtered):
        chunks = chunk_note(note, use_llm, openrouter_key, verbose=args.verbose)
        note_date = extract_date(note['meta'], note['full_path'])

        for chunk in chunks:
            # Format content with context prefix
            section_part = f" > {chunk['section']}" if chunk['section'] else ""
            content = f"[Obsidian: {note['title']} | {note['folder']}{section_part}] {chunk['content']}"

            thought = {
                'content': content,
                'metadata': {
                    'source': 'obsidian',
                    'title': note['title'],
                    'folder': note['folder'],
                    'tags': note['tags'],
                    'date': note_date,
                    'wikilinks': note['wikilinks'],
                },
                'note_path': note['path'],
                'note_hash': note['_hash'],
                'created_at': f"{note_date}T00:00:00Z",
            }
            if chunk['section']:
                thought['metadata']['section'] = chunk['section']

            all_thoughts.append(thought)

        if args.verbose and (i + 1) % 10 == 0:
            print(f"  Chunked {i + 1}/{len(filtered)} notes "
                  f"({len(all_thoughts)} thoughts so far)")

    print(f"  Generated {len(all_thoughts)} thoughts from {len(filtered)} notes")
    print(f"  Avg {len(all_thoughts) / max(len(filtered), 1):.1f} thoughts per note")
    print()

    # ── Dry run summary ──────────────────────────────────────────────────────

    if args.dry_run:
        print("=== DRY RUN COMPLETE ===")
        print(f"Would import {len(all_thoughts)} thoughts from {len(filtered)} notes")
        if args.verbose:
            print("\nSample thoughts:")
            for t in all_thoughts[:5]:
                preview = t['content'][:120] + "..." if len(t['content']) > 120 else t['content']
                print(f"  [{t['metadata']['folder']}] {preview}")
        if args.report:
            _write_report(all_thoughts, filtered, vault_root, args, skip_reasons, dry_run=True)
        return

    # ── Stage 5: Embed + Insert ──────────────────────────────────────────────

    if args.no_embed:
        print("Inserting thoughts (no embeddings)...")
    else:
        print("Embedding and inserting thoughts...")
    inserted = 0
    embed_failures = 0
    insert_failures = 0

    for i, thought in enumerate(all_thoughts):
        # Generate embedding (skip if --no-embed)
        embedding = None
        if not args.no_embed:
            embedding = generate_embedding(thought['content'], openrouter_key)
            if not embedding:
                embed_failures += 1

        # Insert into Supabase
        success = insert_thought(
            content=thought['content'],
            embedding=embedding,
            metadata=thought['metadata'],
            supabase_url=supabase_url,
            supabase_key=supabase_key,
            created_at=thought.get('created_at'),
        )

        if success:
            inserted += 1
        else:
            insert_failures += 1

        # Progress
        if (i + 1) % 10 == 0 or i == len(all_thoughts) - 1:
            print(f"  Progress: {i + 1}/{len(all_thoughts)} "
                  f"(inserted: {inserted}, failed: {insert_failures})")

        # Rate limit courtesy
        if (i + 1) % 50 == 0:
            time.sleep(1)

    print()
    print(f"=== IMPORT COMPLETE ===")
    print(f"  Thoughts inserted: {inserted}")
    print(f"  Embed failures:    {embed_failures}")
    print(f"  Insert failures:   {insert_failures}")

    # ── Update sync log ──────────────────────────────────────────────────────

    sync_log["vault_path"] = str(vault_root)
    sync_log["last_run"] = datetime.now(tz=timezone.utc).isoformat()

    # Track which notes were imported
    notes_log = sync_log.setdefault("notes", {})
    for note in filtered:
        note_thoughts = [t for t in all_thoughts if t['note_path'] == note['path']]
        notes_log[note['path']] = {
            "content_hash": note['_hash'],
            "thoughts_created": len(note_thoughts),
            "imported_at": datetime.now(tz=timezone.utc).isoformat(),
        }

    save_sync_log(recipe_dir, sync_log)
    print(f"  Sync log saved ({len(notes_log)} notes tracked)")

    if args.report:
        _write_report(all_thoughts, filtered, vault_root, args, skip_reasons,
                      dry_run=False, inserted=inserted, failures=insert_failures)


def _write_report(thoughts, notes, vault_root, args, skip_reasons,
                  dry_run=True, inserted=0, failures=0):
    """Write a markdown summary report."""
    report_path = Path(__file__).parent / "import-report.md"
    lines = [
        f"# Obsidian Import Report",
        f"",
        f"- **Vault**: `{vault_root}`",
        f"- **Date**: {datetime.now().strftime('%Y-%m-%d %H:%M')}",
        f"- **Mode**: {'Dry run' if dry_run else 'Live import'}",
        f"",
        f"## Summary",
        f"",
        f"| Metric | Count |",
        f"|--------|-------|",
        f"| Notes scanned | {len(notes) + sum(skip_reasons.values())} |",
        f"| Notes filtered out | {sum(skip_reasons.values())} |",
        f"| Notes imported | {len(notes)} |",
        f"| Thoughts generated | {len(thoughts)} |",
    ]
    if not dry_run:
        lines.append(f"| Thoughts inserted | {inserted} |")
        lines.append(f"| Insert failures | {failures} |")

    lines += [
        f"",
        f"## Filter Breakdown",
        f"",
    ]
    for reason, count in skip_reasons.items():
        if count:
            lines.append(f"- **{reason}**: {count}")

    lines += [
        f"",
        f"## Top Folders",
        f"",
    ]
    folder_counts = {}
    for t in thoughts:
        f = t['metadata']['folder'] or '(root)'
        folder_counts[f] = folder_counts.get(f, 0) + 1
    for folder, count in sorted(folder_counts.items(), key=lambda x: -x[1])[:10]:
        lines.append(f"- `{folder}`: {count} thoughts")

    report_path.write_text('\n'.join(lines) + '\n')
    print(f"  Report saved to {report_path}")


if __name__ == '__main__':
    main()
