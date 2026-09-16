# Open Source Stack Notes

This skill uses a deterministic-first policy and keeps the tool stack small on purpose. The goal is not perfect document fidelity. The goal is to create an agent-friendly artifact cheaply enough that the main model only sees the compressed version.

## Recommended Roles

### 1. MarkItDown

- Repo: <https://github.com/microsoft/markitdown>
- License: MIT
- Role in this skill: Best general-purpose document-to-markdown converter for PDFs, DOCX, PPTX, and mixed office-style documents when you want broad coverage fast.
- Why it fits: It is explicitly designed to make documents easier for LLM workflows rather than chasing layout-perfect export.
- Why it is not the only tool here: It can pull in bigger dependency trees than we want for every single file, especially when a sheet or deck can be normalized more cheaply with a tiny native extractor.

### 2. Docling

- Repo: <https://github.com/docling-project/docling>
- License: MIT
- Role in this skill: Heavy-duty fallback for ugly PDFs, OCR-heavy files, layout-sensitive extraction, and advanced document recovery.
- Why it fits: Strong PDF understanding, OCR support, and multi-format export, including markdown.
- Why it is not the default: It is overkill for cheap first-pass routing and raises the operational footprint.

### 3. xlsx2csv

- Repo: <https://github.com/dilshod/xlsx2csv>
- License: MIT
- Role in this skill: Reference pattern for spreadsheet normalization.
- Why it fits: The right mental model for spreadsheets is usually "convert each sheet into a plain tabular artifact" rather than forcing the main model to inspect workbook internals.
- How this skill uses the idea: Native spreadsheet handling creates one CSV per sheet plus a markdown manifest with sheet counts, headers, and row estimates.

### 4. pdfplumber

- Repo: <https://github.com/jsvine/pdfplumber>
- License: MIT
- Role in this skill: Cheap PDF indexing and page-level extraction.
- Why it fits: Good for counts, per-page text, page density checks, and detecting when a PDF is likely scanned or image-heavy.
- Why it matters: Even when the markdown extraction is weak, a cheap page-level index still tells the main agent whether escalation is worth the money.

## Architecture Decision

Use the smallest tool that preserves the structure the agent actually needs:

1. Tabular files: native CSV normalization first
2. Slide decks: native slide-outline extraction first
3. PDFs and rich documents: native extraction or MarkItDown
4. Scanned or degraded files: Docling or a cheap model only after the deterministic pass proves it is necessary

## What We Are Avoiding

- Reading raw binary-heavy files directly in the main model
- Defaulting to expensive models for pure conversion work
- Forcing a single converter to own every file type
- Building a pipeline so "smart" that a solo operator cannot debug it six months later
