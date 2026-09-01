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


from notes_parser import chunk_note, compute_fingerprint, scan_for_secrets


class TestChunkNote:
    def test_short_note_is_single_chunk(self):
        chunks = chunk_note('This is a short note.', 'My Note', 'Work')
        assert len(chunks) == 1
        assert '[Apple Notes: My Note | Work]' in chunks[0]
        assert 'This is a short note.' in chunks[0]

    def test_prefix_format(self):
        chunks = chunk_note('Content', 'Title Here', 'Folder Name')
        assert chunks[0].startswith('[Apple Notes: Title Here | Folder Name]')

    def test_splits_at_h2_headings(self):
        markdown = 'Intro.\n\n## Section A\n\nContent A\n\n## Section B\n\nContent B'
        chunks = chunk_note(markdown, 'Big Note', 'Home', max_words=3)
        assert len(chunks) > 1
        for chunk in chunks:
            assert '[Apple Notes: Big Note | Home]' in chunk

    def test_each_section_chunk_contains_its_heading(self):
        markdown = '## Section A\n\nContent A\n\n## Section B\n\nContent B'
        chunks = chunk_note(markdown, 'Note', 'Folder', max_words=3)
        assert any('Section A' in c for c in chunks)
        assert any('Section B' in c for c in chunks)

    def test_long_note_without_headings_is_single_chunk(self):
        markdown = ' '.join(['word'] * 600)
        chunks = chunk_note(markdown, 'Long', 'Notes')
        assert len(chunks) == 1


class TestComputeFingerprint:
    def test_returns_64_char_hex(self):
        fp = compute_fingerprint('some content')
        assert len(fp) == 64
        assert all(c in '0123456789abcdef' for c in fp)

    def test_same_content_same_fingerprint(self):
        assert compute_fingerprint('hello') == compute_fingerprint('hello')

    def test_different_content_different_fingerprint(self):
        assert compute_fingerprint('hello') != compute_fingerprint('world')

    def test_normalises_whitespace(self):
        assert compute_fingerprint('hello  world') == compute_fingerprint('hello world')

    def test_case_insensitive(self):
        assert compute_fingerprint('Hello World') == compute_fingerprint('hello world')


class TestScanForSecrets:
    def test_clean_content_returns_empty(self):
        assert scan_for_secrets('Meeting notes from today') == []

    def test_detects_openai_style_key(self):
        key = 'sk-' + 'a' * 25
        assert len(scan_for_secrets(f'my api key is {key}')) > 0

    def test_detects_aws_access_key(self):
        key = 'AKIA' + 'IOSFODNN7EXAMPLE'
        assert len(scan_for_secrets(f'aws: {key}')) > 0

    def test_detects_github_pat(self):
        pat = 'ghp_' + 'a' * 36
        assert len(scan_for_secrets(f'auth: {pat}')) > 0

    def test_detects_jwt(self):
        jwt = 'eyJhbGciOiJIUzI1NiJ9' + '.' + 'eyJzdWIiOiJ1c2VyIn0' + '.sig'
        assert len(scan_for_secrets(f'bearer: {jwt}')) > 0

    def test_detects_pem_private_key(self):
        header = '-----BEGIN RSA ' + 'PRIVATE KEY-----'
        assert len(scan_for_secrets(f'{header}\nMIIEowIBAAK...')) > 0
