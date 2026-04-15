import pytest
from notes_parser import extract_links, html_to_markdown


class TestExtractLinks:
    def test_extracts_https_urls(self):
        html = '<p><a href="https://example.com">link</a></p>'
        web_urls, note_links = extract_links(html)
        assert web_urls == ['https://example.com']
        assert note_links == []

    def test_extracts_http_urls(self):
        html = '<p><a href="http://example.com/page">link</a></p>'
        web_urls, _ = extract_links(html)
        assert web_urls == ['http://example.com/page']

    def test_extracts_notelinks_protocol(self):
        html = '<p><a href="notelinks://ABC123">note</a></p>'
        web_urls, note_links = extract_links(html)
        assert note_links == ['notelinks://ABC123']
        assert web_urls == []

    def test_extracts_xcoredata_protocol(self):
        html = '<p><a href="x-coredata://ABC123/Note/p1">note</a></p>'
        _, note_links = extract_links(html)
        assert note_links == ['x-coredata://ABC123/Note/p1']

    def test_multiple_links(self):
        html = (
            '<p><a href="https://a.com">A</a></p>'
            '<p><a href="https://b.com">B</a></p>'
            '<p><a href="notelinks://N1">N1</a></p>'
        )
        web_urls, note_links = extract_links(html)
        assert 'https://a.com' in web_urls
        assert 'https://b.com' in web_urls
        assert 'notelinks://N1' in note_links

    def test_no_links_returns_empty(self):
        html = '<p>Just text, no links.</p>'
        web_urls, note_links = extract_links(html)
        assert web_urls == []
        assert note_links == []

    def test_ignores_anchor_tags_without_href(self):
        html = '<p><a name="top">anchor</a></p>'
        web_urls, note_links = extract_links(html)
        assert web_urls == []
        assert note_links == []


class TestHtmlToMarkdown:
    def test_converts_h1(self):
        result = html_to_markdown('<h1>Title</h1>')
        assert '# Title' in result

    def test_converts_h2(self):
        result = html_to_markdown('<h2>Section</h2>')
        assert '## Section' in result

    def test_converts_unordered_list(self):
        result = html_to_markdown('<ul><li>Item 1</li><li>Item 2</li></ul>')
        assert '- Item 1' in result
        assert '- Item 2' in result

    def test_converts_bold(self):
        result = html_to_markdown('<p><strong>bold</strong></p>')
        assert '**bold**' in result

    def test_converts_italic(self):
        result = html_to_markdown('<p><em>italic</em></p>')
        assert '_italic_' in result or '*italic*' in result

    def test_preserves_inline_links(self):
        result = html_to_markdown('<p><a href="https://example.com">click</a></p>')
        assert 'https://example.com' in result
        assert 'click' in result

    def test_checklist_done_item(self):
        result = html_to_markdown('<ul><li data-done="true">Done task</li></ul>')
        assert '[x]' in result

    def test_checklist_undone_item(self):
        result = html_to_markdown('<ul><li data-done="false">Pending task</li></ul>')
        assert '[ ]' in result

    def test_plain_paragraph(self):
        result = html_to_markdown('<p>Hello world</p>')
        assert 'Hello world' in result

    def test_strips_excess_blank_lines(self):
        result = html_to_markdown('<p>A</p><p>B</p>')
        assert '\n\n\n' not in result
