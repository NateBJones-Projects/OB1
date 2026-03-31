---
name: heavy-file-ingestion-claude-desktop
description: Use in Claude Desktop when a user asks to read, analyze, summarize, or extract from a heavyweight file such as PDF, DOCX, PPTX, XLSX, CSV, or TSV. Avoid raw ingestion of bulky files. Ask for a converted markdown or CSV artifact first, or give the user exact conversion commands to run outside Claude Desktop.
author: Nate B. Jones
version: 1.0.0
---

# Heavy File Ingestion For Claude Desktop

## Problem

Claude Desktop does not have the same local shell workflow as coding agents, so it should avoid pretending it can efficiently process bulky files raw.

## Trigger Conditions

- The user asks Claude Desktop to read a PDF, PPTX, DOCX, XLSX, or another bulky attachment
- The file would cost too much context for too little value
- The user would be better served by a converted markdown or CSV artifact

## Process

1. Do not ingest the raw heavyweight file by default.
1. First ask for the cheapest workable artifact:
   - PDF or DOCX: markdown
   - PPTX: markdown slide outline
   - XLSX: CSV per sheet or a small sample plus sheet names
1. If the user has not converted it yet, offer exact commands they can run outside Claude Desktop.

### Suggested Conversion Commands

```bash
python convert_heavy_file.py /absolute/path/to/file.pdf
python convert_heavy_file.py /absolute/path/to/file.docx
python convert_heavy_file.py /absolute/path/to/file.pptx
python convert_heavy_file.py /absolute/path/to/file.xlsx
```

If the script is not available, say so and ask the user for:

- a markdown export
- a CSV export
- or a small representative excerpt

1. Once the user provides the converted artifact, create a quick index:
   - file type
   - sections, slides, or sheet names
   - row counts or page counts if available
   - any obvious extraction-quality problems
2. Only then analyze the content.

## Client Rules

- Be explicit about the tradeoff: converting first is cheaper and usually better.
- If the user insists on staying inside Claude Desktop, ask for a smaller excerpt rather than taking the whole file raw.
- Use raw ingestion only for genuinely small files where conversion would cost more effort than it saves.
