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
