# Import Verification

> Read-only checks for imported Open Brain thoughts.

## What It Does

This recipe verifies that imports landed in `public.thoughts` with enough metadata to audit, filter, and troubleshoot them later. It checks source coverage, metadata completeness, missing embeddings, duplicate fingerprints, sample rows, and optional text probes. It does not write to your database.

Use it after running an import recipe such as ChatGPT Conversation Import, Obsidian Vault Import, Gmail import, Google Activity Import, Readwise Import, or a custom importer.

## Prerequisites

- Working Open Brain setup ([guide](../../docs/01-getting-started.md))
- Node.js 18+
- Supabase project URL and service-role key for live database checks

## Credential Tracker

```text
IMPORT VERIFICATION -- CREDENTIAL TRACKER
--------------------------------------

FROM YOUR OPEN BRAIN SETUP
  Supabase Project URL:        ____________
  Supabase Service Role Key:   ____________

OPTIONAL
  Source to verify:            ____________  (example: chatgpt, obsidian, gmail)
  Probe text:                  ____________  (a phrase you expect to find)

--------------------------------------
```

## Steps

1. Open this recipe folder:

   ```bash
   cd recipes/import-verification
   ```

2. Run the fixture check first. This proves the script works without using credentials:

   ```bash
   node verify-imports.mjs --fixture fixtures/sample-thoughts.json
   ```

3. Export your Supabase credentials:

   ```bash
   export SUPABASE_URL="https://YOUR_PROJECT_REF.supabase.co"
   export SUPABASE_SERVICE_ROLE_KEY="your-service-role-key"
   ```

   You can also put these values in `.env.local` in this recipe folder. Do not commit `.env.local`.

4. Verify recent imports:

   ```bash
   node verify-imports.mjs --limit 1000
   ```

5. Verify one source:

   ```bash
   node verify-imports.mjs --source chatgpt --limit 1000 --sample 5
   ```

6. Add a text probe when you know a phrase should exist:

   ```bash
   node verify-imports.mjs --source obsidian --probe "home maintenance" --limit 1000
   ```

7. Use strict mode for CI-style checks:

   ```bash
   node verify-imports.mjs --source readwise --strict
   ```

## Options

| Flag | Default | Description |
| ---- | ------- | ----------- |
| `--source SOURCE` | all sources | Filter scanned rows to a source slug such as `chatgpt`, `obsidian`, or `gmail`. |
| `--limit N` | `1000` | Maximum recent rows to scan. |
| `--sample N` | `5` | Number of sample thoughts to print. |
| `--probe TEXT` | none | Check whether scanned thoughts contain a phrase. This is a text probe, not semantic MCP search. |
| `--json` | off | Print machine-readable JSON instead of human-readable output. |
| `--strict` | off | Exit with code `1` when missing metadata, missing embeddings, duplicate fingerprints, or failed probes are found. |
| `--fixture FILE` | none | Analyze a local JSON fixture instead of connecting to Supabase. |
| `--help` | off | Show usage. |

## What Gets Checked

- **Rows by source**: counts scanned rows by `source_type`, `metadata.source_type`, or `metadata.source`.
- **Metadata completeness**: checks for `source`, `source_type`, `source_label`, `imported_at`, `importer_name`, `importer_version`, `input_hash`, `content_fingerprint`, `sensitivity_tier`, and `provenance`.
- **Embeddings**: flags rows with missing or empty embeddings.
- **Duplicate fingerprints**: finds repeated `content_fingerprint` values in the scanned rows.
- **Samples**: prints representative imported rows with ID, source, created date, and content preview.
- **Probe text**: checks whether any scanned content contains a phrase you expect to find.

Older importers may not have every metadata field yet. By default the script reports those gaps without failing. Use `--strict` when you are validating a new importer that should meet the current contract.

## Expected Outcome

For a healthy import, you should see:

- The expected source has non-zero rows.
- Recent imported rows have source metadata.
- Embeddings are present unless the importer intentionally skipped embeddings.
- Duplicate fingerprints are zero or explainable.
- A probe phrase finds at least one matching row when provided.

## Exit Codes

| Code | Meaning |
| ---- | ------- |
| `0` | Checks ran. In non-strict mode this can include warnings. |
| `1` | Strict mode found verification failures. |
| `2` | Missing configuration, unreadable fixture, JSON parse error, or Supabase query failure. |

## Troubleshooting

**Issue: `SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required`**
Solution: Export both variables or create a local `.env.local` file in this recipe folder. Use the service-role key, not the anon key.

**Issue: Source count is zero**
Solution: Check the source slug used by the importer. Some older recipes store only `metadata.source`, while newer schemas may also have a top-level `source_type` column.

**Issue: Missing metadata warnings**
Solution: Older imports may predate the current metadata contract. The warnings are useful for cleanup, but they are not necessarily a failed import unless you use `--strict`.

**Issue: Probe text fails**
Solution: Increase `--limit`, use a simpler phrase, or verify with semantic MCP search. The probe is a local text check over scanned rows, not vector search.
