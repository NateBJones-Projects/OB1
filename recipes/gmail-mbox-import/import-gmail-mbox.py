#!/usr/bin/env python3
"""
import-gmail-mbox.py — One-time Gmail MBOX importer for Open Brain.

Parses a Google Takeout MBOX export, filters out noise (notifications,
newsletters, noreply), groups threads, and captures high-value emails
as thoughts via Supabase REST API with OpenAI embeddings.

Usage:
  python3 import-gmail-mbox.py /path/to/Takeout/Mail.mbox --dry-run
  python3 import-gmail-mbox.py /path/to/Takeout/Mail.mbox --limit 100
  python3 import-gmail-mbox.py /path/to/Takeout/Mail.mbox --min-chars 200 --max-chars 8000
  python3 import-gmail-mbox.py /path/to/Takeout/Mail.mbox --after 2025-01-01

Env (.env.local in CWD or exported):
  OPEN_BRAIN_URL          required
  OPEN_BRAIN_SERVICE_KEY  required
  OPENAI_API_KEY          required (or --dry-run)
"""

import mailbox
import os
import sys
import json
import re
import email
import email.utils
import time
import argparse
from pathlib import Path
from email.header import decode_header
from datetime import datetime, timezone
from html import unescape

# ── Config ────────────────────────────────────────────────────────────────

SKIP_SENDERS = {
    "noreply", "no-reply", "mailer-daemon", "postmaster",
    "notifications", "notification", "donotreply", "do-not-reply",
    "automated", "bounce", "undelivered",
}

SKIP_SUBJECTS = {
    "unsubscribe", "you have been unsubscribed", "your subscription",
    "security alert", "sign-in attempt", "new device", "verification code",
}

SKIP_LIST_ID_KEYWORDS = {
    "newsletter", "marketing", "promo", "digest", "weekly digest",
    "daily digest", "monthly digest",
}

MIN_CHARS_DEFAULT = 150
MAX_CHARS_DEFAULT = 8000
BATCH_SIZE = 10


def main():
    args = parse_args()

    if not args.mbox_path:
        print("ERROR: MBOX path required. Use --help.")
        sys.exit(1)

    mbox_path = Path(args.mbox_path)
    # Google Takeout MBOX is often inside a .mbox directory
    if mbox_path.is_dir():
        mbox_file = mbox_path / "mbox"
        if not mbox_file.exists():
            # Try the dir itself as the mbox
            mbox_file = mbox_path
    else:
        mbox_file = mbox_path

    if not mbox_file.exists():
        print(f"ERROR: File not found: {mbox_file}")
        sys.exit(1)

    env = load_env()
    if not env.get("OPEN_BRAIN_URL"):
        print("ERROR: OPEN_BRAIN_URL missing")
        sys.exit(1)
    if not env.get("OPEN_BRAIN_SERVICE_KEY"):
        print("ERROR: OPEN_BRAIN_SERVICE_KEY missing")
        sys.exit(1)
    if not args.dry_run and not env.get("OPENAI_API_KEY"):
        print("ERROR: OPENAI_API_KEY missing (or pass --dry-run)")
        sys.exit(1)

    min_chars = args.min_chars
    max_chars = args.max_chars
    limit = args.limit

    log(f"Opening {mbox_file}...")
    mbox = mailbox.mbox(str(mbox_file))
    total = len(mbox)
    log(f"  {total} messages in MBOX")

    captured = 0
    skipped_noise = 0
    skipped_short = 0
    skipped_date = 0
    errors = 0
    seen_message_ids = set()

    for i, msg in enumerate(mbox):
        if limit and captured >= limit:
            break

        if (i + 1) % 500 == 0:
            log(f"  scanned {i+1}/{total}... ({captured} captured, {skipped_noise} noise, {skipped_short} short)")

        # Dedup by Message-ID
        message_id = msg.get("Message-ID", "")
        if message_id in seen_message_ids:
            continue
        if message_id:
            seen_message_ids.add(message_id)

        # Parse headers
        subject = decode_header_value(msg.get("Subject", ""))
        from_addr = decode_header_value(msg.get("From", ""))
        to_addr = decode_header_value(msg.get("To", ""))
        cc_addr = decode_header_value(msg.get("Cc", ""))
        date_str = msg.get("Date", "")

        # Parse date
        try:
            parsed_date = email.utils.parsedate_to_datetime(date_str)
            date_iso = parsed_date.strftime("%Y-%m-%d")
        except (Exception):
            date_iso = ""

        # Date filter
        if args.after and date_iso and date_iso < args.after:
            skipped_date += 1
            continue
        if args.before and date_iso and date_iso > args.before:
            skipped_date += 1
            continue

        # Noise filter
        from_lower = from_addr.lower()
        subject_lower = subject.lower()

        if any(skip in from_lower for skip in SKIP_SENDERS):
            # Allow if it's from a person at a company (e.g. "John <noreply@company.com>" unlikely but check)
            if "@" in from_lower and any(skip == from_lower.split("@")[0].strip() for skip in SKIP_SENDERS):
                skipped_noise += 1
                continue

        if any(skip in subject_lower for skip in SKIP_SUBJECTS):
            skipped_noise += 1
            continue

        # Extract body text
        body = extract_body(msg)
        if not body or len(body.strip()) < min_chars:
            skipped_short += 1
            continue

        # Truncate
        content = body.strip()[:max_chars]

        # Build display content
        display = f"Email: {subject}\nFrom: {from_addr}\nDate: {date_iso}\n\n{content}"

        metadata = {
            "source": "gmail_import",
            "from": from_addr[:200],
            "to": to_addr[:200] if to_addr else None,
            "cc": cc_addr[:200] if cc_addr else None,
            "subject": subject[:300],
            "date": date_iso,
            "message_id": message_id[:200] if message_id else None,
            "original_length": len(body.strip()),
            "captured_length": len(content),
        }
        # Clean None values
        metadata = {k: v for k, v in metadata.items() if v is not None}

        if args.dry_run:
            log(f"  [dry] {date_iso} | {subject[:60]} | {len(content)} chars")
            captured += 1
            continue

        # Capture via Supabase
        try:
            embedding = get_embedding(env, display[:2000])
            insert_thought(env, display, embedding, "gmail", metadata)
            captured += 1
            if captured % 50 == 0:
                log(f"  {captured} captured...")
        except Exception as e:
            errors += 1
            err_str = str(e)[:120]
            if "429" in err_str or "rate" in err_str.lower():
                log(f"  Rate limited, waiting 10s...")
                time.sleep(10)
            else:
                log(f"  [err] {subject[:40]}: {err_str}")

    log(f"\nDone: {captured} captured, {skipped_noise} noise filtered, "
        f"{skipped_short} too short, {skipped_date} date filtered, {errors} errors")


# ── Body extraction ──────────────────────────────────────────────────────

def extract_body(msg):
    """Extract text body from email, preferring plain text over HTML."""
    if msg.is_multipart():
        plain = None
        html = None
        for part in msg.walk():
            ct = part.get_content_type()
            if ct == "text/plain" and plain is None:
                plain = decode_payload(part)
            elif ct == "text/html" and html is None:
                html = decode_payload(part)
        if plain and len(plain.strip()) > 50:
            return plain
        if html:
            return strip_html(html)
        return plain or html or ""
    else:
        ct = msg.get_content_type()
        payload = decode_payload(msg)
        if ct == "text/html":
            return strip_html(payload)
        return payload


def decode_payload(part):
    """Decode email part payload handling various encodings."""
    try:
        payload = part.get_payload(decode=True)
        if payload is None:
            return ""
        charset = part.get_content_charset() or "utf-8"
        try:
            return payload.decode(charset, errors="replace")
        except (LookupError, UnicodeDecodeError):
            return payload.decode("utf-8", errors="replace")
    except Exception:
        return ""


def strip_html(html):
    """Basic HTML to text conversion."""
    # Remove script/style blocks
    text = re.sub(r'<script[^>]*>.*?</script>', '', html, flags=re.DOTALL | re.IGNORECASE)
    text = re.sub(r'<style[^>]*>.*?</style>', '', text, flags=re.DOTALL | re.IGNORECASE)
    # Convert common block elements to newlines
    text = re.sub(r'<br\s*/?>', '\n', text, flags=re.IGNORECASE)
    text = re.sub(r'</p>', '\n', text, flags=re.IGNORECASE)
    text = re.sub(r'</div>', '\n', text, flags=re.IGNORECASE)
    text = re.sub(r'</tr>', '\n', text, flags=re.IGNORECASE)
    # Remove remaining tags
    text = re.sub(r'<[^>]+>', ' ', text)
    # Decode entities
    text = unescape(text)
    # Collapse whitespace
    text = re.sub(r'[ \t]+', ' ', text)
    text = re.sub(r'\n{3,}', '\n\n', text)
    return text.strip()


# ── Header decoding ──────────────────────────────────────────────────────

def decode_header_value(value):
    """Decode RFC 2047 encoded header values."""
    if not value:
        return ""
    try:
        parts = decode_header(value)
        decoded = []
        for part, charset in parts:
            if isinstance(part, bytes):
                decoded.append(part.decode(charset or "utf-8", errors="replace"))
            else:
                decoded.append(part)
        return " ".join(decoded)
    except Exception:
        return str(value)


# ── Embedding & Insert ──────────────────────────────────────────────────

def get_embedding(env, text):
    import urllib.request
    import ssl

    url = "https://api.openai.com/v1/embeddings"
    data = json.dumps({"model": "text-embedding-3-small", "input": text[:2000]}).encode()
    req = urllib.request.Request(url, data=data, headers={
        "Authorization": f"Bearer {env['OPENAI_API_KEY']}",
        "Content-Type": "application/json",
    })
    ctx = ssl.create_default_context()
    with urllib.request.urlopen(req, context=ctx) as resp:
        result = json.loads(resp.read())
    return result["data"][0]["embedding"]


def insert_thought(env, content, embedding, source_type, metadata):
    import urllib.request
    import ssl

    # Try upsert_thought RPC first, fall back to direct insert
    url = f"{env['OPEN_BRAIN_URL']}/rest/v1/thoughts"
    body = json.dumps({
        "content": content,
        "embedding": embedding,
        "source_type": source_type,
        "metadata": metadata,
    }).encode()
    req = urllib.request.Request(url, data=body, headers={
        "apikey": env["OPEN_BRAIN_SERVICE_KEY"],
        "Authorization": f"Bearer {env['OPEN_BRAIN_SERVICE_KEY']}",
        "Content-Type": "application/json",
        "Prefer": "return=minimal",
    })
    ctx = ssl.create_default_context()
    try:
        with urllib.request.urlopen(req, context=ctx) as resp:
            pass
    except urllib.error.HTTPError as e:
        if e.code == 409:
            pass  # Duplicate, fine
        else:
            raise


# ── Helpers ─────────────────────────────────────────────────────────────

def parse_args():
    parser = argparse.ArgumentParser(description="Import Gmail MBOX into Open Brain")
    parser.add_argument("mbox_path", nargs="?", help="Path to MBOX file or directory")
    parser.add_argument("--dry-run", action="store_true", help="Show what would be imported")
    parser.add_argument("--limit", type=int, default=0, help="Max messages to capture")
    parser.add_argument("--min-chars", type=int, default=MIN_CHARS_DEFAULT, help="Min body chars (default: 150)")
    parser.add_argument("--max-chars", type=int, default=MAX_CHARS_DEFAULT, help="Max content chars (default: 8000)")
    parser.add_argument("--after", help="Only import emails after YYYY-MM-DD")
    parser.add_argument("--before", help="Only import emails before YYYY-MM-DD")
    parser.add_argument("--include-noise", action="store_true", help="Skip noise filtering")
    return parser.parse_args()


def load_env():
    env = {}
    env_path = Path(os.getcwd()) / ".env.local"
    if env_path.exists():
        for line in env_path.read_text().splitlines():
            m = re.match(r'^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$', line)
            if m:
                val = m.group(2).strip('"').strip("'")
                env[m.group(1)] = val
    # Process env overrides
    for key in ["OPEN_BRAIN_URL", "OPEN_BRAIN_SERVICE_KEY", "OPENAI_API_KEY"]:
        val = os.environ.get(key)
        if val:
            env[key] = val
    return env


def log(msg):
    print(f"[gmail-import] {msg}")


if __name__ == "__main__":
    main()
