#!/usr/bin/env python3
"""
import-google-chat.py — Import Google Chat history from Takeout into Open Brain.

Reads messages.json files from Google Chat Groups (DMs and Spaces),
groups by conversation and date, and captures as thoughts.

Usage:
  python3 import-google-chat.py /path/to/Takeout/Google\ Chat --dry-run
  python3 import-google-chat.py /path/to/Takeout/Google\ Chat --limit 100
  python3 import-google-chat.py /path/to/Takeout/Google\ Chat --after 2025-01-01
"""

import json
import os
import re
import sys
import argparse
from pathlib import Path
from datetime import datetime

MIN_MESSAGES_PER_CAPTURE = 2
MAX_CHARS = 6000


def main():
    args = parse_args()
    if not args.chat_path:
        print("ERROR: Path required. Use --help.")
        sys.exit(1)

    env = load_env()
    if not args.dry_run:
        if not env.get("OPEN_BRAIN_URL"):
            print("ERROR: OPEN_BRAIN_URL missing"); sys.exit(1)
        if not env.get("OPEN_BRAIN_SERVICE_KEY"):
            print("ERROR: OPEN_BRAIN_SERVICE_KEY missing"); sys.exit(1)
        if not env.get("OPENAI_API_KEY"):
            print("ERROR: OPENAI_API_KEY missing (or --dry-run)"); sys.exit(1)

    chat_path = Path(args.chat_path)
    groups_dir = chat_path / "Groups"
    if not groups_dir.exists():
        print(f"ERROR: Groups dir not found: {groups_dir}")
        sys.exit(1)

    captured = 0
    skipped = 0
    errors = 0

    # Find all message files
    msg_files = sorted(groups_dir.rglob("messages.json"))
    log(f"Found {len(msg_files)} conversations")

    for msg_file in msg_files:
        group_dir = msg_file.parent
        group_name = group_dir.name
        info_file = group_dir / "group_info.json"

        # Read group info
        group_info = {}
        if info_file.exists():
            try:
                group_info = json.loads(info_file.read_text())
            except Exception:
                pass

        conv_name = group_info.get("name", group_name)
        conv_type = "DM" if group_info.get("type") == "DM" or conv_name == "DM" else "Space"
        members = [m.get("name", m.get("email", "?")) for m in group_info.get("members", [])]

        # Read messages
        try:
            raw = json.loads(msg_file.read_text())
            messages = raw.get("messages", raw) if isinstance(raw, dict) else raw
            if not isinstance(messages, list):
                messages = list(messages.values()) if isinstance(messages, dict) else []
        except Exception as e:
            log(f"  [skip] {conv_name}: parse error: {e}")
            continue

        if not isinstance(messages, list) or len(messages) < MIN_MESSAGES_PER_CAPTURE:
            skipped += 1
            continue

        # Collect all messages, then batch into chunks of ~20
        all_msgs = []
        for msg in messages:
            text = msg.get("text", "").strip()
            if not text:
                continue
            creator = msg.get("creator", {}).get("name", "Unknown")
            date_raw = msg.get("created_date", "")
            date_iso = parse_date(date_raw)

            if args.after and date_iso and date_iso < args.after:
                continue
            if args.before and date_iso and date_iso > args.before:
                continue

            all_msgs.append({"creator": creator, "text": text, "date": date_iso, "raw_date": date_raw})

        log(f"  Processing {conv_name} ({conv_type}): {len(all_msgs)} messages")

        if len(all_msgs) < MIN_MESSAGES_PER_CAPTURE:
            skipped += 1
            continue

        # Batch into chunks of 20 messages
        chunk_size = 20
        for i in range(0, len(all_msgs), chunk_size):
            chunk = all_msgs[i:i+chunk_size]
            if not chunk:
                continue

            first_date = chunk[0]["date"]
            last_date = chunk[-1]["date"]
            date_label = first_date if first_date == last_date else f"{first_date} to {last_date}"

            lines = [f"Google Chat: {conv_name} ({conv_type}) — {date_label}"]
            if members:
                lines.append(f"Members: {', '.join(members[:10])}")
            lines.append("")

            for m in chunk:
                line = f"{m['creator']}: {m['text'][:300]}"
                lines.append(line)

            content = "\n".join(lines)[:MAX_CHARS]

            metadata = {
                "source": "google_chat_import",
                "conversation_name": conv_name[:200],
                "conversation_type": conv_type,
                "message_count": len(chunk),
                "date": first_date,
                "members": members[:20],
            }

            if args.dry_run:
                log(f"  [dry] {date_label} | {conv_name[:40]} | {len(chunk)} msgs")
                captured += 1
                continue

            try:
                import urllib.request, ssl
                embedding = get_embedding(env, content[:2000])
                insert_thought(env, content, embedding, "google_chat", metadata)
                captured += 1
                if captured % 20 == 0:
                    log(f"  {captured} captured...")
            except Exception as e:
                errors += 1
                err = str(e)[:120]
                if "429" in err:
                    import time
                    log("  Rate limited, waiting 10s...")
                    time.sleep(10)
                else:
                    log(f"  [err] {conv_name[:30]}: {err}")

        if args.limit and captured >= args.limit:
            break

    log(f"\nDone: {captured} captured, {skipped} skipped, {errors} errors")


def parse_date(raw):
    """Parse Google Chat date format like 'Tuesday, February 13, 2024 at 12:02:05 PM UTC'"""
    if not raw:
        return ""
    try:
        # Remove timezone name and parse
        cleaned = re.sub(r'\s+(AM|PM)\s+\w+$', '', raw)
        # Try multiple formats
        for fmt in [
            "%A, %B %d, %Y at %I:%M:%S %p",
            "%B %d, %Y at %I:%M:%S %p",
            "%A, %B %d, %Y",
            "%B %d, %Y",
        ]:
            try:
                dt = datetime.strptime(cleaned.strip(), fmt)
                return dt.strftime("%Y-%m-%d")
            except ValueError:
                continue
        # Extract date with regex
        m = re.search(r'(\w+ \d{1,2}, \d{4})', raw)
        if m:
            return datetime.strptime(m.group(1), "%B %d, %Y").strftime("%Y-%m-%d")
    except Exception:
        pass
    return ""


# ── Embedding & Insert (same as gmail importer) ─────────────────────────

def get_embedding(env, text):
    import urllib.request, ssl, json
    url = "https://api.openai.com/v1/embeddings"
    data = json.dumps({"model": "text-embedding-3-small", "input": text[:2000]}).encode()
    req = urllib.request.Request(url, data=data, headers={
        "Authorization": f"Bearer {env['OPENAI_API_KEY']}",
        "Content-Type": "application/json",
    })
    with urllib.request.urlopen(req, context=ssl.create_default_context()) as resp:
        return json.loads(resp.read())["data"][0]["embedding"]


def insert_thought(env, content, embedding, source_type, metadata):
    import urllib.request, ssl, json
    url = f"{env['OPEN_BRAIN_URL']}/rest/v1/thoughts"
    body = json.dumps({"content": content, "embedding": embedding, "source_type": source_type, "metadata": metadata}).encode()
    req = urllib.request.Request(url, data=body, headers={
        "apikey": env["OPEN_BRAIN_SERVICE_KEY"],
        "Authorization": f"Bearer {env['OPEN_BRAIN_SERVICE_KEY']}",
        "Content-Type": "application/json",
        "Prefer": "return=minimal",
    })
    try:
        urllib.request.urlopen(req, context=ssl.create_default_context())
    except urllib.error.HTTPError as e:
        if e.code not in (409,):
            raise


def parse_args():
    p = argparse.ArgumentParser()
    p.add_argument("chat_path", nargs="?")
    p.add_argument("--dry-run", action="store_true")
    p.add_argument("--limit", type=int, default=0)
    p.add_argument("--after", default="")
    p.add_argument("--before", default="")
    return p.parse_args()


def load_env():
    env = {}
    p = Path(os.getcwd()) / ".env.local"
    if p.exists():
        for line in p.read_text().splitlines():
            m = re.match(r'^\s*([A-Za-z_]\w*)\s*=\s*(.*?)\s*$', line)
            if m:
                env[m.group(1)] = m.group(2).strip('"').strip("'")
    for k in ["OPEN_BRAIN_URL", "OPEN_BRAIN_SERVICE_KEY", "OPENAI_API_KEY"]:
        v = os.environ.get(k)
        if v:
            env[k] = v
    return env


def log(msg):
    print(f"[chat-import] {msg}")


if __name__ == "__main__":
    main()
