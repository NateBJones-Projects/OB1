#!/usr/bin/env python3
"""Backfill Substack articles into Open Brain v2.

Usage:
    python3 backfill.py [--dry-run] [--start YYYY-MM-DD] [--delay SECONDS]

Requires: requests (pip install -r requirements.txt)
"""
import argparse
import json
import os
import re
import sys
import time
import html as html_mod
import urllib.request
import urllib.error

# --- Config ---
# Load .env.local
from pathlib import Path
_env_path = Path(os.getcwd()) / ".env.local"
if _env_path.exists():
    for _line in _env_path.read_text().splitlines():
        _m = re.match(r'^\s*([A-Za-z_]\w*)\s*=\s*(.*?)\s*$', _line)
        if _m and not os.environ.get(_m.group(1)):
            os.environ[_m.group(1)] = _m.group(2).strip('"').strip("'")

SUBSTACK = "natesnewsletter.substack.com"
COOKIE = "substack.sid=" + (os.environ.get("SUBSTACK_SID") or "")
# Changed to Supabase Edge Function URL
CAPTURE_URL = "https://zpeedfgyuusscsrirzsg.supabase.co/functions/v1/open-brain-mcp"
MCP_ACCESS_KEY = "103b14a836b25e08c9a83fe1faf7dd404f38ed06278c17e05b5a933d6bb9ef64"
CUTOFF_DATE = "2026-01-01"

HEADERS = {
    "Cookie": COOKIE,
    "User-Agent": "OpenBrain/2.0",  # Updated User-Agent
}


def fetch_url(url, retries=5, delay=10):
    """Fetch URL with retry logic for rate limiting."""
    for attempt in range(retries):
        try:
            req = urllib.request.Request(url, headers=HEADERS)
            resp = urllib.request.urlopen(req, timeout=30)
            return resp.read().decode("utf-8")
        except urllib.error.HTTPError as e:
            if e.code in (403, 429):
                wait = delay * (2 ** attempt) + (attempt * 5)
                print(f"  Rate limited ({e.code}), waiting {wait}s... (attempt {attempt+1}/{retries})")
                time.sleep(wait)
            elif e.code == 404:
                return None
            else:
                print(f"  HTTP {e.code} for {url}: {e.read().decode()[:200]}")
                return None
        except Exception as e:
            print(f"  Error fetching {url}: {e}")
            time.sleep(delay)
    return None


def get_already_captured():
    """Get set of Substack article titles already captured (placeholder - will need MCP query)."""
    # TODO: Implement MCP query to check existing captures
    captured = set()
    return captured


def get_archive_posts(cutoff=CUTOFF_DATE):
    """Paginate through Substack archive to get all posts since cutoff."""
    posts = []
    offset = 0
    while True:
        url = f"https://{SUBSTACK}/api/v1/archive?sort=new&offset={offset}&limit=12&search="
        html = fetch_url(url, delay=10)
        if not html:
            break

        batch = json.loads(html)
        if not batch:
            break

        for p in batch:
            post_date = p.get("post_date", "")[:10]
            if post_date >= cutoff:
                posts.append(p)

        oldest = batch[-1].get("post_date", "")[:10]
        print(f"  Archived fetched: offset={offset}, batch={len(batch)}, oldest={oldest}")

        if oldest < cutoff:
            break

        offset += 12
        time.sleep(2)  # Be nice to Substack

    return posts


def extract_post_content(url):
    """Fetch a post page and extract full content from _preloads JSON."""
    html = fetch_url(url, delay=3)
    if not html:
        return None

    match = re.search(r'window\._preloads\s*=\s*JSON\.parse\("(.*?)"\)', html)
    if not match:
        print(f"  No _preloads found for {url}")
        return None

    raw = match.group(1).encode().decode("unicode_escape")
    data = json.loads(raw)
    post = data.get("post", {})

    body_html = post.get("body_html", "")
    if not body_html:
        print(f"  Empty body for {url}")
        return None

    # Convert HTML to text
    text = re.sub(r"<[^>]+>", " ", body_html)
    text = html_mod.unescape(text)
    text = re.sub(r"\s+", " ", text).strip()

    # Extract meaningful links (no images, no substack internal)
    all_links = re.findall(r'href="(https?://[^"]+)"', body_html)
    links = []
    seen = set()
    for link in all_links:
        if any(skip in link for skip in ["substackcdn.com", "substack.com/p/", "substack.com/profile/"]):
            continue
        if link in seen:
            continue
        seen.add(link)
        links.append(link)

    return {
        "title": post.get("title", "Untitled"),
        "date": post.get("post_date", ""),
        "content": text,
        "links": links,
        "url": url,
    }


def fetch_github_readme(url):
    """Fetch raw README from a GitHub URL."""
    # Convert github.com/owner/repo/tree/branch/path to raw
    match = re.match(r"https://github\.com/([^/]+)/([^/]+)/tree/([^/]+)/(.+)", url)
    if match:
        owner, repo, branch, path = match.groups()
        raw_url = f"https://raw.githubusercontent.com/{owner}/{repo}/{branch}/{path}/README.md"
    else:
        match = re.match(r"https://github\.com/([^/]+)/([^/]+)$", url)
        if match:
            owner, repo = match.groups()
            raw_url = f"https://raw.githubusercontent.com/{owner}/{repo}/main/README.md"
        else:
            return None

    return fetch_url(raw_url, retries=2, delay=3)


def get_embedding(text):
    """Get OpenAI embedding."""
    url = "https://api.openai.com/v1/embeddings"
    data = json.dumps({"model": "text-embedding-3-small", "input": text[:2000]}).encode()
    req = urllib.request.Request(url, data=data, headers={
        "Authorization": f"Bearer {os.environ.get('OPENAI_API_KEY', '')}",
        "Content-Type": "application/json",
    })
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.loads(resp.read())["data"][0]["embedding"]


def capture_article(article, dry_run=False):
    """Insert article directly into Supabase."""
    if dry_run:
        print(f"  [DRY RUN] Would capture: {article['title'][:60]}")
        return True

    content = f"Substack: {article['title']}\n\n{article['content'][:8000]}"
    metadata = {
        "source": "substack-natesnewsletter",
        "title": article["title"][:300],
        "url": article.get("url", ""),
        "date": article.get("date", "")[:10],
        "links": article.get("links", [])[:10],
    }

    try:
        embedding = get_embedding(content[:2000])
    except Exception as e:
        print(f"  Embedding failed: {e}")
        return False

    supabase_url = os.environ.get("OPEN_BRAIN_URL", "")
    supabase_key = os.environ.get("OPEN_BRAIN_SERVICE_KEY", "")
    body = json.dumps({
        "content": content,
        "embedding": embedding,
        "source_type": "substack",
        "metadata": metadata,
    }).encode()

    req = urllib.request.Request(
        f"{supabase_url}/rest/v1/thoughts",
        data=body,
        headers={
            "apikey": supabase_key,
            "Authorization": f"Bearer {supabase_key}",
            "Content-Type": "application/json",
            "Prefer": "return=minimal",
        },
    )
    try:
        urllib.request.urlopen(req, timeout=30)
        return True
    except urllib.error.HTTPError as e:
        if e.code == 409:
            return True  # Duplicate, fine
        print(f"  Insert failed ({e.code}): {e.read().decode()[:200]}")
        return False
    except Exception as e:
        print(f"  Capture failed for '{article['title'][:40]}': {e}")
        return False


def main():
    parser = argparse.ArgumentParser(description="Backfill Substack articles into Open Brain v2")
    parser.add_argument("--dry-run", action="store_true", help="Don't actually capture")
    parser.add_argument("--start", default=CUTOFF_DATE, help="Start date (YYYY-MM-DD)")
    parser.add_argument("--delay", type=float, default=3.0, help="Delay between fetches (seconds)")
    parser.add_argument("--skip-existing", action="store_true", default=True, help="Skip already captured")
    parser.add_argument("--substack", default="natesnewsletter.substack.com", help="Substack domain")
    args = parser.parse_args()

    # Update config from args
    global SUBSTACK
    global COOKIE
    SUBSTACK = args.substack

    print(f"=== Substack Backfill v2: {SUBSTACK} since {args.start} ===\n")

    # Step 1: Get already-captured titles
    if args.skip_existing:
        print("Checking already-captured articles...")
        existing = get_already_captured()
        print(f"  Found {len(existing)} existing articles\n")
    else:
        existing = set()

    # Step 2: Get archive index
    print("Fetching archive index...")
    posts = get_archive_posts(args.start)
    print(f"  Total posts since {args.start}: {len(posts)}\n")

    # Step 3: Process each post
    captured = 0
    skipped = 0
    failed = 0

    for i, post in enumerate(posts):
        title = post.get("title", "Untitled")
        url = post.get("canonical_url", "")
        post_date = post.get("post_date", "")[:10]

        # Skip if already captured
        if args.skip_existing and title.strip().lower() in existing:
            print(f"[{i+1}/{len(posts)}] SKIP (exists): {title[:60]}")
            skipped += 1
            continue

        print(f"[{i+1}/{len(posts)}] {post_date} | {title[:60]}")

        # Step 3a: Fetch full content
        article = extract_post_content(url)
        if not article:
            print(f"  FAILED to extract content")
            failed += 1
            continue

        print(f"  Content: {len(article['content'])} chars, {len(article['links'])} links")

        # Step 3b: Capture main article
        if capture_article(article, dry_run=args.dry_run):
            captured += 1
            print(f"  Captured article")
        else:
            failed += 1
            continue

        # Step 3c: Fetch and capture linked GitHub repos (prompts)
        for link in article.get("links", []):
            if "github.com/NateBJones-Projects" in link:
                print(f"  Fetching GitHub prompt: {link}")
                readme = fetch_github_readme(link)
                if readme:
                    prompt_article = {
                        "title": f"{article['title']} — Linked Prompt",
                        "content": readme[:50000],  # Cap at 50K chars
                        "links": [link],
                        "source": "github-prompt",
                    }
                    if capture_article(prompt_article, dry_run=args.dry_run):
                        captured += 1
                        print(f"    Captured prompt ({len(readme)} chars)")
                    time.sleep(args.delay + 2)

        time.sleep(args.delay + 5)  # Extra delay between articles to avoid 429

    # Summary
    print(f"\n=== Done ===")
    print(f"Captured: {captured}")
    print(f"Skipped (existing): {skipped}")
    print(f"Failed: {failed}")
    print(f"Total processed: {len(posts)}")


if __name__ == "__main__":
    main()