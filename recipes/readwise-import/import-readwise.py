#!/usr/bin/env python3
"""
import-readwise.py -- Backfill your Readwise highlight history into Open Brain.

Pages through /api/v2/export/ (the incremental export endpoint),
upserts each book into readwise_books, batch-embeds highlight text,
and inserts into `thoughts` with source_type='readwise'. Idempotent
on re-run: already-imported highlights are skipped by their
readwise_highlight_id.

Pair with the readwise-capture integration to keep things live after
the one-shot backfill. This script catches everything historical; the
webhook catches everything new.

Usage:
  python import-readwise.py
  python import-readwise.py --dry-run --limit 10 --verbose
  python import-readwise.py --updated-after 2025-01-01
  python import-readwise.py --highlighted-after 2024-06-01 --highlighted-before 2024-12-31
  python import-readwise.py --source kindle --source instapaper
  python import-readwise.py --book-id 8237 --book-id 9102
  python import-readwise.py --category books --category articles
  python import-readwise.py --list-books

Requires environment variables (or a .env file loaded by your shell):
  READWISE_ACCESS_TOKEN       -- https://readwise.io/access_token
  SUPABASE_URL                -- your Supabase project URL
  SUPABASE_SERVICE_ROLE_KEY   -- service role key (bypasses RLS)
  OPENROUTER_API_KEY          -- for embeddings
"""

import argparse
import os
import signal
import sys
import time
from datetime import datetime, timezone
from typing import Optional

# Restore default SIGPIPE handling on Unix so piping into `head` or similar
# exits cleanly instead of raising BrokenPipeError mid-print. No-op on
# platforms without SIGPIPE (e.g. Windows).
if hasattr(signal, "SIGPIPE"):
    signal.signal(signal.SIGPIPE, signal.SIG_DFL)

try:
    import requests
except ImportError:
    print("Missing dependency: requests")
    print("Run: pip install -r requirements.txt")
    sys.exit(1)

try:
    from supabase import create_client
except ImportError:
    print("Missing dependency: supabase")
    print("Run: pip install -r requirements.txt")
    sys.exit(1)


# -- Config ------------------------------------------------------------------

READWISE_BASE = "https://readwise.io/api/v2"
OPENROUTER_BASE = "https://openrouter.ai/api/v1"
EMBEDDING_MODEL = "openai/text-embedding-3-small"
EMBEDDING_BATCH_SIZE = 100           # OpenAI accepts up to 2048; 100 balances latency and throughput
READWISE_PAGE_SIZE = 1000            # Export endpoint max
PROGRESS_EVERY = 500                 # Print a heartbeat every N highlights


# -- Date parsing ------------------------------------------------------------


def parse_iso(value: Optional[str]) -> Optional[datetime]:
    """Parse an ISO-8601 string into a tz-aware UTC datetime. Accepts 'Z'."""
    if not value:
        return None
    s = value.strip()
    # Python 3.10's fromisoformat can't handle the 'Z' suffix; normalise.
    if s.endswith("Z"):
        s = s[:-1] + "+00:00"
    try:
        dt = datetime.fromisoformat(s)
    except ValueError:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def parse_cli_date(value: str) -> datetime:
    """Parse a user-supplied date/datetime string for filter flags."""
    dt = parse_iso(value)
    if dt is None:
        raise argparse.ArgumentTypeError(
            f"Invalid date: {value!r} (use YYYY-MM-DD or a full ISO-8601 string)"
        )
    return dt


# -- Readwise ----------------------------------------------------------------


def fetch_export_page(
    token: str, updated_after: Optional[str], cursor: Optional[str]
) -> dict:
    """Fetch a single page from /api/v2/export/, retrying on 429 rate limits."""
    params = {"pageSize": READWISE_PAGE_SIZE}
    if updated_after:
        params["updatedAfter"] = updated_after
    if cursor:
        params["pageCursor"] = cursor

    for attempt in range(5):
        r = requests.get(
            f"{READWISE_BASE}/export/",
            params=params,
            headers={"Authorization": f"Token {token}"},
            timeout=60,
        )
        if r.status_code == 429:
            wait = int(r.headers.get("Retry-After", 60))
            print(f"Rate limited by Readwise; sleeping {wait}s...", flush=True)
            time.sleep(wait)
            continue
        r.raise_for_status()
        return r.json()

    raise RuntimeError("Readwise export: too many retries")


# -- Embeddings --------------------------------------------------------------


def embed_batch(api_key: str, texts: list[str]) -> list[list[float]]:
    """Embed up to 2048 strings in a single OpenRouter call."""
    r = requests.post(
        f"{OPENROUTER_BASE}/embeddings",
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
        json={"model": EMBEDDING_MODEL, "input": texts},
        timeout=120,
    )
    r.raise_for_status()
    return [item["embedding"] for item in r.json()["data"]]


# -- Supabase ----------------------------------------------------------------


def upsert_book(supabase, book: dict, set_highlight_count: bool) -> None:
    """Insert or update the readwise_books row for a book.

    /api/v2/export/ doesn't populate book["num_highlights"], so count the
    inline highlights array instead. On full backfills (no --updated-after)
    that's the authoritative total. On --updated-after runs the inline array
    is a subset -- we omit num_highlights from the payload so ON CONFLICT
    DO UPDATE preserves whatever was there from a previous full run.
    """
    row = {
        "book_id": book["user_book_id"],
        "title": book["title"],
        "author": book.get("author"),
        "category": book.get("category"),
        "source": book.get("source"),
        "source_url": book.get("source_url"),
        "cover_image_url": book.get("cover_image_url"),
        "last_highlight_at": book.get("last_highlight_at"),
        "tags": book.get("book_tags", []),
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    if set_highlight_count:
        row["num_highlights"] = len(book.get("highlights", []))
    supabase.table("readwise_books").upsert(row).execute()


def already_imported(supabase, highlight_ids: list[int]) -> set[int]:
    """Return the subset of highlight IDs already present in `thoughts`."""
    if not highlight_ids:
        return set()
    resp = (
        supabase.table("thoughts")
        .select("metadata")
        .eq("source_type", "readwise")
        .in_(
            "metadata->>readwise_highlight_id",
            [str(hid) for hid in highlight_ids],
        )
        .execute()
    )
    return {
        int(row["metadata"]["readwise_highlight_id"])
        for row in resp.data
        if row.get("metadata", {}).get("readwise_highlight_id") is not None
    }


def build_thought(highlight: dict, book: dict) -> dict:
    """Build the `thoughts` row for a single highlight."""
    text = highlight["text"]
    note = highlight.get("note") or ""
    content = f"{text}\n\n— {note}" if note else text

    return {
        "content": content,
        "source_type": "readwise",
        "type": "reference",
        "metadata": {
            "source": "readwise",
            "readwise_highlight_id": highlight["id"],
            "readwise_book_id": book["user_book_id"],
            "book_title": book["title"],
            "book_author": book.get("author"),
            "book_category": book.get("category"),
            "highlighted_at": highlight.get("highlighted_at"),
            "note": note,
            "location": highlight.get("location"),
            "location_type": highlight.get("location_type"),
            "color": highlight.get("color"),
            "url": highlight.get("url"),
            "tags": [t["name"] for t in highlight.get("tags", [])],
        },
    }


# -- Filtering ---------------------------------------------------------------


def book_matches(book: dict, args) -> bool:
    """Apply book-level filters (--book-id, --source, --category)."""
    if args.book_id and book.get("user_book_id") not in args.book_id:
        return False
    if args.source and (book.get("source") or "").lower() not in {
        s.lower() for s in args.source
    }:
        return False
    if args.category and (book.get("category") or "").lower() not in {
        c.lower() for c in args.category
    }:
        return False
    return True


def highlight_matches(highlight: dict, args) -> bool:
    """Apply highlight-level filters (date ranges)."""
    if args.highlighted_after or args.highlighted_before:
        hat = parse_iso(highlight.get("highlighted_at"))
        if hat is None:
            # Nullable field (tweets, some podcasts). Exclude when a date
            # filter is set -- if we can't place it in time, it can't match.
            return False
        if args.highlighted_after and hat < args.highlighted_after:
            return False
        if args.highlighted_before and hat > args.highlighted_before:
            return False
    if args.updated_before:
        # Export endpoint returns the per-highlight update timestamp as
        # either `updated` or `updated_at` depending on API version.
        u = parse_iso(highlight.get("updated") or highlight.get("updated_at"))
        if u and u > args.updated_before:
            return False
    return True


# -- List-books mode ---------------------------------------------------------


def list_books(token: str, updated_after: Optional[str]) -> None:
    """Print a TSV-ish line per book and exit. Discovery helper for --book-id.

    The count column reflects highlights present in /export/ for this call:
    with no --updated-after, it's the book's total; with --updated-after,
    it's the number updated since that date. The export endpoint does not
    populate a separate `num_highlights` field, so we count inline.
    """
    cursor: Optional[str] = None
    total_books = 0
    total_highlights = 0
    print("book_id\thighlights\tsource\tcategory\ttitle")
    while True:
        page = fetch_export_page(token, updated_after, cursor)
        for book in page.get("results", []):
            count = len(book.get("highlights", []))
            total_highlights += count
            print(
                "\t".join(
                    str(x)
                    for x in (
                        book.get("user_book_id", ""),
                        count,
                        book.get("source") or "",
                        book.get("category") or "",
                        (book.get("title") or "").replace("\t", " "),
                    )
                )
            )
            total_books += 1
        cursor = page.get("nextPageCursor")
        if not cursor:
            break
    suffix = " (since --updated-after)" if updated_after else ""
    print(
        f"\n{total_books} books, {total_highlights} highlights{suffix}",
        file=sys.stderr,
    )


# -- Main --------------------------------------------------------------------


def main() -> None:
    p = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    p.add_argument(
        "--updated-after",
        help="ISO date/datetime; only fetch highlights updated after this (Readwise-side filter)",
    )
    p.add_argument(
        "--updated-before",
        type=parse_cli_date,
        help="ISO date/datetime; only keep highlights updated before this (client-side filter)",
    )
    p.add_argument(
        "--highlighted-after",
        type=parse_cli_date,
        help="ISO date/datetime; only import highlights made after this",
    )
    p.add_argument(
        "--highlighted-before",
        type=parse_cli_date,
        help="ISO date/datetime; only import highlights made before this",
    )
    p.add_argument(
        "--book-id",
        type=int,
        action="append",
        default=[],
        help="Only import highlights from this Readwise book_id. Repeatable.",
    )
    p.add_argument(
        "--source",
        action="append",
        default=[],
        help="Only books from this source (kindle, reader, instapaper, apple_books, hypothesis, ...). Repeatable.",
    )
    p.add_argument(
        "--category",
        action="append",
        default=[],
        help="Only books from this category (books, articles, podcasts, tweets, supplementals). Repeatable.",
    )
    p.add_argument(
        "--list-books",
        action="store_true",
        help="Print one TSV row per book (book_id, count, source, category, title) and exit",
    )
    p.add_argument(
        "--dry-run",
        action="store_true",
        help="Parse and report, but do not write",
    )
    p.add_argument(
        "--limit",
        type=int,
        help="Stop after this many highlights (useful for first-run sanity checks)",
    )
    p.add_argument(
        "--verbose",
        action="store_true",
        help="Print a line per book in addition to the periodic heartbeat",
    )
    args = p.parse_args()

    # --list-books only needs the Readwise token.
    try:
        token = os.environ["READWISE_ACCESS_TOKEN"]
    except KeyError:
        print("Missing required env var: READWISE_ACCESS_TOKEN")
        sys.exit(1)

    if args.list_books:
        list_books(token, args.updated_after)
        return

    try:
        supabase_url = os.environ["SUPABASE_URL"]
        service_key = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
        openrouter_key = os.environ["OPENROUTER_API_KEY"]
    except KeyError as e:
        print(f"Missing required env var: {e.args[0]}")
        print(
            "Set READWISE_ACCESS_TOKEN, SUPABASE_URL, "
            "SUPABASE_SERVICE_ROLE_KEY, and OPENROUTER_API_KEY."
        )
        sys.exit(1)

    supabase = create_client(supabase_url, service_key)

    cursor: Optional[str] = None
    total_highlights = 0
    total_inserted = 0
    total_skipped_existing = 0
    total_filtered_out = 0
    total_books_seen = 0
    total_books_matched = 0
    last_progress = 0
    started = time.monotonic()

    while True:
        page = fetch_export_page(token, args.updated_after, cursor)
        results = page.get("results", [])

        for book in results:
            total_books_seen += 1

            if not book_matches(book, args):
                if args.verbose:
                    print(
                        f"[{(book.get('title') or '')[:50]}] "
                        f"skipped by book filter"
                    )
                continue

            total_books_matched += 1

            if not args.dry_run:
                upsert_book(
                    supabase,
                    book,
                    set_highlight_count=not args.updated_after,
                )

            raw_highlights = book.get("highlights", [])
            filtered_highlights = [
                h for h in raw_highlights if highlight_matches(h, args)
            ]
            filtered_count = len(raw_highlights) - len(filtered_highlights)
            total_filtered_out += filtered_count

            if not filtered_highlights:
                if args.verbose:
                    print(
                        f"[{(book.get('title') or '')[:50]}] "
                        f"no highlights match filters ({filtered_count} filtered)"
                    )
                continue

            existing = already_imported(
                supabase, [h["id"] for h in filtered_highlights]
            )
            new_highlights = [
                h for h in filtered_highlights if h["id"] not in existing
            ]
            total_skipped_existing += len(existing)

            if args.verbose:
                parts = [
                    f"{len(new_highlights)} new",
                    f"{len(existing)} already present",
                ]
                if filtered_count:
                    parts.append(f"{filtered_count} filtered out")
                print(
                    f"[{(book.get('title') or '')[:50]}] "
                    + ", ".join(parts)
                )

            for i in range(0, len(new_highlights), EMBEDDING_BATCH_SIZE):
                batch = new_highlights[i : i + EMBEDDING_BATCH_SIZE]
                thoughts = [build_thought(h, book) for h in batch]
                texts = [t["content"] for t in thoughts]

                if not args.dry_run:
                    embeddings = embed_batch(openrouter_key, texts)
                    for thought, emb in zip(thoughts, embeddings):
                        thought["embedding"] = emb
                    supabase.table("thoughts").insert(thoughts).execute()

                total_inserted += len(batch)
                total_highlights += len(batch)

                if total_highlights - last_progress >= PROGRESS_EVERY:
                    elapsed = time.monotonic() - started
                    rate = total_highlights / elapsed if elapsed > 0 else 0
                    print(
                        f"  ... {total_highlights} highlights processed "
                        f"({rate:.0f}/s, {total_books_matched} matched books)",
                        flush=True,
                    )
                    last_progress = total_highlights

                if args.limit and total_highlights >= args.limit:
                    print(f"\nReached --limit {args.limit}; stopping.")
                    _summary(
                        total_books_seen,
                        total_books_matched,
                        total_inserted,
                        total_skipped_existing,
                        total_filtered_out,
                        args.dry_run,
                    )
                    return

        cursor = page.get("nextPageCursor")
        if not cursor:
            break

    _summary(
        total_books_seen,
        total_books_matched,
        total_inserted,
        total_skipped_existing,
        total_filtered_out,
        args.dry_run,
    )


def _summary(
    books_seen: int,
    books_matched: int,
    inserted: int,
    skipped_existing: int,
    filtered_out: int,
    dry_run: bool,
) -> None:
    prefix = "[DRY RUN] Would have" if dry_run else ""
    print()
    print(f"{prefix} seen {books_seen} books ({books_matched} matched filters)")
    print(f"{prefix} inserted {inserted} highlights")
    print(f"{prefix} skipped {skipped_existing} already-present highlights")
    if filtered_out:
        print(f"{prefix} filtered out {filtered_out} highlights by date range")


if __name__ == "__main__":
    main()
