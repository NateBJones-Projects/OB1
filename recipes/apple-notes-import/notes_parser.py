"""
notes_parser.py — Pure parsing functions for Apple Notes import.
All functions are side-effect free and fully unit-testable.
"""

import hashlib
import re

from bs4 import BeautifulSoup
from markdownify import markdownify as md


def extract_links(html: str) -> tuple[list[str], list[str]]:
    """
    Extract web URLs and note-to-note links from raw Apple Notes HTML.

    Returns (web_urls, note_links) where:
    - web_urls: hrefs starting with http:// or https://
    - note_links: hrefs starting with notelinks:// or x-coredata://
    """
    soup = BeautifulSoup(html, 'html.parser')
    web_urls: list[str] = []
    note_links: list[str] = []

    for tag in soup.find_all('a', href=True):
        href: str = tag['href']
        if href.startswith(('http://', 'https://')):
            web_urls.append(href)
        elif href.startswith(('notelinks://', 'x-coredata://')):
            note_links.append(href)

    return web_urls, note_links


def html_to_markdown(html: str) -> str:
    """
    Convert Apple Notes HTML body to clean Markdown.

    Handles Apple Notes-specific conventions:
    - <h1>/<h2> -> # / ##
    - <ul>/<li> -> -
    - <li data-done="true/false"> -> - [x] / - [ ]
    - <strong>/<em> -> **bold** / _italic_
    - <a href> -> [text](url) (web links preserved inline)
    """
    soup = BeautifulSoup(html, 'html.parser')

    # Pre-process checklist items — markdownify doesn't handle data-done
    for li in soup.find_all('li'):
        if li.has_attr('data-done'):
            marker = '[x] ' if li['data-done'] == 'true' else '[ ] '
            li.insert(0, marker)
            del li['data-done']

    converted = md(str(soup), heading_style='ATX', bullets='-')

    # Collapse 3+ consecutive blank lines to 2
    converted = re.sub(r'\n{3,}', '\n\n', converted)

    return converted.strip()


# ─── Chunking ─────────────────────────────────────────────────────────────────

def chunk_note(markdown: str, title: str, folder: str, max_words: int = 500) -> list[str]:
    """
    Split a note into atomic thoughts for Open Brain.

    - Notes under max_words -> single thought
    - Notes with ## headings -> one thought per section
    - Long notes without headings -> single thought (LLM distillation in importer)

    Each chunk is prefixed: [Apple Notes: {title} | {folder}]
    """
    prefix = f"[Apple Notes: {title} | {folder}]"
    word_count = len(markdown.split())

    if word_count <= max_words:
        return [f"{prefix}\n\n{markdown}"]

    sections = re.split(r'\n(?=## )', markdown)
    if len(sections) > 1:
        return [f"{prefix}\n\n{s.strip()}" for s in sections if s.strip()]

    # No headings — single chunk; LLM distillation handled by importer
    return [f"{prefix}\n\n{markdown}"]


# ─── Fingerprint ──────────────────────────────────────────────────────────────

def compute_fingerprint(content: str) -> str:
    """SHA-256 of normalised content (lowercase, collapsed whitespace)."""
    normalised = ' '.join(content.lower().split())
    return hashlib.sha256(normalised.encode('utf-8')).hexdigest()


# ─── Secret scanning ──────────────────────────────────────────────────────────

_SECRET_PATTERNS = [
    r'sk-[A-Za-z0-9]{20,}',
    r'AKIA[0-9A-Z]{16}',
    r'AIza[0-9A-Za-z_-]{20,}',
    r'gh[pousr]_[A-Za-z0-9]{30,}',
    r'github_pat_[A-Za-z0-9_]{20,}',
    r'xox[baprs]-[A-Za-z0-9-]{10,}',
    r'-----BEGIN\s+(RSA\s+|EC\s+)?PRIVATE\s+KEY-----',
    r'eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}',
    r'(password|passwd|secret|api_key)\s*=\s*["\'][^"\']{8,}["\']',
]


def scan_for_secrets(content: str) -> list[str]:
    """
    Return list of matched patterns if potential secrets are detected.
    Empty list means content is clean.
    """
    return [p for p in _SECRET_PATTERNS if re.search(p, content, re.IGNORECASE)]
