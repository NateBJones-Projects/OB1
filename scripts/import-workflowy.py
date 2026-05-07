"""
Import Workflowy DOK-structured exports into Open Brain.

Parses Workflowy markdown exports with DOK1-DOK4 structure and captures
each item at the correct level with appropriate metadata.

Usage:
    python3 import-workflowy.py --dry-run
    python3 import-workflowy.py --apply
"""

import json
import os
import sys
import re
import time
import argparse
import requests
from pathlib import Path

EXPORTS_DIR = Path("/home/ubuntu/open-brain-v2/exports/workflowy")
SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_KEY = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
MCP_KEY = os.environ.get("MCP_ACCESS_KEY", "103b14a836b25e08c9a83fe1faf7dd404f38ed06278c17e05b5a933d6bb9ef64")


def parse_workflowy_file(filepath):
    """Parse a Workflowy markdown file into structured DOK items."""
    with open(filepath) as f:
        lines = f.readlines()

    name = Path(filepath).stem
    # Extract the brainlift name from filename
    # e.g. "WF - AI based consulting BrainL - 260428-135952" -> "AI based consulting"
    match = re.match(r"WF - (.+?) - \d{6}-\d{6}", name)
    brainlift_name = match.group(1) if match else name

    items = []
    current_dok_level = None
    current_item_title = None
    current_item_lines = []
    indent_stack = []

    for line in lines:
        stripped = line.rstrip()

        # Detect DOK level headers
        dok_match = re.match(r"^- (DOK\d)\s*[-–]?\s*(.*)", stripped)
        if dok_match:
            # Save previous item
            if current_item_title and current_item_lines:
                items.append(build_item(current_dok_level, current_item_title, current_item_lines, brainlift_name))
            current_dok_level = dok_match.group(1).lower()
            current_item_title = None
            current_item_lines = []
            continue

        # Detect indented items under a DOK level
        indent_match = re.match(r"  - (.+)", stripped)
        if indent_match and current_dok_level:
            # Save previous sub-item
            if current_item_title and current_item_lines:
                items.append(build_item(current_dok_level, current_item_title, current_item_lines, brainlift_name))

            current_item_title = indent_match.group(1).strip()
            current_item_lines = []
            continue

        # Deeper indentation — body of current item
        if stripped.startswith("    ") and current_item_title is not None:
            body = stripped.strip()
            if body.startswith("- "):
                body = body[2:]
            if body:
                current_item_lines.append(body)
            continue

        # Top-level items (Owner, Purpose, etc.)
        top_match = re.match(r"^- (.+)", stripped)
        if top_match and not current_dok_level:
            # This is a top-level metadata line, capture as context
            content = top_match.group(1).strip()
            if content and not content.startswith("DOK"):
                items.append(build_item("meta", content, [], brainlift_name))

    # Save last item
    if current_item_title and current_item_lines:
        items.append(build_item(current_dok_level, current_item_title, current_item_lines, brainlift_name))

    return items, brainlift_name


def build_item(dok_level, title, body_lines, brainlift_name):
    """Build a structured item from parsed components."""
    content = title
    if body_lines:
        content += "\n" + "\n".join(body_lines)

    # Determine importance based on DOK level
    importance_map = {
        "meta": 2,
        "dok1": 2,
        "dok2": 3,
        "dok3": 4,
        "dok4": 5,
    }
    importance = importance_map.get(dok_level, 3)

    # Determine type based on content
    item_type = "reference"
    title_lower = title.lower()
    if any(w in title_lower for w in ["spov", "truth", "myth", "thesis"]):
        item_type = "decision"
    elif any(w in title_lower for w in ["insight", "synthesis", "pattern"]):
        item_type = "idea"
    elif any(w in title_lower for w in ["knowledge", "mechanics", "tree"]):
        item_type = "reference"

    return {
        "content": content.strip(),
        "dok_level": dok_level,
        "importance": importance,
        "type": item_type,
        "brainlift": brainlift_name,
        "title": title[:100],
    }


def capture_thought(item):
    """Capture a single thought via MCP."""
    payload = {
        "jsonrpc": "2.0",
        "method": "tools/call",
        "params": {
            "name": "capture_thought",
            "arguments": {
                "content": item["content"],
                "metadata": {
                    "source": "workflowy-export",
                    "type": item["type"],
                    "importance": item["importance"],
                    "dok_level": item["dok_level"],
                    "brainlift": item["brainlift"],
                    "title": item["title"],
                },
            },
        },
        "id": 1,
    }

    try:
        resp = requests.post(
            f"{SUPABASE_URL}/functions/v1/open-brain-mcp",
            headers={
                "x-brain-key": MCP_KEY,
                "Authorization": f"Bearer {SUPABASE_KEY}",
                "Content-Type": "application/json",
            },
            json=payload,
            timeout=30,
        )
        return resp.ok
    except Exception as e:
        print(f"  Capture error: {e}", file=sys.stderr)
        return False


def main():
    parser = argparse.ArgumentParser(description="Import Workflowy exports into Open Brain")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()

    if not args.apply:
        args.dry_run = True

    files = sorted(EXPORTS_DIR.glob("*.md"))
    print(f"Found {len(files)} Workflowy files\n")

    all_items = []
    for f in files:
        items, name = parse_workflowy_file(f)
        print(f"{name}: {len(items)} items")
        all_items.extend(items)

    print(f"\nTotal: {len(all_items)} items to import ({'DRY RUN' if args.dry_run else 'APPLY'})\n")

    # Group by DOK level for reporting
    by_level = {}
    for item in all_items:
        level = item["dok_level"]
        by_level.setdefault(level, []).append(item)

    for level in ["meta", "dok2", "dok3", "dok4"]:
        if level in by_level:
            print(f"  {level}: {len(by_level[level])} items")

    print()

    captured = 0
    for item in all_items:
        level = item["dok_level"]
        title = item["title"][:80]
        content_preview = item["content"][:120].replace("\n", " ")

        if args.dry_run:
            print(f"  [{level}] imp={item['importance']} | {title}")
            print(f"    {content_preview}...")
        else:
            ok = capture_thought(item)
            if ok:
                captured += 1
                print(f"  [{level}] captured: {title}")
            else:
                print(f"  [{level}] FAILED: {title}")
            time.sleep(0.3)

    print(f"\nDone: {captured} captured out of {len(all_items)} items")


if __name__ == "__main__":
    main()
