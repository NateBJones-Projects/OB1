# Heavy File Ingestion

> Convert heavyweight files into agent-friendly markdown, CSV, and a lightweight index before analysis.

## What It Does

Heavy File Ingestion stops agents from wasting expensive context on raw PDFs, slide decks, spreadsheets, and other bulky files. It routes each file through a deterministic conversion step first, writes a reusable artifact to disk, and creates a small index so the main agent can decide whether it even needs deeper analysis.

## Supported Clients

- Claude Code
- Codex
- Claude Desktop
- Cursor
- Any AI client that supports reusable skills, rules, or custom instructions and can run local scripts

## Prerequisites

- Python 3.10+
- `uv` or `pip` for optional converter dependencies
- AI client that can load a reusable skill file and run local commands
- Working Open Brain setup if you want to pair this with Open Brain capture or retrieval flows ([guide](../../docs/01-getting-started.md))

## Installation

1. Copy the entire [`heavy-file-ingestion`](./) folder into a place your AI client can access, not just `SKILL.md`. The skill expects the bundled `scripts/` and `references/` folders to stay next to it.
1. For Claude Code, place the folder at `~/.claude/skills/heavy-file-ingestion/`.
1. For Codex or Cursor, keep the folder in your workspace or copy the contents into that client's skills or rules location.
1. Restart or reload the client so it picks up [`SKILL.md`](./SKILL.md).
1. When you want the deterministic converters available, run the skill script with either:

```bash
uv run \
  --with pdfplumber \
  --with python-docx \
  --with python-pptx \
  --with openpyxl \
  python skills/heavy-file-ingestion/scripts/convert_heavy_file.py /absolute/path/to/file.pdf
```

1. If you already have `markitdown` installed and want to prefer it for rich document conversion, add `--prefer markitdown`.

## Downloadable Variants

If you want packaged client-specific downloads instead of the raw source folder, use:

- Claude Code: [../../resources/heavy-file-ingestion-claude-code.zip](../../resources/heavy-file-ingestion-claude-code.zip)
- Codex: [../../resources/heavy-file-ingestion-codex.zip](../../resources/heavy-file-ingestion-codex.zip)
- Claude Desktop: [../../resources/heavy-file-ingestion-claude-desktop.skill](../../resources/heavy-file-ingestion-claude-desktop.skill)

The Claude Code and Codex downloads include the bundled `scripts/` and `references/` directories. The Claude Desktop `.skill` is intentionally lighter because Claude Desktop is better treated as a policy layer than a local conversion runtime.

## Trigger Conditions

- The user asks the agent to "read," "analyze," "summarize," or "extract from" a PDF, DOCX, PPTX, XLSX, CSV, TSV, or other large file
- The file is big enough or structured enough that raw ingestion would burn unnecessary tokens
- The user wants a reusable markdown version, a CSV normalization step, or a quick structural index before analysis
- The agent needs to know whether the file can be handled deterministically or should escalate to a cheap model fallback

## Expected Outcome

When the skill is working correctly, it should:

- Detect that the file should be converted before the main model reads it
- Write an extracted artifact to disk instead of pushing raw content into context
- Create an `index.md` and `index.json` summary with counts, structure hints, preview lines, and quality flags
- Recommend the cheapest safe next step: use the deterministic artifact, escalate to a small model, or retry with a stronger converter

## Open Source Stack

This skill was shaped around a small set of open-source projects with permissive licensing:

- [Microsoft MarkItDown](https://github.com/microsoft/markitdown) for broad document-to-markdown conversion
- [Docling](https://github.com/docling-project/docling) as the heavy-duty fallback for ugly or scanned documents
- [xlsx2csv](https://github.com/dilshod/xlsx2csv) as the reference pattern for spreadsheet normalization
- [pdfplumber](https://github.com/jsvine/pdfplumber) as the reference pattern for cheap PDF indexing and page-level extraction

More detail lives in [`references/open-source-stack.md`](./references/open-source-stack.md).

## Troubleshooting

**Issue:** The extracted PDF markdown is sparse or missing whole pages.  
Solution: Check the generated `index.md`. If it flags `scanned_pdf_suspected` or `low_text_density`, rerun with a stronger converter or use a cheap model only on the extracted artifact, not on the original PDF.

**Issue:** The script says a dependency is missing.  
Solution: Use the `uv run --with ...` command from this README or install the named package with `pip`.

**Issue:** The client can load the skill text but cannot run scripts.  
Solution: Use the skill as policy guidance only and run the bundled script manually from Terminal. The skill is still useful because it tells the main agent when not to read a raw heavyweight file.

## Notes for Other Clients

If your client only supports a single prompt file, paste the contents of [`SKILL.md`](./SKILL.md) into that client and keep the script path nearby. The reusable behavior is the policy: convert first, inspect the index second, and only spend model tokens on the compressed artifact.
