"""
ChatGPT Export Parser — parsing, content-type dispatch, filtering, session splitting.

This module handles the data extraction side of the ChatGPT import pipeline:
- Export file parsing (zip and directory)
- Conversation tree resolution (branch handling via current_node)
- Content-type-aware message extraction (14 content types)
- Session boundary detection for multi-day conversations
- Signal-based conversation filtering

Used by import-chatgpt.py.
"""

import hashlib
import json
import os
import re
import sys
import zipfile
from datetime import datetime, timezone
from pathlib import Path

# ─── Constants ───────────────────────────────────────────────────────────────

# Signal-based filtering thresholds
MIN_MESSAGES_SKIP = 2        # Skip if fewer than this many messages
MIN_MESSAGES_ALWAYS = 10     # Always process if at least this many messages
MIN_WORDS_BORDERLINE = 50    # Minimum words for borderline conversations (3-9 msgs)

# Content types to skip entirely (model internals, no knowledge value)
SKIP_CONTENT_TYPES = {
    "thoughts",              # Model chain-of-thought reasoning
    "reasoning_recap",       # "Thought for 2m 34s" UI element
    "computer_output",       # Operator screenshots
    "system_error",          # Browser errors
    "super_widget",          # Rare interactive widgets
    "citable_code_output",   # Rare code output format
    "tether_quote",          # Full third-party web pages — too much noise
    "user_editable_context", # Custom instructions — system metadata, not content
}

# Citation marker pattern for web search results
CITATION_MARKER_RE = re.compile(r"\u3010\d+\u2020[^\u3011]*\u3011")

# Fenced code block pattern for stripping generated code
CODE_BLOCK_RE = re.compile(r"```[\s\S]*?```")

# Context window management
SESSION_GAP_HOURS = 4           # Hours between messages to split sessions
MAX_CONTEXT_TOKENS = 100_000    # Approximate token limit for LLM context
CHARS_PER_TOKEN = 4             # Rough approximation
MAX_CONTEXT_CHARS = MAX_CONTEXT_TOKENS * CHARS_PER_TOKEN  # ~400,000 chars
SMALL_EXPORT_THRESHOLD = 500    # Skip session splitting below this


# ─── ChatGPT Export Parsing ──────────────────────────────────────────────────


def extract_conversations(source_path):
    """Extract conversations from a ChatGPT export zip or extracted directory.

    Handles both single conversations.json and the multi-file format
    (conversations-000.json through conversations-NNN.json) that OpenAI
    uses for large exports.
    """
    source = Path(source_path)

    if source.is_dir():
        return _load_conversations_from_dir(source)

    with zipfile.ZipFile(source, "r") as zf:
        conv_re = re.compile(r"(?:^|/)conversations(?:-\d+)?\.json$")
        candidates = [n for n in zf.namelist() if conv_re.search(n)]
        if not candidates:
            print("Error: No conversations JSON files found in zip archive.")
            print("  Expected conversations.json or conversations-000.json, etc.")
            sys.exit(1)

        all_conversations = []
        for name in sorted(candidates):
            with zf.open(name) as f:
                convs = json.load(f)
                if isinstance(convs, list):
                    all_conversations.extend(convs)
                else:
                    print(f"  Warning: {name} is not a JSON array, skipping.")
        if not all_conversations:
            print("Error: Conversation files were found but contained no data.")
            sys.exit(1)
        print(f"  Loaded {len(candidates)} conversation file(s) from zip.")
        return all_conversations


def _load_conversations_from_dir(directory):
    """Load conversations from an already-extracted export directory."""
    conv_re = re.compile(r"^conversations(?:-\d+)?\.json$")
    candidates = sorted(f for f in os.listdir(directory) if conv_re.match(f))
    if not candidates:
        print(f"Error: No conversations JSON files found in {directory}")
        print("  Expected conversations.json or conversations-000.json, etc.")
        sys.exit(1)

    all_conversations = []
    for name in candidates:
        filepath = os.path.join(directory, name)
        with open(filepath) as f:
            convs = json.load(f)
            if isinstance(convs, list):
                all_conversations.extend(convs)
            else:
                print(f"  Warning: {name} is not a JSON array, skipping.")
    if not all_conversations:
        print("Error: Conversation files were found but contained no data.")
        sys.exit(1)
    print(f"  Loaded {len(candidates)} conversation file(s) from directory.")
    return all_conversations


def conversation_hash(conv):
    """Generate a stable hash ID for a conversation."""
    title = conv.get("title", "")
    create_time = str(conv.get("create_time", ""))
    raw = f"{title}|{create_time}"
    return hashlib.sha256(raw.encode()).hexdigest()[:16]


# ─── Branch Resolution ───────────────────────────────────────────────────────


def resolve_canonical_path(mapping, current_node=None):
    """Walk from current_node to root via parent pointers, then reverse.

    If current_node is provided and exists in mapping, use it as the leaf.
    Otherwise, fall back to the largest-subtree heuristic.
    Returns list of message dicts in conversation order.
    """
    if not mapping:
        return []

    # Strategy 1: Use current_node if available
    if current_node and current_node in mapping:
        path = []
        node_id = current_node
        while node_id and node_id in mapping:
            node = mapping[node_id]
            msg = node.get("message")
            if msg and msg.get("content"):
                path.append(msg)
            node_id = node.get("parent")
        path.reverse()
        return path

    # Strategy 2: Fallback — find root(s), pick largest subtree at each branch
    roots = []
    for node_id, node in mapping.items():
        parent = node.get("parent")
        if parent is None or parent not in mapping:
            roots.append(node_id)

    if not roots:
        return []

    messages = []

    def subtree_size(nid):
        if nid not in mapping:
            return 0
        count = 1
        for child in mapping[nid].get("children", []):
            count += subtree_size(child)
        return count

    def walk_largest(node_id):
        if node_id not in mapping:
            return
        node = mapping[node_id]
        msg = node.get("message")
        if msg and msg.get("content"):
            messages.append(msg)
        children = node.get("children", [])
        if children:
            # Pick child with largest subtree (user's likely chosen path)
            best = max(children, key=subtree_size)
            walk_largest(best)

    walk_largest(roots[0])
    return messages


# ─── Content Type Dispatch ───────────────────────────────────────────────────


def _extract_text_from_content(content, content_type):
    """Extract text from a message content dict based on content_type."""

    if content_type == "text":
        text_parts = content.get("parts", [])
        return "\n".join(str(p) for p in text_parts if isinstance(p, str)).strip()

    if content_type == "multimodal_text":
        # Mixed parts: extract strings + audio transcriptions
        extracted = []
        for part in content.get("parts", []):
            if isinstance(part, str):
                extracted.append(part)
            elif isinstance(part, dict):
                # Voice transcription
                transcription = part.get("audio_transcription", {})
                if isinstance(transcription, dict):
                    text = transcription.get("text", "")
                    if text:
                        extracted.append(text)
        return "\n".join(extracted).strip()

    if content_type == "execution_output":
        text_parts = content.get("parts", [])
        text = "\n".join(str(p) for p in text_parts if isinstance(p, str)).strip()
        # Skip image display markers
        return "" if text == "<<ImageDisplayed>>" else text

    if content_type == "tether_browsing_display":
        text_parts = content.get("parts", [])
        text = "\n".join(str(p) for p in text_parts if isinstance(p, str)).strip()
        # Strip citation markers like 【4†source】
        return CITATION_MARKER_RE.sub("", text).strip()

    if content_type == "sonic_webpage":
        snippet = content.get("snippet", "")
        text = snippet.strip() if isinstance(snippet, str) else ""
        return CITATION_MARKER_RE.sub("", text).strip()

    if content_type == "code":
        text_parts = content.get("parts", [])
        text = "\n".join(str(p) for p in text_parts if isinstance(p, str)).strip()
        # Strip fenced code blocks, keep surrounding prose explanation
        return CODE_BLOCK_RE.sub("", text).strip()

    # Unknown content type: best-effort fallback — extract string parts
    text_parts = content.get("parts", [])
    if text_parts:
        return "\n".join(str(p) for p in text_parts if isinstance(p, str)).strip()

    return ""


def extract_dialogue_text(messages):
    """Extract full dialogue with role prefixes and content-type dispatch.

    Includes both user and assistant messages. Applies content-type-aware
    extraction: skips model reasoning, strips citation markers, extracts
    voice transcriptions.
    """
    parts = []
    for msg in messages:
        author = msg.get("author", {})
        role = author.get("role", "")
        if role == "system":
            continue  # System messages are metadata, not content

        content = msg.get("content", {})
        content_type = content.get("content_type", "text")

        # Skip model internal content types
        if content_type in SKIP_CONTENT_TYPES:
            continue

        text = _extract_text_from_content(content, content_type)
        if not text:
            continue

        # Role prefix
        prefix = "User" if role == "user" else "Assistant"
        parts.append(f"{prefix}: {text}")

    return "\n\n".join(parts)


def count_messages(messages):
    """Count total messages (all roles) that have extractable text content."""
    count = 0
    for msg in messages:
        content = msg.get("content", {})
        content_type = content.get("content_type", "text")
        if content_type in SKIP_CONTENT_TYPES:
            continue
        text = _extract_text_from_content(content, content_type)
        if text:
            count += 1
    return count


def extract_conversation_metadata(conv):
    """Extract free metadata from conversation export JSON (zero API cost)."""
    return {
        "model_slug": conv.get("default_model_slug"),
        "gizmo_id": conv.get("gizmo_id"),
        "gizmo_type": conv.get("gizmo_type"),
        "voice": conv.get("voice"),
        "conversation_origin": conv.get("conversation_origin"),
        "is_archived": conv.get("is_archived", False),
        "is_starred": conv.get("is_starred", False),
        "async_status": conv.get("async_status"),
    }


# ─── Session Splitting ──────────────────────────────────────────────────────


def split_sessions(messages):
    """Split messages into sessions based on timestamp gaps.

    A gap of SESSION_GAP_HOURS or more between consecutive messages
    indicates a new session. Returns a list of message lists.
    """
    if not messages:
        return []

    sessions = [[]]
    prev_time = None

    for msg in messages:
        create_time = msg.get("create_time")
        if create_time and prev_time:
            gap_hours = (create_time - prev_time) / 3600
            if gap_hours >= SESSION_GAP_HOURS:
                sessions.append([])
        sessions[-1].append(msg)
        if create_time:
            prev_time = create_time

    return [s for s in sessions if s]  # Filter empty


def _truncate_session(text):
    """Truncate a session to first ~3000 tokens + last ~1000 tokens."""
    head_chars = 3000 * CHARS_PER_TOKEN  # ~12,000 chars
    tail_chars = 1000 * CHARS_PER_TOKEN  # ~4,000 chars

    if len(text) <= head_chars + tail_chars:
        return text

    return (
        text[:head_chars]
        + "\n\n[... middle truncated ...]\n\n"
        + text[-tail_chars:]
    )


def prepare_dialogue_for_extraction(messages, total_conversations):
    """Prepare dialogue text for LLM extraction, handling context window limits.

    For small exports (<500 conversations), skip session splitting.
    For conversations exceeding MAX_CONTEXT_CHARS, split on session boundaries.
    For individual sessions exceeding MAX_CONTEXT_CHARS, truncate to
    first ~3000 tokens + last ~1000 tokens.
    """
    dialogue = extract_dialogue_text(messages)

    # Fast path: fits in context window
    if len(dialogue) <= MAX_CONTEXT_CHARS:
        return [dialogue]

    # Small export fast path: no session splitting
    if total_conversations < SMALL_EXPORT_THRESHOLD:
        return [_truncate_session(dialogue)]

    # Split into sessions
    sessions = split_sessions(messages)
    session_texts = []
    for session_msgs in sessions:
        text = extract_dialogue_text(session_msgs)
        if not text:
            continue
        if len(text) > MAX_CONTEXT_CHARS:
            text = _truncate_session(text)
        session_texts.append(text)

    return session_texts if session_texts else [_truncate_session(dialogue)]


# ─── Conversation Filtering ─────────────────────────────────────────────────


def should_skip(conv, dialogue_text, message_count, sync_log, args):
    """Return a skip reason string, or None if the conversation should be processed.

    Uses signal-based scoring instead of regex title matching:
    - Single-turn conversations: skip
    - 10+ messages: always process
    - Borderline (2-9 messages): check word count, untitled filter
    - Let the LLM decide for borderline cases via skip_reason in extraction
    """
    conv_id = conversation_hash(conv)

    # Already imported — but check for updates
    sync_entry = sync_log["ingested_ids"].get(conv_id)
    if sync_entry:
        # Support old format (bare string) and new format (dict)
        if isinstance(sync_entry, str):
            return "already_imported"
        update_time = conv.get("update_time", 0)
        if update_time and update_time > sync_entry.get("update_time", 0):
            pass  # Conversation has new messages; re-process
        else:
            return "already_imported"

    # Date filtering
    create_time = conv.get("create_time")
    if create_time:
        conv_date = datetime.fromtimestamp(create_time, tz=timezone.utc).date()
        if args.after and conv_date < args.after:
            return "before_date_filter"
        if args.before and conv_date > args.before:
            return "after_date_filter"

    # Explicitly marked "do not remember"
    if conv.get("is_do_not_remember"):
        return "do_not_remember"

    # CLI override for min messages
    min_skip = getattr(args, "min_messages", MIN_MESSAGES_SKIP) or MIN_MESSAGES_SKIP
    min_always = MIN_MESSAGES_ALWAYS

    # Single-turn: skip
    if message_count < min_skip:
        return "single_turn"

    # 10+ messages: always process (high-value threshold)
    if message_count >= min_always:
        return None

    # Borderline (2-9 messages): check signals
    title = conv.get("title") or ""
    word_count = len(dialogue_text.split())

    # CLI override for min words
    min_words = getattr(args, "min_score", MIN_WORDS_BORDERLINE) or MIN_WORDS_BORDERLINE

    # Untitled with few messages: likely throwaway
    if not title and message_count <= 5:
        return "untitled_short"

    # Too little text overall
    if word_count < min_words:
        return "too_little_text"

    # Let the LLM decide for everything else
    return None
