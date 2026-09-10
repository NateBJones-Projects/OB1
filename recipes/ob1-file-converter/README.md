# OB1 File Converter

> Convert local files into extracted-record JSON before any Open Brain import.

## What It Does

OB1 File Converter reads local `.txt`, `.md`, and JSON array files and emits a JSON array of extracted records. It is an offline preparation step for large or mixed file sources.

The converter performs mechanical splitting only. Chunked output is marked as `type: "raw_chunk"` and `confidence: "unprocessed"` so it stays evidence-grade until a person, trusted importer, or later extraction workflow reviews it.

## Prerequisites

- Working Open Brain setup ([guide](../../docs/01-getting-started.md))
- Node.js 18+
- Local text, Markdown, or JSON array files

## Credential Tracker

No credentials are required. This recipe does not connect to Supabase or any external API.

```text
OB1 FILE CONVERTER -- CREDENTIAL TRACKER
--------------------------------------

LOCAL FILES
  Input file or folder:     ____________
  Output records JSON:      ____________

SUPABASE
  Not used by this recipe.

--------------------------------------
```

## Steps

1. Open this recipe folder:

   ```bash
   cd recipes/ob1-file-converter
   ```

2. Run the built-in tests:

   ```bash
   npm test
   ```

3. Convert the sample directory:

   ```bash
   node convert.js fixtures/dir --source sample --source-label "Sample files" > sample-records.json
   ```

4. Convert one Markdown or text file:

   ```bash
   node convert.js /path/to/note.md --source obsidian --source-label "House vault" > records.json
   ```

5. Convert a folder of local files:

   ```bash
   node convert.js /path/to/folder --source local-files --source-label "Local files" > records.json
   ```

6. Convert a JSON array export:

   ```bash
   node convert.js /path/to/export.json --source json-export > records.json
   ```

7. Inspect the output before using any later import path:

   ```bash
   head -40 records.json
   ```

## Options

| Option | Default | Description |
| ------ | ------- | ----------- |
| `--output FILE` | stdout | Write JSON output to a file. |
| `--source SOURCE` | `file` | Source slug for emitted records. |
| `--source-label LABEL` | `${source} files` | Human-readable source label. |
| `--format FORMAT` | `auto` | `auto`, `text`, `markdown`, or `json`. |
| `--max-chunk-size N` | `4000` | Maximum characters before paragraph-first chunking. |
| `--max-file-size N` | `1048576` | Maximum file bytes to read. Larger files are skipped with a warning. |
| `--max-depth N` | `5` | Maximum directory recursion depth. |

## Expected Outcome

The command prints JSON records that can be inspected and passed into a later normalization path. Each record includes:

- `content`
- `source`
- `source_type`
- `source_label`
- `source_path`
- `source_locator`
- `created_at` when available
- `type`
- `topics`
- `confidence`

For files larger than `--max-chunk-size`, each chunk receives a locator such as `chunk-1-of-3`.

## Safety Notes

- Symlinks are skipped.
- Binary files are skipped.
- Files over `--max-file-size` are skipped.
- Empty text files produce an empty array.
- Raw file chunks are not treated as instruction-grade memory.

## What This Does Not Do

- It does not write to Supabase.
- It does not create ingestion job rows.
- It does not call an LLM.
- It does not generate embeddings.
- It does not deduplicate against existing thoughts.

Those pieces belong to later ingestion PRs.

## Troubleshooting

**Issue: Output is an empty array**
Solution: Confirm the input path contains supported `.txt`, `.md`, `.markdown`, or `.json` files and that the files are not empty.

**Issue: `Skipped binary file`**
Solution: Export the source as text or Markdown first. This converter intentionally avoids binary parsing.

**Issue: `Skipped file over max size`**
Solution: Increase `--max-file-size` or split the source file before conversion.

**Issue: JSON input is skipped**
Solution: JSON input must be an array. Object-shaped export formats should be converted by a source-specific importer in a later PR.

## Related

This recipe fits the Open Brain workflow from Nate B. Jones. Nate shares practical systems at [Nate's Newsletter](https://substack.com/@natesnewsletter) and [natebjones.com](https://natebjones.com).
