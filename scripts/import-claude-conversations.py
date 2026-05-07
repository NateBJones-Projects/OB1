"""
Import Claude conversations export into Open Brain via MCP capture_thought.

Reads conversations.json from a Claude export, extracts key knowledge from
each conversation using OpenAI, and captures as typed thoughts.

Usage:
    python3 import-claude-conversations.py --dry-run --limit 5
    python3 import-claude-conversations.py --apply --limit 50
    python3 import-claude-conversations.py --apply --all
"""

import json
import os
import sys
import time
import argparse
import requests
from pathlib import Path

# Config
CONVERSATIONS_FILE = "/home/ubuntu/open-brain-v2/exports/claude/extracted/conversations.json"
SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_KEY = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
MCP_KEY = os.environ.get("MCP_ACCESS_KEY", "103b14a836b25e08c9a83fe1faf7dd404f38ed06278c17e05b5a933d6bb9ef64")
OPENAI_KEY = os.environ["OPENAI_API_KEY"]

# Filtering
MIN_MESSAGES = 3
MIN_TOTAL_CHARS = 200

EXTRACTION_PROMPT = """Analyze this Claude conversation and extract 1-3 distinct, standalone knowledge items. Each should be something the user would want to remember or search for later.

Skip if the conversation is:
- Just debugging/code troubleshooting with no lasting insight
- A trivial question with a simple factual answer
- Purely about formatting or presentation
- Less than 3 meaningful exchanges

For each knowledge item, return:
- content: A self-contained statement (1-3 sentences, first person where appropriate)
- type: One of: decision, learning, context, idea, reference
- importance: 2-5 (5 = major decision/insight, 2 = minor note)

Return JSON with key "items" containing array of 1-3 items, or empty array if skip.

Conversation:
{conversation}"""


def load_conversations():
    with open(CONVERSATIONS_FILE) as f:
        return json.load(f)


def is_worth_processing(convo):
    """Filter out empty or trivial conversations."""
    messages = convo.get("chat_messages", [])
    if len(messages) < MIN_MESSAGES:
        return False

    total_chars = sum(len(m.get("text", "")) for m in messages)
    if total_chars < MIN_TOTAL_CHARS:
        return False

    return True


def format_conversation(convo):
    """Format conversation for LLM extraction."""
    messages = convo.get("chat_messages", [])
    name = convo.get("name", "Untitled")
    created = convo.get("created_at", "")[:10]

    lines = [f"Conversation: {name} ({created})\n"]
    for m in messages:
        sender = m.get("sender", "unknown")
        text = m.get("text", "")
        if not text:
            continue
        role = "Human" if sender == "human" else "Claude"
        # Truncate very long messages
        if len(text) > 2000:
            text = text[:2000] + "... [truncated]"
        lines.append(f"{role}: {text}\n")

    return "\n".join(lines)


def extract_thoughts(convo_text):
    """Use OpenAI to extract key thoughts from a conversation."""
    prompt = EXTRACTION_PROMPT.format(conversation=convo_text[:8000])

    try:
        resp = requests.post(
            "https://api.openai.com/v1/chat/completions",
            headers={
                "Authorization": f"Bearer {OPENAI_KEY}",
                "Content-Type": "application/json",
            },
            json={
                "model": "gpt-4o-mini",
                "temperature": 0.1,
                "response_format": {"type": "json_object"},
                "messages": [
                    {"role": "system", "content": "Extract key knowledge from conversations. Return JSON."},
                    {"role": "user", "content": prompt},
                ],
            },
            timeout=30,
        )
        resp.raise_for_status()
        data = resp.json()
        result = json.loads(data["choices"][0]["message"]["content"])
        return result.get("items", result.get("thoughts", []))
    except Exception as e:
        print(f"  LLM extraction error: {e}", file=sys.stderr)
        return []


def capture_thought(content, thought_type="idea", importance=3, convo_name=""):
    """Capture a thought via Open Brain MCP."""
    payload = {
        "jsonrpc": "2.0",
        "method": "tools/call",
        "params": {
            "name": "capture_thought",
            "arguments": {
                "content": content,
                "metadata": {
                    "source": "claude-export",
                    "type": thought_type,
                    "importance": importance,
                    "claude_conversation": convo_name,
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
    parser = argparse.ArgumentParser(description="Import Claude conversations into Open Brain")
    parser.add_argument("--dry-run", action="store_true", help="Extract but don't capture")
    parser.add_argument("--apply", action="store_true", help="Actually capture thoughts")
    parser.add_argument("--limit", type=int, default=10, help="Max conversations to process")
    parser.add_argument("--all", action="store_true", help="Process all conversations")
    args = parser.parse_args()

    if not args.apply and not args.dry_run:
        args.dry_run = True

    convos = load_conversations()
    print(f"Loaded {len(convos)} conversations")

    # Filter to worthwhile conversations
    candidates = [c for c in convos if is_worth_processing(c)]
    print(f"{len(candidates)} conversations worth processing (>{MIN_MESSAGES} msgs, >{MIN_TOTAL_CHARS} chars)")

    if not args.all:
        candidates = candidates[:args.limit]

    print(f"Processing {len(candidates)} conversations ({'DRY RUN' if args.dry_run else 'APPLY'})\n")

    total_thoughts = 0
    total_captured = 0
    skipped = 0

    for i, convo in enumerate(candidates):
        name = convo.get("name", f"Untitled ({convo.get('created_at', '')[:10]})")
        msgs = len(convo.get("chat_messages", []))
        print(f"[{i+1}/{len(candidates)}] {name} ({msgs} msgs)")

        convo_text = format_conversation(convo)
        thoughts = extract_thoughts(convo_text)

        if not thoughts:
            print(f"  No thoughts extracted — skipping")
            skipped += 1
            continue

        for t in thoughts:
            total_thoughts += 1
            content = t.get("content", "")
            ttype = t.get("type", "idea")
            importance = t.get("importance", 3)

            if args.dry_run:
                print(f"  [{ttype}] imp={importance}: {content[:100]}...")
            else:
                ok = capture_thought(content, ttype, importance, name)
                if ok:
                    total_captured += 1
                    print(f"  [{ttype}] captured: {content[:80]}...")
                else:
                    print(f"  [{ttype}] FAILED: {content[:80]}...")
                time.sleep(0.5)  # Rate limit

    print(f"\nDone: {total_thoughts} thoughts extracted, {total_captured} captured, {skipped} convos skipped")


if __name__ == "__main__":
    main()
