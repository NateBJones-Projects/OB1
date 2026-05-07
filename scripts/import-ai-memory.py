#!/usr/bin/env python3
"""Import ChatGPT and Perplexity memory exports into Open Brain."""
import json, urllib.request, ssl, re, sys, os
from pathlib import Path

def get_embedding(env, text):
    url = "https://api.openai.com/v1/embeddings"
    data = json.dumps({"model": "text-embedding-3-small", "input": text[:2000]}).encode()
    req = urllib.request.Request(url, data=data, headers={
        "Authorization": f"Bearer {env['OPENAI_API_KEY']}",
        "Content-Type": "application/json",
    })
    with urllib.request.urlopen(req, context=ssl.create_default_context()) as resp:
        return json.loads(resp.read())["data"][0]["embedding"]

def insert_thought(env, content, embedding, source_type, metadata):
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

def split_into_items(text, source_name):
    """Split export text into individual capture items by bullet/number."""
    items = []
    current_category = "general"
    for line in text.splitlines():
        line = line.strip()
        if not line:
            continue
        # Detect category headers
        if line.startswith("###") or (line and not line.startswith("-") and not line[0].isdigit() and ":" not in line[:5] and len(line) < 80 and not line.startswith("1.") and not line.startswith("*")):
            # Check if it looks like a category header
            clean = line.lstrip("#").strip().rstrip(":")
            if clean and len(clean.split()) <= 4 and clean[0].isupper():
                current_category = clean.lower().replace(" ", "_")
                continue
        # Detect numbered items: "1. ..." or "23. ..."
        m = re.match(r'^\d+\.\s+(.+)', line)
        if m:
            items.append({"text": m.group(1), "category": current_category, "source": source_name})
            continue
        # Detect bullet items: "- ..."
        if line.startswith("- "):
            items.append({"text": line[2:], "category": current_category, "source": source_name})
            continue
        # Skip headers/separator lines
        if line.startswith("***") or line.startswith("Here's") or line.startswith("Found"):
            continue
    return items

def main():
    env = load_env()
    if not env.get("OPEN_BRAIN_URL"):
        print("ERROR: OPEN_BRAIN_URL missing"); sys.exit(1)
    if not env.get("OPENAI_API_KEY"):
        print("ERROR: OPENAI_API_KEY missing"); sys.exit(1)

    captured = 0
    errors = 0

    for fname, source_name in [("exports/chatgpt/chatgpt.txt", "chatgpt_memory"), ("exports/perplexity/perplexity.txt", "perplexity_memory")]:
        fpath = Path(fname)
        if not fpath.exists():
            print(f"[skip] {fname} not found")
            continue

        text = fpath.read_text()
        items = split_into_items(text, source_name)
        print(f"[{source_name}] Found {len(items)} items")

        for i, item in enumerate(items):
            content = f"[{source_name}] {item['category']}: {item['text']}"
            metadata = {
                "source": source_name,
                "category": item["category"],
                "import_type": "ai_memory_export",
            }

            try:
                embedding = get_embedding(env, content[:2000])
                insert_thought(env, content, embedding, source_name, metadata)
                captured += 1
                if captured % 20 == 0:
                    print(f"  {captured} captured...")
            except Exception as e:
                errors += 1
                if "429" in str(e):
                    import time
                    print("  Rate limited, waiting 10s...")
                    time.sleep(10)
                else:
                    print(f"  [err] {str(e)[:100]}")

    print(f"\nDone: {captured} captured, {errors} errors")

if __name__ == "__main__":
    main()
