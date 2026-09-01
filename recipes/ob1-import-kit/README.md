# OB1 Import Kit

> Offline checks for turning extracted records into Open Brain thought candidates.

## What It Does

OB1 Import Kit validates a JSON array of extracted thought records and normalizes them into Open Brain-ready JSON. It does not write to Supabase, generate embeddings, run LLM extraction, or store raw transcript dumps.

Use this when you already have small extracted records from a source export and want a safe dry-run path before a future importer writes anything to `public.thoughts`.

## Prerequisites

- Working Open Brain setup ([guide](../../docs/01-getting-started.md))
- Node.js 18+
- A JSON file containing an array of extracted thought records

## Credential Tracker

No credentials are required. This recipe is offline and dry-run only.

```text
OB1 IMPORT KIT -- CREDENTIAL TRACKER
--------------------------------------

LOCAL FILES
  Extracted records JSON:  ____________
  Normalized output JSON:  ____________

SUPABASE
  Not used by this recipe.

--------------------------------------
```

## Steps

1. Open this recipe folder:

   ```bash
   cd recipes/ob1-import-kit
   ```

2. Run the built-in tests:

   ```bash
   npm test
   ```

3. Validate the sample records:

   ```bash
   node import-kit.js validate fixtures/sample-records.json
   ```

4. Normalize the sample records:

   ```bash
   node import-kit.js normalize fixtures/sample-records.json > normalized-thoughts.json
   ```

5. Validate your own extracted records:

   ```bash
   node import-kit.js validate /path/to/records.json
   ```

6. Normalize your own extracted records:

   ```bash
   node import-kit.js normalize /path/to/records.json > normalized-thoughts.json
   ```

7. Inspect the output before using it in any future import path:

   ```bash
   head -40 normalized-thoughts.json
   ```

## Input Format

Input must be a JSON array. Each object should represent one extracted thought, not a whole raw transcript.

```json
[
  {
    "id": "chatgpt-export-001",
    "content": "Chose PostgreSQL for the reporting service because joins mattered.",
    "source": "chatgpt",
    "source_label": "ChatGPT export",
    "created_at": "2025-09-15T14:22:00Z",
    "type": "decision",
    "topics": ["database", "architecture"]
  }
]
```

Each record needs either `content` or `text`. Source fields are recommended because they make the output easier to audit later.

## Commands

| Command | Purpose |
| ------- | ------- |
| `validate <file>` | Checks the file shape, timestamps, missing source metadata, and obvious secret-like content. |
| `validate <file> --json` | Prints validation results as machine-readable JSON. |
| `normalize <file>` | Prints normalized thought candidates as JSON. |
| `normalize <file> --imported-at ISO_DATE` | Uses a deterministic import timestamp for tests or repeatable dry runs. |
| `normalize <file> --source SOURCE` | Supplies a fallback source when records do not include one. |
| `normalize <file> --source-label LABEL` | Supplies a fallback source label when records do not include one. |

## Expected Outcome

Validation should report the number of records, valid records, failures, warnings, and records by source. A healthy sample run looks like this:

```text
OB1 Import Kit validation
=========================
Records: 3
Valid records: 3
Failures: 0
Warnings: 0
```

Normalization prints JSON records with:

- `content`
- top-level `source_type`
- top-level `content_fingerprint`
- `metadata.source`
- `metadata.source_type`
- `metadata.source_label`
- `metadata.imported_at`
- `metadata.importer_name`
- `metadata.importer_version`
- `metadata.input_hash`
- `metadata.content_fingerprint`
- `metadata.sensitivity_tier`
- `metadata.provenance.review_status`

`metadata.provenance.review_status` defaults to `unreviewed`, so generated or inferred memory stays evidence-grade until a person or trusted importer promotes it.

## What This Does Not Do

- It does not parse heavyweight source exports such as full ChatGPT conversations, Obsidian vaults, Gmail archives, or large JSONL streams.
- It does not write rows into Supabase.
- It does not create ingestion job records.
- It does not call an LLM, generate embeddings, or deduplicate against existing thoughts.

Those pieces belong to later ingestion PRs.

## Troubleshooting

**Issue: `Input must be a JSON array of extracted thought records`**
Solution: Wrap records in `[` and `]`. JSONL and streaming files are deferred to the heavy conversion recipe.

**Issue: `missing content or text`**
Solution: Add a short extracted thought to either `content` or `text`. Do not paste an entire raw transcript as one record.

**Issue: `timestamp is not a valid ISO date`**
Solution: Use ISO 8601 timestamps such as `2026-06-06T00:00:00Z`.

**Issue: `content looks like it may contain a secret`**
Solution: Review the record before import. Remove API keys, tokens, passwords, and connection strings from extracted thought content.

## Related

This recipe fits the Open Brain workflow from Nate B. Jones. Nate shares practical systems at [Nate's Newsletter](https://substack.com/@natesnewsletter) and [natebjones.com](https://natebjones.com).
