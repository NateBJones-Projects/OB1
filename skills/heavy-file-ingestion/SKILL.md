---
name: heavy-file-ingestion
description: Use when a user asks to read, analyze, summarize, or extract from a heavyweight file such as PDF, DOCX, PPTX, XLSX, CSV, or TSV. Convert the file into markdown or CSV first, generate a lightweight index, and only spend model tokens on the compressed artifact. Trigger on requests like "read this PDF", "look through this spreadsheet", "summarize this deck", or any time raw file ingestion would waste tokens.
author: Nate B. Jones
version: 1.0.0
---

# Heavy File Ingestion

## Problem

Agents waste money and context when they read heavyweight files raw. This skill turns bulky documents into cheaper working artifacts first, then tells the main agent how much reasoning power the file actually deserves.

## Trigger Conditions

- The user asks to read or analyze a PDF, slide deck, spreadsheet, or word-processing file
- The file is large, structured, or expensive enough that raw ingestion is a bad trade
- The user wants a markdown working copy, CSV extraction, or a quick map of the file before analysis
- The agent needs a deterministic first pass before choosing whether a model fallback is worth the cost

## Core Policy

1. **Convert before reading.** Do not dump raw heavyweight files into model context if a deterministic converter can create a cheaper artifact.
1. **Index before reasoning.** Read the generated `index.md` or `index.json` first. It should tell you what is in the file, how clean the extraction was, and whether escalation is justified.
1. **Match the converter to the file type.**
   - PDFs and documents: markdown artifact
   - Presentations: markdown slide outline
   - Spreadsheets: CSV per sheet plus a markdown manifest
1. **Escalate by cost tier, not instinct.**
   - Tier 1: deterministic converter plus index
   - Tier 2: cheap model on the extracted artifact only if quality flags say the deterministic pass lost structure
   - Tier 3: expensive model only after the file has already been compressed into markdown, CSV, or a sampled subset

## Process

1. Identify the file path, extension, and rough size.
1. Run the converter script instead of reading the original file directly:

```bash
uv run \
  --with pdfplumber \
  --with python-docx \
  --with python-pptx \
  --with openpyxl \
  python skills/heavy-file-ingestion/scripts/convert_heavy_file.py /absolute/path/to/file.ext
```

1. If you already have `markitdown` installed and want to prefer it for PDF or DOCX conversion, rerun with:

```bash
python skills/heavy-file-ingestion/scripts/convert_heavy_file.py /absolute/path/to/file.ext --prefer markitdown
```

1. Read the generated `index.md` first.
2. Only read the extracted markdown or CSV outputs that the index says are worth reading.
3. If the index flags weak extraction, use a cheap fallback:
   - Try an alternate deterministic converter
   - Use a small model to rebuild only the structure or outline from the extracted artifact
   - Escalate to a stronger model only when the cheaper passes still leave critical ambiguity

## Output

The skill should leave behind:

- A deterministic artifact the agent can work from
- `index.md` with file counts, structure hints, preview lines, and a recommended next step
- `index.json` with the same information in machine-friendly form
- Warnings when the deterministic pass is not trustworthy enough for direct reasoning

## Notes

- Prefer the bundled script over rewriting ad hoc conversion code each time.
- Do not treat "sub-agent" as the default answer to messy files. A cheap deterministic pass beats a cheap model when the task is conversion, counting, routing, or indexing.
- For scanned PDFs, image-heavy decks, or bizarre layouts, the deterministic pass is still useful because it tells you that a fallback is needed before you waste a stronger model on the original file.
- Use [`references/open-source-stack.md`](./references/open-source-stack.md) when you need to choose a better extractor or explain why one was picked.
