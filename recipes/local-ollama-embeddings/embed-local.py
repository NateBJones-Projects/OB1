#!/usr/bin/env python3
"""
Open Brain — Local Ollama Embeddings

Generates embeddings locally via Ollama and inserts thoughts into Supabase.
No OpenRouter or cloud API key required for the embedding step.

Usage:
    echo "My thought" | python embed-local.py
    python embed-local.py "My thought as an argument"
    python embed-local.py --file thoughts.txt
    python embed-local.py --file thoughts.jsonl

Input formats:
    Plain text:    One thought per line (blank lines skipped)
    JSONL:         One JSON object per line with "content" key
                   Optional keys: "source", "metadata" (merged into metadata)

Options:
    --file FILE            Read thoughts from a file (.txt or .jsonl)
    --model NAME           Ollama embedding model (default: nomic-embed-text)
    --ollama-url URL       Ollama base URL (default: http://localhost:11434)
    --source LABEL         Source label for metadata (default: ollama-local)
    --dry-run              Generate embeddings but don't insert into Supabase
    --verbose              Print each thought and embedding dimension
    --batch-size N         Thoughts per Ollama embed request (default: 1)

Environment variables:
    SUPABASE_URL               Supabase project URL
    SUPABASE_SERVICE_ROLE_KEY  Supabase service role key
    OLLAMA_BASE_URL            Ollama base URL (overridden by --ollama-url)
"""

import argparse
import json
import os
import sys
import time
from datetime import datetime, timezone

try:
    import requests
except ImportError:
    print("Error: 'requests' package required. Install with: pip install requests")
    sys.exit(1)

# ─── Configuration ───────────────────────────────────────────────────────────

SUPABASE_URL = os.environ.get("SUPABASE_URL", "")
SUPABASE_SERVICE_ROLE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
OLLAMA_BASE_URL = os.environ.get("OLLAMA_BASE_URL", "http://localhost:11434")

DEFAULT_MODEL = "nomic-embed-text"

# Expected embedding dimensions per model (for validation)
KNOWN_DIMENSIONS = {
    "nomic-embed-text": 768,
    "mxbai-embed-large": 1024,
    "rjmalagon/gte-qwen2-1.5b-instruct-embed-f16": 1536,
}


# ─── HTTP Helpers ────────────────────────────────────────────────────────────


def http_post(url, headers, body, timeout=60):
    """POST JSON with basic retry (2 attempts)."""
    for attempt in range(2):
        try:
            resp = requests.post(url, headers=headers, json=body, timeout=timeout)
            return resp
        except requests.RequestException as e:
            if attempt == 0:
                time.sleep(1)
                continue
            print(f"   Warning: Request failed after 2 attempts: {e}")
            return None
    return None


# ─── Ollama Embedding ────────────────────────────────────────────────────────


def generate_embedding(text, model, ollama_url):
    """Generate an embedding via Ollama's /api/embed endpoint."""
    truncated = text[:8000]

    resp = http_post(
        f"{ollama_url}/api/embed",
        headers={"Content-Type": "application/json"},
        body={
            "model": model,
            "input": truncated,
        },
        timeout=120,
    )

    if not resp or resp.status_code != 200:
        status = resp.status_code if resp else "no response"
        print(f"   Warning: Ollama embedding failed ({status})")
        if resp:
            try:
                print(f"   Detail: {resp.json()}")
            except ValueError:
                print(f"   Detail: {resp.text[:200]}")
        return None

    try:
        data = resp.json()
        embedding = data["embeddings"][0]
        return embedding
    except (KeyError, IndexError) as e:
        print(f"   Warning: Failed to parse Ollama response: {e}")
        return None


# ─── Supabase Ingestion ──────────────────────────────────────────────────────


def ingest_thought(content, embedding, metadata_dict):
    """Insert a thought into Supabase with the provided embedding."""
    resp = http_post(
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


# ─── Input Parsing ────────────────────────────────────────────────────────────


def read_thoughts_from_file(filepath):
    """Read thoughts from a .txt or .jsonl file. Returns list of dicts."""
    thoughts = []

    if filepath.endswith(".jsonl"):
        with open(filepath, "r") as f:
            for line_num, line in enumerate(f, 1):
                line = line.strip()
                if not line:
                    continue
                try:
                    obj = json.loads(line)
                    content = obj.get("content", "").strip()
                    if not content:
                        print(f"   Warning: Line {line_num} missing 'content' key, skipped")
                        continue
                    thoughts.append({
                        "content": content,
                        "source": obj.get("source"),
                        "metadata": obj.get("metadata"),
                    })
                except json.JSONDecodeError as e:
                    print(f"   Warning: Line {line_num} invalid JSON ({e}), skipped")
    else:
        with open(filepath, "r") as f:
            for line in f:
                line = line.strip()
                if line:
                    thoughts.append({"content": line})

    return thoughts


def read_thoughts_from_stdin():
    """Read thoughts from stdin, one per line."""
    thoughts = []
    for line in sys.stdin:
        line = line.strip()
        if line:
            thoughts.append({"content": line})
    return thoughts


# ─── CLI ──────────────────────────────────────────────────────────────────────


def parse_args():
    parser = argparse.ArgumentParser(
        description="Generate local embeddings via Ollama and insert into Open Brain",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""\
Examples:
  echo "My important thought" | python embed-local.py
  python embed-local.py "A thought passed as an argument"
  python embed-local.py --file notes.txt
  python embed-local.py --file thoughts.jsonl --model nomic-embed-text --dry-run
  cat notes.txt | python embed-local.py --source journal --verbose""",
    )
    parser.add_argument("text", nargs="*", help="Thought(s) to embed (positional arguments)")
    parser.add_argument("--file", type=str, help="Read thoughts from a file (.txt or .jsonl)")
    parser.add_argument("--model", type=str, default=DEFAULT_MODEL, help=f"Ollama embedding model (default: {DEFAULT_MODEL})")
    parser.add_argument("--ollama-url", type=str, default=None, help=f"Ollama base URL (default: {OLLAMA_BASE_URL})")
    parser.add_argument("--source", type=str, default="ollama-local", help="Source label for metadata (default: ollama-local)")
    parser.add_argument("--dry-run", action="store_true", help="Generate embeddings but don't insert into Supabase")
    parser.add_argument("--verbose", action="store_true", help="Print each thought and embedding info")
    parser.add_argument("--batch-size", type=int, default=1, help="Thoughts per request (default: 1)")
    return parser.parse_args()


# ─── Main ─────────────────────────────────────────────────────────────────────


def main():
    args = parse_args()
    ollama_url = args.ollama_url or OLLAMA_BASE_URL

    # Collect thoughts from all input sources
    thoughts = []

    if args.file:
        if not os.path.isfile(args.file):
            print(f"Error: File not found: {args.file}")
            sys.exit(1)
        thoughts = read_thoughts_from_file(args.file)
    elif args.text:
        thoughts = [{"content": t} for t in args.text]
    elif not sys.stdin.isatty():
        thoughts = read_thoughts_from_stdin()
    else:
        print("Error: No input provided.")
        print("Usage: echo 'text' | python embed-local.py")
        print("       python embed-local.py 'text'")
        print("       python embed-local.py --file notes.txt")
        sys.exit(1)

    if not thoughts:
        print("No thoughts to process.")
        sys.exit(0)

    # Validate environment
    if not args.dry_run:
        if not SUPABASE_URL:
            print("Error: SUPABASE_URL environment variable required.")
            print("Set it to your Supabase project URL (e.g., https://xxxxx.supabase.co)")
            sys.exit(1)
        if not SUPABASE_SERVICE_ROLE_KEY:
            print("Error: SUPABASE_SERVICE_ROLE_KEY environment variable required.")
            sys.exit(1)

    # Check Ollama connectivity
    try:
        resp = requests.get(f"{ollama_url}/api/tags", timeout=5)
        if resp.status_code != 200:
            print(f"Warning: Ollama returned {resp.status_code} — is it running at {ollama_url}?")
    except requests.RequestException:
        print(f"Error: Cannot reach Ollama at {ollama_url}")
        print("Start Ollama with: ollama serve")
        print(f"Then pull the model: ollama pull {args.model}")
        sys.exit(1)

    # Display run configuration
    mode = "DRY RUN" if args.dry_run else "LIVE"
    dim_info = f" ({KNOWN_DIMENSIONS[args.model]}-dim)" if args.model in KNOWN_DIMENSIONS else ""
    print(f"\nOpen Brain — Local Ollama Embeddings")
    print(f"  Mode:     {mode}")
    print(f"  Model:    {args.model}{dim_info}")
    print(f"  Ollama:   {ollama_url}")
    print(f"  Source:   {args.source}")
    print(f"  Thoughts: {len(thoughts)}")
    if args.model in KNOWN_DIMENSIONS and KNOWN_DIMENSIONS[args.model] != 1536:
        print(f"\n  NOTE: {args.model} produces {KNOWN_DIMENSIONS[args.model]}-dim embeddings.")
        print(f"  The default Open Brain schema uses vector(1536).")
        print(f"  Adjust your schema to match: ALTER TABLE thoughts ALTER COLUMN embedding TYPE vector({KNOWN_DIMENSIONS[args.model]});")
    print()

    # Process
    embedded = 0
    ingested = 0
    errors = 0

    for i, thought in enumerate(thoughts, 1):
        content = thought["content"]
        preview = content if len(content) <= 80 else content[:77] + "..."
        print(f"{i}/{len(thoughts)}: {preview}")

        # Generate embedding
        embedding = generate_embedding(content, args.model, ollama_url)
        if not embedding:
            errors += 1
            print(f"   -> FAILED to generate embedding")
            continue

        embedded += 1
        if args.verbose:
            print(f"   -> Embedding: {len(embedding)}-dim")

        if args.dry_run:
            print(f"   -> OK (dry run)")
            continue

        # Build metadata
        metadata = {
            "source": thought.get("source") or args.source,
            "embedding_model": args.model,
            "embedded_at": datetime.now(timezone.utc).isoformat(),
        }
        if thought.get("metadata") and isinstance(thought["metadata"], dict):
            metadata.update(thought["metadata"])

        # Ingest
        result = ingest_thought(content, embedding, metadata)
        if result.get("ok"):
            ingested += 1
            print(f"   -> Ingested")
        else:
            errors += 1
            print(f"   -> ERROR: {result.get('error', 'unknown')}")

        time.sleep(0.1)  # Gentle rate limit

    # Summary
    print()
    print("-" * 50)
    print("Summary:")
    print(f"  Input:     {len(thoughts)} thoughts")
    print(f"  Embedded:  {embedded}")
    if not args.dry_run:
        print(f"  Ingested:  {ingested}")
    print(f"  Errors:    {errors}")
    print(f"  API cost:  $0.00 (local)")
    print("-" * 50)


if __name__ == "__main__":
    main()
