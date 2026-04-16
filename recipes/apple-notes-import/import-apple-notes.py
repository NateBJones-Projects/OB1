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

    if args.after:
        try:
            datetime.fromisoformat(args.after)
        except ValueError:
            print(f"ERROR: Invalid --after date '{args.after}' — expected YYYY-MM-DD")
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


# ─── Live import ──────────────────────────────────────────────────────────────

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

    live_import(to_process, args, sync_log)


if __name__ == '__main__':
    main()
