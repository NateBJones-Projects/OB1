#!/usr/bin/env python3
"""
Open Brain — ChatGPT Export Importer (v2)

Extracts conversations from a ChatGPT data export (zip or extracted directory),
filters trivial ones, extracts 2-5 structured knowledge thoughts per conversation
via LLM, and loads them into your Open Brain instance.

Supports both single conversations.json and the multi-file format
(conversations-000.json through conversations-NNN.json) used in large exports.

Usage:
    python import-chatgpt.py path/to/export.zip [options]
    python import-chatgpt.py path/to/extracted-dir/ [options]

Ingestion modes:
    Default:              Supabase direct insert (requires SUPABASE_URL,
                          SUPABASE_SERVICE_ROLE_KEY, OPENROUTER_API_KEY)
    --ingest-endpoint:    Custom endpoint (requires INGEST_URL, INGEST_KEY)

Options:
    --dry-run              Parse, filter, extract, but don't ingest
    --after YYYY-MM-DD     Only conversations created after this date
    --before YYYY-MM-DD    Only conversations created before this date
    --limit N              Max conversations to process
    --model openrouter     LLM backend: openrouter (default) or ollama
    --ollama-model NAME    Ollama model name (default: qwen3)
    --raw                  Skip extraction, ingest user messages directly
    --verbose              Show full thoughts during processing
    --report FILE          Write a markdown report of everything imported
    --ingest-endpoint      Use INGEST_URL/INGEST_KEY instead of Supabase direct insert
    --store-conversations  Also store conversation metadata and pyramid summaries
    --min-messages N       Override minimum message count for filtering
    --min-words N          Override minimum word count for borderline filtering
    --max-words N          Skip conversations exceeding N words (default: 50000)

Environment variables:
    SUPABASE_URL               Supabase project URL (required for default mode)
    SUPABASE_SERVICE_ROLE_KEY  Supabase service role key (required for default mode)
    OPENROUTER_API_KEY         OpenRouter API key (required for extraction + embeddings)
    INGEST_URL                 Custom ingest endpoint URL (required with --ingest-endpoint)
    INGEST_KEY                 Custom ingest endpoint auth key (required with --ingest-endpoint)
"""

import argparse
import hashlib
import json
import os
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

from chatgpt_parser import (
    conversation_hash,
    count_messages,
    extract_conversation_metadata,
    extract_conversations,
    extract_dialogue_text,
    prepare_dialogue_for_extraction,
    resolve_canonical_path,
    should_skip,
)

# ─── Configuration ───────────────────────────────────────────────────────────

SCRIPT_DIR = Path(__file__).resolve().parent
SYNC_LOG_PATH = SCRIPT_DIR / "chatgpt-sync-log.json"

OPENROUTER_BASE = "https://openrouter.ai/api/v1"
OLLAMA_BASE = "http://localhost:11434"

SUPABASE_URL = os.environ.get("SUPABASE_URL", "")
SUPABASE_SERVICE_ROLE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
OPENROUTER_API_KEY = os.environ.get("OPENROUTER_API_KEY", "")
INGEST_URL = os.environ.get("INGEST_URL", "")
INGEST_KEY = os.environ.get("INGEST_KEY", "")

# ─── Focus Presets ───────────────────────────────────────────────────────────

FOCUS_PRESETS = {
    "tech": (
        'IMPORTANT FOCUS FILTER: Only extract thoughts DIRECTLY about technology, '
        'software architecture, engineering decisions, system design, code patterns, '
        'infrastructure, DevOps, APIs, databases, and technical problem-solving. '
        'Be STRICT — if the conversation is primarily about product shopping, cooking, '
        'health, pets, home appliances, travel, or general knowledge, return '
        '{"thoughts": [], "skip_reason": "off-topic"} even if there is a minor '
        'technical element. The conversation\'s MAIN subject must be technology.'
    ),
    "strategy": (
        'IMPORTANT FOCUS FILTER: Only extract thoughts DIRECTLY about business strategy, '
        'product decisions, career planning, organizational design, market analysis, '
        'competitive positioning, hiring, leadership, and professional growth. '
        'Be STRICT — if the conversation is primarily about product shopping, cooking, '
        'health, pets, home topics, or general knowledge, return '
        '{"thoughts": [], "skip_reason": "off-topic"} even if there is a minor '
        'strategic element. The conversation\'s MAIN subject must be business/career.'
    ),
    "personal": (
        'IMPORTANT FOCUS FILTER: Only extract thoughts DIRECTLY about family, parenting, '
        'health decisions, relationships, personal values, life goals, home improvement, '
        'and personal finance. '
        'Be STRICT — if the conversation is primarily about work, technology, product '
        'comparisons, or general knowledge, return '
        '{"thoughts": [], "skip_reason": "off-topic"}. '
        'The conversation\'s MAIN subject must be personal life.'
    ),
    "creative": (
        'IMPORTANT FOCUS FILTER: Only extract thoughts DIRECTLY about writing, design, '
        'art direction, creative process, content strategy, storytelling, and aesthetic '
        'decisions. '
        'Be STRICT — if the conversation is primarily about technology, business, '
        'shopping, health, or general knowledge, return '
        '{"thoughts": [], "skip_reason": "off-topic"}. '
        'The conversation\'s MAIN subject must be creative work.'
    ),
}


def build_focus_instruction(focus_arg):
    """Convert --focus argument to a prompt instruction.

    Accepts a preset name (tech, strategy, personal, creative) or
    free-text description. Returns empty string if no focus set.
    """
    if not focus_arg or focus_arg.lower() == "all":
        return ""

    # Check for preset
    preset = FOCUS_PRESETS.get(focus_arg.lower())
    if preset:
        return f"\n\n{preset}"

    # Free-text: wrap in a strict FOCUS instruction
    return (
        f"\n\nIMPORTANT FOCUS FILTER: Only extract thoughts DIRECTLY related to: {focus_arg}. "
        f"Be STRICT — if the conversation is primarily about something else "
        f"(e.g., product shopping, cooking, health, pets, home appliances, travel), "
        f'return {{"thoughts": [], "skip_reason": "off-topic"}} even if there is a '
        f"minor tangential connection to the focus topics. "
        f"The conversation's MAIN subject must match the focus areas."
    )


KNOWLEDGE_EXTRACTION_PROMPT = """\
You are extracting lasting knowledge from a ChatGPT conversation.
The goal is to capture decisions, preferences, learnings, context, and
brainstorming insights that would be valuable to recall months or years later.

For each distinct piece of knowledge, return a JSON object in the "thoughts" array.

Each thought must have:
- "content": The knowledge itself, written as a clear, self-contained statement
  (2-4 sentences). Include specifics: names, numbers, reasoning.
  A reader should understand this without seeing the conversation.
- "type": One of "decision", "preference", "learning", "context", "brainstorm", "reference"
- "topics": 1-3 topic tags
- "people": Names of people mentioned (empty array if none)
- "confidence": "firm" (clear conclusion), "tentative" (leaning toward),
  or "exploring" (still open)

Rules:
- Extract 0-5 thoughts per conversation. Zero is fine if nothing is brain-worthy.
- Skip ephemeral lookups (unit conversions, simple facts easily re-googled).
- Skip creative tasks (poems, image generation, jokes).
- Be careful with personal-context conversations that LOOK ephemeral: "what tax bracket am I in
  after this raise" encodes income context (extract as context type). "Best stroller for twins"
  encodes family situation. "Severance pay rules" encodes career context. When in doubt, extract.
- For product comparisons: capture what was chosen, what was rejected, and WHY.
- For technical discussions: capture the architecture/approach decided on, not the code.
- For brainstorming: capture the most promising ideas and the reasoning.
- Never include generated code — only the reasoning and decisions around it.
- Write in the same language as the conversation.

Return ONLY a JSON object: {{"thoughts": [...], "conversation_type": "...", "skip_reason": "..."}}
If nothing is worth extracting, return {{"thoughts": [], "skip_reason": "ephemeral lookup"}}.

Title: {title}
Date: {date}
Message count: {message_count}
Model: {model}

Conversation:
{dialogue_text}"""

KNOWLEDGE_EXTRACTION_PROMPT_WITH_SUMMARIES = """\
You are extracting lasting knowledge from a ChatGPT conversation.
The goal is to capture decisions, preferences, learnings, context, and
brainstorming insights that would be valuable to recall months or years later.

For each distinct piece of knowledge, return a JSON object in the "thoughts" array.

Each thought must have:
- "content": The knowledge itself, written as a clear, self-contained statement
  (2-4 sentences). Include specifics: names, numbers, reasoning.
  A reader should understand this without seeing the conversation.
- "type": One of "decision", "preference", "learning", "context", "brainstorm", "reference"
- "topics": 1-3 topic tags
- "people": Names of people mentioned (empty array if none)
- "confidence": "firm" (clear conclusion), "tentative" (leaning toward),
  or "exploring" (still open)

Rules:
- Extract 0-5 thoughts per conversation. Zero is fine if nothing is brain-worthy.
- Skip ephemeral lookups (unit conversions, simple facts easily re-googled).
- Skip creative tasks (poems, image generation, jokes).
- Be careful with personal-context conversations that LOOK ephemeral: "what tax bracket am I in
  after this raise" encodes income context (extract as context type). "Best stroller for twins"
  encodes family situation. "Severance pay rules" encodes career context. When in doubt, extract.
- For product comparisons: capture what was chosen, what was rejected, and WHY.
- For technical discussions: capture the architecture/approach decided on, not the code.
- For brainstorming: capture the most promising ideas and the reasoning.
- Never include generated code — only the reasoning and decisions around it.
- Write in the same language as the conversation.

ALSO return pyramid summaries of the conversation at 5 lengths:
- "summary_8w": ~8 words — a label for a timeline or list
- "summary_16w": ~16 words — one sentence with the key outcome
- "summary_32w": ~32 words — card preview with key details
- "summary_64w": ~64 words — short paragraph with reasoning and alternatives
- "summary_128w": ~128 words — full summary with decisions, people, and context

Return ONLY a JSON object:
{{
  "thoughts": [...],
  "conversation_type": "...",
  "skip_reason": "...",
  "summary_8w": "...",
  "summary_16w": "...",
  "summary_32w": "...",
  "summary_64w": "...",
  "summary_128w": "..."
}}
If nothing is worth extracting, still return summaries but set thoughts to [].

Title: {title}
Date: {date}
Message count: {message_count}
Model: {model}

Conversation:
{dialogue_text}"""

# ─── Sync Log ────────────────────────────────────────────────────────────────


def load_sync_log():
    """Load sync log from disk. Returns dict with ingested_ids and last_sync."""
    try:
        with SYNC_LOG_PATH.open(encoding="utf-8") as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return {"ingested_ids": {}, "last_sync": ""}


def save_sync_log(log):
    """Save sync log to disk."""
    with SYNC_LOG_PATH.open("w", encoding="utf-8", newline="\n") as f:
        json.dump(log, f, indent=2)


# ─── HTTP Helpers ────────────────────────────────────────────────────────────

try:
    import requests
except ImportError:
    print("Missing dependency: requests")
    print("Install with: pip install requests")
    sys.exit(1)


def http_post_with_retry(url, headers, body, retries=2):
    """POST with exponential backoff retry on transient failures."""
    for attempt in range(retries + 1):
        try:
            resp = requests.post(url, headers=headers, json=body, timeout=120)
            if resp.status_code >= 500 and attempt < retries:
                time.sleep(1 * (attempt + 1))
                continue
            return resp
        except requests.RequestException as e:
            if attempt < retries:
                time.sleep(1 * (attempt + 1))
                continue
            print(f"   Warning: HTTP request failed after {retries + 1} attempts: {e}")
            return None
    return None  # unreachable


# ─── LLM Knowledge Extraction ───────────────────────────────────────────────


def _parse_extraction_response(raw_content, store_conversations=False):
    """Parse the structured JSON response from the LLM extraction.

    Returns a dict with thoughts, conversation_type, skip_reason, and
    optionally summaries.
    """
    try:
        # Strip markdown code fences if present (common with Anthropic models)
        text = raw_content.strip()
        if text.startswith("```"):
            # Remove opening ```json or ``` and closing ```
            lines = text.split("\n")
            if lines[0].startswith("```"):
                lines = lines[1:]
            if lines and lines[-1].strip() == "```":
                lines = lines[:-1]
            text = "\n".join(lines)
        result = json.loads(text)
    except (json.JSONDecodeError, TypeError) as e:
        # Try to find JSON object in the response text
        try:
            start = raw_content.index("{")
            end = raw_content.rindex("}") + 1
            result = json.loads(raw_content[start:end])
        except (ValueError, json.JSONDecodeError):
            print(f"   Warning: Failed to parse extraction response: {e}")
            return {"thoughts": [], "conversation_type": "", "skip_reason": "parse_error"}

    thoughts = result.get("thoughts", [])
    # Validate each thought is a dict with required fields
    valid_thoughts = []
    for t in thoughts:
        if isinstance(t, dict) and t.get("content"):
            valid_thoughts.append({
                "content": t["content"],
                "type": t.get("type", "learning"),
                "topics": t.get("topics", []),
                "people": t.get("people", []),
                "confidence": t.get("confidence", "firm"),
            })
        elif isinstance(t, str) and t.strip():
            # Backward compat: plain string thoughts from older prompts
            valid_thoughts.append({
                "content": t.strip(),
                "type": "learning",
                "topics": [],
                "people": [],
                "confidence": "firm",
            })

    extraction = {
        "thoughts": valid_thoughts,
        "conversation_type": result.get("conversation_type", ""),
        "skip_reason": result.get("skip_reason"),
    }

    if store_conversations:
        extraction["summaries"] = {
            k: result.get(k, "")
            for k in ("summary_8w", "summary_16w", "summary_32w", "summary_64w", "summary_128w")
        }

    return extraction


def summarize_openrouter(title, date_str, dialogue_text, message_count, model_slug, store_conversations=False, openrouter_model="openai/gpt-4o-mini", focus_instruction=""):
    """Extract knowledge from a conversation using OpenRouter."""
    if not OPENROUTER_API_KEY:
        print("Error: OPENROUTER_API_KEY environment variable required for extraction.")
        sys.exit(1)

    prompt_template = KNOWLEDGE_EXTRACTION_PROMPT_WITH_SUMMARIES if store_conversations else KNOWLEDGE_EXTRACTION_PROMPT
    prompt = prompt_template.format(
        title=title,
        date=date_str,
        message_count=message_count,
        model=model_slug,
        dialogue_text=dialogue_text,
    )
    if focus_instruction:
        prompt = prompt.replace("\nTitle:", f"{focus_instruction}\n\nTitle:")

    resp = http_post_with_retry(
        f"{OPENROUTER_BASE}/chat/completions",
        headers={
            "Authorization": f"Bearer {OPENROUTER_API_KEY}",
            "Content-Type": "application/json",
        },
        body={
            "model": openrouter_model,
            "response_format": {"type": "json_object"},
            "messages": [
                {"role": "user", "content": prompt},
            ],
            "temperature": 0,
        },
    )

    if not resp or resp.status_code != 200:
        status = resp.status_code if resp else "no response"
        detail = ""
        try:
            detail = resp.text[:300] if resp else ""
        except Exception:
            pass
        print(f"   Warning: Extraction failed ({status}): {detail}")
        return {"thoughts": [], "conversation_type": "", "skip_reason": "api_error"}

    try:
        data = resp.json()
        raw_content = data["choices"][0]["message"]["content"]
        return _parse_extraction_response(raw_content, store_conversations)
    except (KeyError, IndexError) as e:
        print(f"   Warning: Failed to parse extraction response: {e}")
        return {"thoughts": [], "conversation_type": "", "skip_reason": "parse_error"}


def summarize_ollama(title, date_str, dialogue_text, message_count, model_slug, model_name="qwen3", store_conversations=False, focus_instruction=""):
    """Extract knowledge from a conversation using a local Ollama model."""
    prompt_template = KNOWLEDGE_EXTRACTION_PROMPT_WITH_SUMMARIES if store_conversations else KNOWLEDGE_EXTRACTION_PROMPT
    prompt = prompt_template.format(
        title=title,
        date=date_str,
        message_count=message_count,
        model=model_slug,
        dialogue_text=dialogue_text,
    )
    if focus_instruction:
        prompt = prompt.replace("\nTitle:", f"{focus_instruction}\n\nTitle:")

    try:
        resp = requests.post(
            f"{OLLAMA_BASE}/api/generate",
            json={
                "model": model_name,
                "prompt": prompt,
                "stream": False,
                "format": "json",
            },
            timeout=120,
        )
    except requests.RequestException as e:
        print(f"   Warning: Ollama request failed: {e}")
        return {"thoughts": [], "conversation_type": "", "skip_reason": "api_error"}

    if resp.status_code != 200:
        print(f"   Warning: Ollama returned {resp.status_code}")
        return {"thoughts": [], "conversation_type": "", "skip_reason": "api_error"}

    try:
        raw = resp.json().get("response", "")
        return _parse_extraction_response(raw, store_conversations)
    except (json.JSONDecodeError, KeyError) as e:
        print(f"   Warning: Failed to parse Ollama response: {e}")
        return {"thoughts": [], "conversation_type": "", "skip_reason": "parse_error"}


def summarize(title, date_str, dialogue_text, message_count, model_slug, args):
    """Dispatch to the appropriate extraction backend."""
    store_conversations = getattr(args, "store_conversations", False)
    focus_instruction = build_focus_instruction(getattr(args, "focus", None))
    if args.model == "ollama":
        return summarize_ollama(title, date_str, dialogue_text, message_count, model_slug, args.ollama_model, store_conversations, focus_instruction)
    return summarize_openrouter(title, date_str, dialogue_text, message_count, model_slug, store_conversations, args.openrouter_model, focus_instruction)


# ─── Embedding Generation ───────────────────────────────────────────────────


def generate_embedding(text):
    """Generate a 1536-dim embedding via OpenRouter (text-embedding-3-small)."""
    truncated = text[:8000]

    resp = http_post_with_retry(
        f"{OPENROUTER_BASE}/embeddings",
        headers={
            "Authorization": f"Bearer {OPENROUTER_API_KEY}",
            "Content-Type": "application/json",
        },
        body={
            "model": "openai/text-embedding-3-small",
            "input": truncated,
        },
    )

    if not resp or resp.status_code != 200:
        status = resp.status_code if resp else "no response"
        print(f"   Warning: Embedding generation failed ({status})")
        return None

    try:
        data = resp.json()
        return data["data"][0]["embedding"]
    except (KeyError, IndexError) as e:
        print(f"   Warning: Failed to parse embedding response: {e}")
        return None


# ─── Semantic Deduplication ──────────────────────────────────────────────────


def check_semantic_duplicate(thought_text, threshold=0.92):
    """Check if a semantically similar thought already exists.

    Uses the match_thoughts RPC with a high similarity threshold.
    Returns True if a near-duplicate exists, False otherwise.
    """
    embedding = generate_embedding(thought_text)
    if not embedding:
        return False  # Can't check; allow insertion

    resp = http_post_with_retry(
        f"{SUPABASE_URL}/rest/v1/rpc/match_thoughts",
        headers={
            "Content-Type": "application/json",
            "apikey": SUPABASE_SERVICE_ROLE_KEY,
            "Authorization": f"Bearer {SUPABASE_SERVICE_ROLE_KEY}",
        },
        body={
            "query_embedding": embedding,
            "match_threshold": threshold,
            "match_count": 1,
            "filter": {"source": "chatgpt"},
        },
    )

    if not resp or resp.status_code != 200:
        return False  # Can't check; allow insertion

    try:
        data = resp.json()
        return len(data) > 0
    except (json.JSONDecodeError, TypeError):
        return False


# ─── Ingestion ───────────────────────────────────────────────────────────────


def ingest_thought_supabase(content, metadata_dict, embed_text=None):
    """Insert a thought directly into Supabase with a generated embedding.

    Args:
        content: Full thought content (stored in DB, includes prefix)
        metadata_dict: Metadata JSONB
        embed_text: Text to generate embedding from (default: content).
                    Use this to embed only the thought text, not the prefix.
    """
    embedding = generate_embedding(embed_text or content)
    if not embedding:
        return {"ok": False, "error": "Failed to generate embedding"}

    resp = http_post_with_retry(
        f"{SUPABASE_URL}/rest/v1/thoughts",
        headers={
            "Content-Type": "application/json",
            "apikey": SUPABASE_SERVICE_ROLE_KEY,
            "Authorization": f"Bearer {SUPABASE_SERVICE_ROLE_KEY}",
            "Prefer": "return=minimal",
        },
        body={
            "content": content,
            "embedding": embedding,
            "metadata": metadata_dict,
        },
    )

    if not resp:
        return {"ok": False, "error": "No response from Supabase"}

    if resp.status_code not in (200, 201):
        try:
            error_detail = resp.json()
        except ValueError:
            error_detail = resp.text
        return {"ok": False, "error": f"HTTP {resp.status_code}: {error_detail}"}

    return {"ok": True}


def ingest_thought_endpoint(content, extra_metadata, full_text=None):
    """POST a thought to a custom ingest endpoint."""
    body = {
        "content": content,
        "source": "chatgpt",
        "extra_metadata": extra_metadata,
    }
    if full_text:
        body["full_text"] = full_text

    resp = http_post_with_retry(
        INGEST_URL,
        headers={
            "Content-Type": "application/json",
            "x-ingest-key": INGEST_KEY,
        },
        body=body,
    )

    if not resp:
        return {"ok": False, "error": "No response from server"}

    try:
        return resp.json()
    except ValueError:
        return {"ok": False, "error": f"Invalid JSON response: {resp.status_code}"}


# ─── Conversation Storage (--store-conversations) ───────────────────────────


def store_conversation(conv, extraction, conv_meta, message_count, import_batch):
    """Insert or update a conversation record in chatgpt_conversations.

    Uses chatgpt_id as the unique key for upsert.
    Embeds the 128-word summary for semantic search.
    """
    chatgpt_id = conv.get("id", "")
    if not chatgpt_id:
        return {"ok": False, "error": "No conversation ID"}

    summaries = extraction.get("summaries", {})
    summary_128w = summaries.get("summary_128w", "")

    # Generate embedding from 128w summary
    embedding = generate_embedding(summary_128w) if summary_128w else None

    # Collect topics and people from all extracted thoughts
    all_topics = []
    all_people = []
    for t in extraction.get("thoughts", []):
        all_topics.extend(t.get("topics", []))
        all_people.extend(t.get("people", []))
    key_topics = list(set(all_topics))
    people_mentioned = list(set(all_people))

    create_time = conv.get("create_time")
    update_time = conv.get("update_time")

    # Build content hash for re-import detection
    content_hash = hashlib.sha256(
        json.dumps(conv.get("mapping", {}), sort_keys=True, default=str).encode()
    ).hexdigest()[:32]

    body = {
        "chatgpt_id": chatgpt_id,
        "title": conv.get("title", ""),
        "create_time": datetime.fromtimestamp(create_time, tz=timezone.utc).isoformat() if create_time else None,
        "update_time": datetime.fromtimestamp(update_time, tz=timezone.utc).isoformat() if update_time else None,
        "model_slug": conv_meta.get("model_slug"),
        "message_count": message_count,
        "conversation_type": extraction.get("conversation_type", ""),
        "summary_8w": summaries.get("summary_8w", ""),
        "summary_16w": summaries.get("summary_16w", ""),
        "summary_32w": summaries.get("summary_32w", ""),
        "summary_64w": summaries.get("summary_64w", ""),
        "summary_128w": summary_128w,
        "key_topics": key_topics,
        "people_mentioned": people_mentioned,
        "voice": conv_meta.get("voice"),
        "gizmo_id": conv_meta.get("gizmo_id"),
        "gizmo_type": conv_meta.get("gizmo_type"),
        "conversation_origin": conv_meta.get("conversation_origin"),
        "conversation_url": f"https://chatgpt.com/c/{chatgpt_id}",
        "content_hash": content_hash,
        "import_batch": import_batch,
    }

    if embedding:
        body["embedding"] = embedding

    # Include user_id if provided (required for RLS; auth.uid() is NULL with service_role)
    user_id = os.environ.get("USER_ID", "")
    if user_id:
        body["user_id"] = user_id

    # Upsert: insert or update on chatgpt_id conflict
    resp = http_post_with_retry(
        f"{SUPABASE_URL}/rest/v1/chatgpt_conversations?on_conflict=chatgpt_id",
        headers={
            "Content-Type": "application/json",
            "apikey": SUPABASE_SERVICE_ROLE_KEY,
            "Authorization": f"Bearer {SUPABASE_SERVICE_ROLE_KEY}",
            "Prefer": "return=minimal,resolution=merge-duplicates",
        },
        body=body,
    )

    if not resp:
        return {"ok": False, "error": "No response from Supabase"}
    if resp.status_code not in (200, 201):
        try:
            error_detail = resp.json()
        except ValueError:
            error_detail = resp.text
        return {"ok": False, "error": f"HTTP {resp.status_code}: {error_detail}"}

    return {"ok": True}


# ─── CLI ─────────────────────────────────────────────────────────────────────


def parse_date(s):
    """Parse a YYYY-MM-DD string to a date object."""
    try:
        return datetime.strptime(s, "%Y-%m-%d").date()
    except ValueError:
        print(f"Error: Invalid date format '{s}'. Use YYYY-MM-DD.")
        sys.exit(1)


def parse_args():
    parser = argparse.ArgumentParser(
        description="Import ChatGPT conversations into Open Brain",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""\
Examples:
  python import-chatgpt.py export.zip --dry-run --limit 10
  python import-chatgpt.py export.zip --after 2024-01-01
  python import-chatgpt.py export.zip --model ollama --ollama-model qwen3
  python import-chatgpt.py export.zip --raw --limit 50
  python import-chatgpt.py export.zip --ingest-endpoint
  python import-chatgpt.py export.zip --store-conversations
  python import-chatgpt.py export.zip --focus "technology, architecture, career decisions"
  python import-chatgpt.py export.zip --focus tech
  python import-chatgpt.py export.zip --focus personal""",
    )
    parser.add_argument("zip_path", help="Path to ChatGPT data export zip file or extracted directory")
    parser.add_argument("--dry-run", action="store_true", help="Parse and extract but don't ingest")
    parser.add_argument("--after", type=parse_date, help="Only conversations after YYYY-MM-DD")
    parser.add_argument("--before", type=parse_date, help="Only conversations before YYYY-MM-DD")
    parser.add_argument("--limit", type=int, default=0, help="Max conversations to process (0 = unlimited)")
    parser.add_argument("--model", choices=["openrouter", "ollama"], default="openrouter", help="LLM backend (default: openrouter)")
    parser.add_argument("--ollama-model", default="qwen3", help="Ollama model name (default: qwen3)")
    parser.add_argument("--raw", action="store_true", help="Skip extraction, ingest user messages directly")
    parser.add_argument("--verbose", action="store_true", help="Show full thoughts during processing")
    parser.add_argument("--report", type=str, metavar="FILE", help="Write a markdown report of everything imported")
    parser.add_argument("--ingest-endpoint", action="store_true", help="Use INGEST_URL/INGEST_KEY instead of Supabase direct insert")
    parser.add_argument("--store-conversations", action="store_true", help="Also store conversation metadata and pyramid summaries in chatgpt_conversations table")
    parser.add_argument("--min-messages", type=int, default=0, help="Override minimum message count for filtering")
    parser.add_argument("--min-words", type=int, default=0, help="Override minimum word count for borderline filtering (default: 50)")
    parser.add_argument("--max-words", type=int, default=50000, help="Skip conversations exceeding this word count (default: 50000, ~$1+ per conversation with gpt-4o)")
    parser.add_argument("--openrouter-model", default="openai/gpt-4o-mini", help="OpenRouter model for extraction (default: openai/gpt-4o-mini)")
    parser.add_argument("--focus", type=str, default=None, metavar="TOPICS", help="""\
Focus extraction on specific topics. Accepts a preset name or custom description.

Presets:
  tech       - Technology, architecture, engineering, code design, system decisions
  strategy   - Business strategy, product decisions, career moves, planning
  personal   - Family, health, relationships, personal values, life decisions
  creative   - Writing, design, art direction, creative process
  all        - No filter (default behavior)

Custom: Any free-text description of what to focus on, e.g.:
  --focus "technology, architecture, career decisions, business strategy"
  --focus "parenting, health, home improvement"
  --focus "AI/ML, prompt engineering, LLM architecture"

When set, the LLM will prioritize extracting thoughts matching your focus
and skip conversations outside it.""")
    return parser.parse_args()


# ─── Main ────────────────────────────────────────────────────────────────────


def main():
    args = parse_args()

    if not os.path.isfile(args.zip_path) and not os.path.isdir(args.zip_path):
        print(f"Error: Path not found: {args.zip_path}")
        sys.exit(1)

    # Validate env vars for live mode
    if not args.dry_run:
        if args.ingest_endpoint:
            if not INGEST_URL:
                print("Error: INGEST_URL environment variable required with --ingest-endpoint.")
                sys.exit(1)
            if not INGEST_KEY:
                print("Error: INGEST_KEY environment variable required with --ingest-endpoint.")
                sys.exit(1)
        else:
            if not SUPABASE_URL:
                print("Error: SUPABASE_URL environment variable required.")
                print("Set it to your Supabase project URL (e.g., https://xxxxx.supabase.co)")
                sys.exit(1)
            if not SUPABASE_SERVICE_ROLE_KEY:
                print("Error: SUPABASE_SERVICE_ROLE_KEY environment variable required.")
                sys.exit(1)
            if not OPENROUTER_API_KEY:
                print("Error: OPENROUTER_API_KEY required for embedding generation.")
                print("Get one at https://openrouter.ai/keys")
                sys.exit(1)

    if not args.raw and args.model == "openrouter" and not OPENROUTER_API_KEY:
        print("Error: OPENROUTER_API_KEY environment variable required for extraction.")
        print("Use --raw to skip extraction, or --model ollama for local inference.")
        sys.exit(1)

    print(f"\nExtracting conversations from {args.zip_path}...")
    conversations = extract_conversations(args.zip_path)
    print(f"Found {len(conversations)} conversations.\n")

    # Sort by create_time (oldest first)
    conversations.sort(key=lambda c: c.get("create_time", 0))

    sync_log = load_sync_log()

    # Display run configuration
    mode = "DRY RUN" if args.dry_run else "LIVE"
    ingest_mode = "custom endpoint" if args.ingest_endpoint else "Supabase direct insert"
    summarize_mode = "raw (no extraction)" if args.raw else f"{args.model}"
    if args.model == "ollama" and not args.raw:
        summarize_mode += f" ({args.ollama_model})"
    print(f"  Mode:        {mode}")
    if not args.dry_run:
        print(f"  Ingestion:   {ingest_mode}")
    print(f"  Extraction:  {summarize_mode}")
    if args.after:
        print(f"  After:       {args.after}")
    if args.before:
        print(f"  Before:      {args.before}")
    if args.limit:
        print(f"  Limit:       {args.limit}")
    if args.store_conversations:
        if args.ingest_endpoint:
            print(f"  Warning: --store-conversations is not supported with --ingest-endpoint and will be ignored.")
        else:
            print(f"  Store convs: enabled")
    if args.max_words:
        print(f"  Max words:   {args.max_words}")
    if args.focus:
        preset = FOCUS_PRESETS.get(args.focus.lower())
        if preset:
            print(f"  Focus:       {args.focus} (preset)")
        else:
            print(f"  Focus:       {args.focus}")
    print()

    # Counters
    total = len(conversations)
    already_imported = 0
    filtered = 0
    filter_reasons = {}
    processed = 0
    thoughts_generated = 0
    ingested = 0
    errors = 0
    total_words = 0
    conversations_stored = 0
    duplicates_skipped = 0
    report_entries = []
    start_time = time.time()
    import_batch = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")

    # Pre-compute total_to_process estimate (for ETA)
    total_to_process = args.limit if args.limit else total

    for conv in conversations:
        # Respect limit
        if args.limit and processed >= args.limit:
            break

        # 1. Parse conversation (branch resolution via current_node)
        messages = resolve_canonical_path(conv.get("mapping", {}), conv.get("current_node"))

        # 2. Extract dialogue (full user + assistant with content-type dispatch)
        dialogue_text = extract_dialogue_text(messages)
        message_count = count_messages(messages)

        # 3. Extract metadata (free, from export JSON)
        conv_meta = extract_conversation_metadata(conv)

        # 4. Filter (signal-based)
        skip_reason = should_skip(conv, dialogue_text, message_count, sync_log, args)
        if skip_reason:
            if skip_reason == "already_imported":
                already_imported += 1
            else:
                filtered += 1
                filter_reasons[skip_reason] = filter_reasons.get(skip_reason, 0) + 1
            continue

        processed += 1
        word_count = len(dialogue_text.split())
        total_words += word_count

        title = conv.get("title", "(untitled)")

        # Skip conversations exceeding --max-words (avoids burning tokens on monster conversations)
        if args.max_words and word_count > args.max_words:
            filtered += 1
            filter_reasons["max_words"] = filter_reasons.get("max_words", 0) + 1
            print(f"   Skipping '{title}' ({word_count} words exceeds --max-words {args.max_words})")
            continue
        create_time = conv.get("create_time")
        date_str = (
            datetime.fromtimestamp(create_time, tz=timezone.utc).strftime("%Y-%m-%d")
            if create_time
            else "unknown"
        )
        conv_id = conversation_hash(conv)
        chatgpt_id = conv.get("id", "")

        # Progress display with ETA
        extracted_count = thoughts_generated  # Only conversations that produced thoughts
        elapsed = time.time() - start_time
        skipped_so_far = already_imported + filtered
        examined_so_far = processed + skipped_so_far
        pct = int(examined_so_far / total_to_process * 100) if total_to_process else 0

        # ETA based on total examination rate (includes fast skips + slow extractions)
        if examined_so_far > 1:
            per_conv = elapsed / examined_so_far
            remaining = total_to_process - examined_so_far
            eta_seconds = remaining * per_conv
            eta_str = f"~{int(eta_seconds // 60)}m{int(eta_seconds % 60)}s"
        else:
            eta_str = "..."

        print(f"[{pct}% | {examined_so_far}/{total_to_process}] {title}")
        url_display = f"https://chatgpt.com/c/{chatgpt_id}" if chatgpt_id else "no id"
        print(f"   {message_count} msgs | {word_count} words | {date_str} | {url_display}")
        print(f"   {thoughts_generated} thoughts from {processed - filtered} convs | {skipped_so_far} skipped | ETA {eta_str}")

        # 5. Prepare text for extraction (context window aware, session splitting)
        session_texts = prepare_dialogue_for_extraction(messages, total)

        # 6. Extract knowledge (multi-session merge)
        all_thoughts = []
        conversation_type = ""
        summaries = {}

        for session_text in session_texts:
            if not session_text:
                continue
            if args.raw:
                all_thoughts.append({
                    "content": session_text,
                    "type": "reference",
                    "topics": [],
                    "people": [],
                    "confidence": "firm",
                })
            else:
                extraction = summarize(title, date_str, session_text, message_count,
                                       conv_meta.get("model_slug", ""), args)
                all_thoughts.extend(extraction.get("thoughts", []))
                if not conversation_type:
                    conversation_type = extraction.get("conversation_type", "")
                if extraction.get("summaries"):
                    summaries = extraction["summaries"]  # Use last session's summaries

        # Build merged extraction result
        extraction = {
            "thoughts": all_thoughts,
            "conversation_type": conversation_type,
            "summaries": summaries,
        }

        thoughts_generated += len(all_thoughts)

        if not all_thoughts:
            print("   -> No thoughts extracted")
            if not args.dry_run:
                sync_log["ingested_ids"][conv_id] = {
                    "imported_at": datetime.now(timezone.utc).isoformat(),
                    "update_time": conv.get("update_time", 0),
                }
                save_sync_log(sync_log)
            print()
            continue

        if args.verbose or args.dry_run:
            for i, thought_data in enumerate(all_thoughts, 1):
                content = thought_data["content"]
                preview = content if len(content) <= 200 else content[:200] + "..."
                thought_type = thought_data.get("type", "")
                topics = ", ".join(thought_data.get("topics", []))
                people = ", ".join(thought_data.get("people", []))
                confidence = thought_data.get("confidence", "")
                tags = []
                if topics:
                    tags.append(topics)
                if people:
                    tags.append(f"people: {people}")
                if confidence and confidence != "firm":
                    tags.append(confidence)
                tag_str = f" ({'; '.join(tags)})" if tags else ""
                print(f"   Thought {i} [{thought_type}]{tag_str}: {preview}")

        if (args.verbose or args.dry_run) and summaries:
            print(f"   --- Conversation Summary ---")
            for level in ("summary_8w", "summary_16w", "summary_32w", "summary_64w", "summary_128w"):
                text = summaries.get(level, "")
                if text:
                    label = level.replace("summary_", "")
                    print(f"   [{label}] {text}")

        if args.report:
            report_entries.append({
                "title": title,
                "date": date_str,
                "messages": message_count,
                "words": word_count,
                "thoughts": all_thoughts,  # Full thought dicts with content, type, topics, people, confidence
                "conversation_type": conversation_type,
                "summaries": summaries,
            })

        if args.dry_run:
            print()
            continue

        # 7. Ingest thoughts
        all_ok = True
        for i, thought_data in enumerate(all_thoughts):
            # Build enriched metadata per thought
            metadata = {
                # Existing OB1 fields (MCP-compatible)
                "source": "chatgpt",
                "type": thought_data["type"],
                "topics": thought_data["topics"],
                "people": thought_data["people"],
                "action_items": [],

                # ChatGPT provenance
                "chatgpt_conversation_id": chatgpt_id,
                "chatgpt_title": title,
                "chatgpt_date": date_str,
                "chatgpt_conversation_url": f"https://chatgpt.com/c/{chatgpt_id}" if chatgpt_id else None,

                # Enrichment fields
                "chatgpt_model": conv_meta["model_slug"],
                "chatgpt_message_count": message_count,
                "chatgpt_conversation_type": extraction.get("conversation_type", ""),
                "confidence": thought_data["confidence"],
                "voice": conv_meta["voice"],
                "gizmo_id": conv_meta["gizmo_id"],
                "language": extraction.get("language", "en"),
            }

            content = f"[ChatGPT: {title} | {date_str}] {thought_data['content']}"

            # Semantic dedup check (Supabase direct mode only)
            if not args.ingest_endpoint:
                if check_semantic_duplicate(thought_data["content"]):
                    print(f"   -> Thought {i + 1} skipped (semantic duplicate)")
                    duplicates_skipped += 1
                    continue

            # Ingest — embed thought content, not the [ChatGPT: title] prefix
            if args.ingest_endpoint:
                extra_metadata = {
                    "chatgpt_title": title,
                    "chatgpt_create_time": date_str,
                    "chatgpt_conversation_hash": conv_id,
                    "source_ref": metadata,
                }
                result = ingest_thought_endpoint(content, extra_metadata, full_text=dialogue_text)
            else:
                result = ingest_thought_supabase(content, metadata, embed_text=thought_data["content"])

            if result.get("ok"):
                ingested += 1
                print(f"   -> Thought {i + 1} ingested [{thought_data['type']}]")
            else:
                errors += 1
                all_ok = False
                print(f"   -> ERROR (thought {i + 1}): {result.get('error', 'unknown')}")

            time.sleep(0.2)  # Rate limit

        # 8. Store conversation (--store-conversations)
        if args.store_conversations and not args.ingest_endpoint:
            conv_result = store_conversation(conv, extraction, conv_meta, message_count, import_batch)
            if conv_result.get("ok"):
                conversations_stored += 1
                print(f"   -> Conversation stored")
            else:
                print(f"   -> WARNING: Conversation store failed: {conv_result.get('error')}")

        # 9. Update sync log (with update_time for re-import detection)
        if all_ok:
            sync_log["ingested_ids"][conv_id] = {
                "imported_at": datetime.now(timezone.utc).isoformat(),
                "update_time": conv.get("update_time", 0),
            }
            save_sync_log(sync_log)

        print()

    # ─── Summary ─────────────────────────────────────────────────────────────

    print("\u2500" * 60)
    print("Summary:")
    print(f"  Conversations found:    {total}")
    if already_imported > 0:
        print(f"  Already imported:       {already_imported} (skipped)")
    if filtered > 0:
        reasons = ", ".join(f"{v} {k}" for k, v in sorted(filter_reasons.items(), key=lambda x: -x[1]))
        print(f"  Filtered:               {filtered} ({reasons})")
    print(f"  Processed:              {processed}")
    print(f"  Total words:            {total_words:,}")
    print(f"  Thoughts generated:     {thoughts_generated}")
    if duplicates_skipped > 0:
        print(f"  Duplicates skipped:     {duplicates_skipped}")
    if not args.dry_run:
        print(f"  Ingested:               {ingested}")
        print(f"  Errors:                 {errors}")
    if args.store_conversations and conversations_stored > 0:
        print(f"  Conversations stored:   {conversations_stored}")

    # Cost estimation (updated for new pipeline)
    if not args.raw and processed > 0:
        # gpt-4o-mini via OpenRouter: ~$0.15/1M input, ~$0.60/1M output
        # avg 4000 tokens input per conv, 300 tokens output
        est_input_tokens = processed * 4000
        est_output_tokens = processed * 300
        if args.store_conversations:
            est_output_tokens += processed * 200  # Pyramid summaries
        summarize_cost = (est_input_tokens * 0.15 / 1_000_000) + (est_output_tokens * 0.60 / 1_000_000)
    else:
        summarize_cost = 0

    # Embedding cost: $0.02/1M tokens, ~100 tokens per thought
    embedding_cost = thoughts_generated * 100 * 0.02 / 1_000_000
    # Add dedup check embedding cost
    embedding_cost += thoughts_generated * 100 * 0.02 / 1_000_000
    if args.store_conversations:
        embedding_cost += conversations_stored * 150 * 0.02 / 1_000_000
    total_cost = summarize_cost + embedding_cost
    print(f"  Est. API cost:          ${total_cost:.4f}")
    if summarize_cost > 0:
        print(f"    Extraction:           ${summarize_cost:.4f}")
    if embedding_cost > 0:
        print(f"    Embeddings:           ${embedding_cost:.4f}")

    elapsed = time.time() - start_time
    print(f"  Elapsed time:           {int(elapsed // 60)}m{int(elapsed % 60)}s")
    print("\u2500" * 60)

    if args.report and report_entries:
        _write_report(args.report, report_entries, {
            "total": total,
            "already_imported": already_imported,
            "filtered": filtered,
            "filter_reasons": filter_reasons,
            "processed": processed,
            "thoughts_generated": thoughts_generated,
            "ingested": ingested,
            "errors": errors,
            "total_words": total_words,
            "dry_run": args.dry_run,
            "conversations_stored": conversations_stored,
            "duplicates_skipped": duplicates_skipped,
        })


def _write_report(filepath, entries, stats):
    """Write a markdown report of imported conversations."""
    with Path(filepath).open("w", encoding="utf-8", newline="\n") as f:
        mode = "DRY RUN" if stats["dry_run"] else "LIVE"
        f.write(f"# ChatGPT Import Report ({mode})\n\n")
        f.write(f"Generated: {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M UTC')}\n\n")

        f.write("## Stats\n\n")
        f.write(f"| Metric | Value |\n|--------|-------|\n")
        f.write(f"| Conversations found | {stats['total']} |\n")
        f.write(f"| Already imported | {stats['already_imported']} |\n")
        f.write(f"| Filtered | {stats['filtered']} |\n")
        f.write(f"| Processed | {stats['processed']} |\n")
        f.write(f"| Thoughts generated | {stats['thoughts_generated']} |\n")
        if stats.get("duplicates_skipped"):
            f.write(f"| Duplicates skipped | {stats['duplicates_skipped']} |\n")
        if not stats["dry_run"]:
            f.write(f"| Ingested | {stats['ingested']} |\n")
            f.write(f"| Errors | {stats['errors']} |\n")
        if stats.get("conversations_stored"):
            f.write(f"| Conversations stored | {stats['conversations_stored']} |\n")
        f.write(f"| Total words | {stats['total_words']:,} |\n")
        f.write("\n")

        f.write("## Conversations\n\n")
        for entry in entries:
            conv_type = entry.get("conversation_type", "")
            type_label = f" [{conv_type}]" if conv_type else ""
            f.write(f"### {entry['title']} ({entry['date']}){type_label}\n\n")
            f.write(f"_{entry['messages']} messages, {entry['words']} words_\n\n")
            for i, thought in enumerate(entry["thoughts"], 1):
                if isinstance(thought, dict):
                    thought_type = thought.get("type", "")
                    content = thought.get("content", "")
                    topics = ", ".join(thought.get("topics", []))
                    people = ", ".join(thought.get("people", []))
                    confidence = thought.get("confidence", "")
                    type_tag = f"`{thought_type}`" if thought_type else ""
                    meta_parts = []
                    if topics:
                        meta_parts.append(f"topics: {topics}")
                    if people:
                        meta_parts.append(f"people: {people}")
                    if confidence:
                        meta_parts.append(f"confidence: {confidence}")
                    meta_str = f" _({'; '.join(meta_parts)})_" if meta_parts else ""
                    f.write(f"{i}. {type_tag} {content}{meta_str}\n")
                else:
                    # Backward compat: plain string thoughts
                    f.write(f"{i}. {thought}\n")
            f.write("\n")

    print(f"\nReport written to {filepath}")


if __name__ == "__main__":
    main()
