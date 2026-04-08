# Extraction Quality Schema

Adds an `extraction_quality` JSONB column to the `documents` table, storing metadata from the structure-aware extraction pipeline.

## What It Stores

| Field | Type | Description |
|-------|------|-------------|
| `converter` | string | Which extractor was used: `unpdf`, `native-docx`, `native-xlsx`, `native-pptx`, `native-text`, `raw-stream-fallback` |
| `quality_flags` | string[] | Issues detected: `scanned_pdf_suspected`, `low_text_density`, `low_text_output`, `fallback_parser_used` |
| `stats` | object | Extraction stats: page counts, character counts, heading counts, table counts, etc. |
| `recommended_next_step` | string | What the agent should do: `read_extracted_artifact` or `cheap_model_or_stronger_converter` |

## Migration

```sql
ALTER TABLE documents ADD COLUMN IF NOT EXISTS extraction_quality JSONB DEFAULT '{}';
```

## Prerequisites

- Existing `documents` table from the Open Brain setup
