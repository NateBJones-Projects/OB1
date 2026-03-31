---
name: heavy-file-ingestion-claude-code
description: Use in Claude Code when a user asks to read, analyze, summarize, or extract from a heavyweight file such as PDF, DOCX, PPTX, XLSX, CSV, or TSV. Convert the file into markdown or CSV first with the bundled script, generate a lightweight index, and only spend model tokens on the compressed artifact.
author: Nate B. Jones
version: 1.0.0
---

# Heavy File Ingestion For Claude Code

## Problem

Claude Code has the tools to convert files locally, so it should not waste context by reading heavyweight files raw.

## Trigger Conditions

- The user asks to read or analyze a PDF, DOCX, PPTX, XLSX, CSV, or TSV
- The file is large enough or structured enough that direct ingestion is a bad trade
- The user wants a markdown working copy, CSV normalization, or a fast map of the file before deeper analysis

## Process

1. Do not read the original heavyweight file directly into context if conversion is possible.
1. Resolve the bundled converter relative to this skill directory: `scripts/convert_heavy_file.py`
1. Run the converter first. Default command:

```bash
python scripts/convert_heavy_file.py /absolute/path/to/file.ext
```

1. If dependencies are missing, prefer:

```bash
uv run \
  --with pdfplumber \
  --with python-docx \
  --with python-pptx \
  --with openpyxl \
  python scripts/convert_heavy_file.py /absolute/path/to/file.ext
```

1. Read the generated `index.md` before reading any converted artifact.
2. Use the index to decide the cheapest next step:
   - `read_extracted_artifact`: read the markdown or CSV and continue
   - `install_dependency_and_retry`: install the missing deterministic dependency and rerun
   - `cheap_model_or_stronger_converter`: retry with a better converter or use a cheaper model only on the extracted artifact
3. Only escalate to a stronger model after the file has already been compressed into markdown, CSV, or a short sampled subset.

## Client Rules

- Prefer deterministic scripts over model-based conversion.
- Save the converted artifacts next to the source file and work from those files.
- For spreadsheets, use the generated per-sheet CSV files instead of trying to reason over workbook internals directly.
- For PDFs, treat scan detection and low-density warnings as a routing signal, not as a reason to read the original PDF raw.

## Bundled References

- `references/open-source-stack.md` explains the tool choices and fallback strategy.
