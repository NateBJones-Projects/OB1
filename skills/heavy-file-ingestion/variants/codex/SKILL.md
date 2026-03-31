---
name: heavy-file-ingestion-codex
description: Use in Codex when a user asks to read, analyze, summarize, or extract from a heavyweight file such as PDF, DOCX, PPTX, XLSX, CSV, or TSV. Convert the file into markdown or CSV first with the bundled script, generate a lightweight index, and only spend model tokens on the compressed artifact.
author: Nate B. Jones
version: 1.0.0
---

# Heavy File Ingestion For Codex

## Problem

Codex can run local commands and inspect files, so direct ingestion of bulky documents is usually the wrong move. Convert first, index second, reason last.

## Trigger Conditions

- The user asks to read or summarize a heavyweight document or spreadsheet
- The file is large, structured, or expensive enough that raw ingestion is wasteful
- The task would be better served by markdown, CSV, or a quick file map

## Process

1. Do not open the raw heavyweight file as your first move if a deterministic conversion path exists.
1. Run the bundled converter from this skill directory:

```bash
python scripts/convert_heavy_file.py /absolute/path/to/file.ext
```

1. If the environment is clean and needs packages, prefer:

```bash
uv run \
  --with pdfplumber \
  --with python-docx \
  --with python-pptx \
  --with openpyxl \
  python scripts/convert_heavy_file.py /absolute/path/to/file.ext
```

1. Read `index.md` first, not the original file.
2. Follow the index recommendation:
   - `read_extracted_artifact`: inspect the generated markdown or CSV
   - `cheap_model_or_stronger_converter`: retry with a better deterministic tool or use a cheaper model on the extracted artifact only
   - `manual_review`: tell the user the deterministic route failed and propose the next cheapest fallback
3. Use expensive model context only after the file has already been compressed into a smaller artifact.

## Client Rules

- Keep the main model out of raw PDFs, decks, and spreadsheets whenever possible.
- Use the generated `.ob1/` folder as the working directory for follow-up analysis.
- For spreadsheets, reason from the CSV per sheet plus the workbook manifest.
- For presentations, reason from the slide outline before asking for a deeper pass.

## Bundled References

- `references/open-source-stack.md` explains the tool choices and fallback tiers.
