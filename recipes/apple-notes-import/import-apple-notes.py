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
