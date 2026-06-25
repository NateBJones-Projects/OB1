# Ingestion Metadata Contract

> A shared provenance and deduplication contract for OB1 importers that write into `public.thoughts`.

## What This Is

This contract defines the metadata every new OB1 import path should write when it turns an external source into one or more thoughts. It is intentionally a documentation contract, not a database migration. The base Open Brain setup already has a `metadata` JSONB column on `thoughts`; optional schemas such as `enhanced-thoughts` may add top-level columns that mirror some of these fields.

The goal is simple: after an import, a user or maintainer should be able to answer:

- Where did this thought come from?
- Which importer created it?
- Can this import be safely re-run?
- How do I filter, audit, or delete this source later?
- Did this row come from a direct record, a converted artifact, or LLM extraction?

## Required Metadata For New Importers

New importers should include these fields in `metadata` for every inserted thought:

| Field | Type | Purpose |
| ----- | ---- | ------- |
| `source` | string | Compatibility source slug used by existing recipes and filters. Usually the same as `source_type`. |
| `source_type` | string | Canonical source family slug, for example `chatgpt`, `obsidian`, `gmail`, or `readwise`. |
| `source_label` | string | Human-readable source label, such as an export filename, vault name, or integration name. |
| `imported_at` | string | ISO 8601 UTC timestamp for when the importer wrote the thought. |
| `importer_name` | string | Stable importer slug, usually the recipe or script name. |
| `importer_version` | string | Importer version or commit label. Use `0.1.0` for a first release if no package version exists. |
| `input_hash` | string | SHA-256 hash of the raw source record or source artifact before thought extraction. |
| `content_fingerprint` | string | SHA-256 hash of the normalized thought content used for deduplication. |
| `sensitivity_tier` | string | Conservative classification: `standard`, `personal`, or `restricted`. |
| `provenance` | object | Structured explanation of how this thought was produced. |

If the `enhanced-thoughts` schema is installed, importers should also write the top-level `source_type`, `type`, `sensitivity_tier`, `importance`, and `quality_score` columns when available. For base Open Brain compatibility, always keep the source fields inside `metadata` too.

## Optional Metadata

Use these fields when the source provides them:

| Field | Type | Purpose |
| ----- | ---- | ------- |
| `source_id` | string | Stable external ID for the source record, message, note, highlight, or conversation. |
| `source_path` | string | Relative or redacted path to the source file. Do not store local absolute paths by default. |
| `source_url` | string | Source URL with tokens, auth codes, and private query strings removed. |
| `source_locator` | string | Human-readable pointer inside the source, such as page, heading, row, message range, or highlight location. |
| `original_created_at` | string | ISO 8601 timestamp from the upstream source. |
| `original_updated_at` | string | ISO 8601 timestamp from the upstream source, if distinct from creation time. |
| `type` | string | Thought type such as `idea`, `task`, `reference`, `decision`, `lesson`, `meeting`, `journal`, or `observation`. |
| `topics` | array | Short topic tags extracted from or assigned to the thought. |
| `people` | array | People explicitly mentioned by the source. |
| `action_items` | array | Action items explicitly present in the source. |
| `confidence` | string | Importer confidence label such as `firm`, `tentative`, or `extracted`. |
| `dedupe` | object | Details about exact or semantic duplicate checks. |
| `conversion` | object | Details about deterministic conversion before import. |

## Source Slugs

Use lowercase snake_case slugs. Prefer stable source families over script-specific names:

| Source | Recommended `source_type` |
| ------ | ------------------------- |
| ChatGPT export | `chatgpt` |
| Obsidian vault | `obsidian` |
| Gmail API import | `gmail` |
| Google Takeout activity | `google_activity` |
| Readwise highlights | `readwise` |
| X/Twitter archive | `x_twitter` |
| Instagram archive | `instagram` |
| Grok export | `grok` |
| Perplexity export | `perplexity` |
| Blogger or journal export | `blogger` |
| Converted local documents | `local_document` |

If an existing recipe already uses a more specific slug, keep that slug for backward compatibility and document it in the recipe README. Do not silently change old source labels in a minor cleanup PR.

## Hashes And Deduplication

Use SHA-256 and prefix hashes with `sha256:` in metadata examples:

- `input_hash` identifies the raw source record or deterministic conversion artifact.
- `content_fingerprint` identifies the normalized thought content.

These are different on purpose. A long source document can produce multiple thoughts with one shared `input_hash` and different `content_fingerprint` values. A re-imported thought can have the same `content_fingerprint` even if it came from a newer export file with a different `input_hash`.

Recommended normalization for `content_fingerprint`:

1. Trim leading and trailing whitespace.
2. Collapse repeated whitespace into a single space.
3. Lowercase the content.
4. Hash the normalized string with SHA-256.

If a database RPC such as `upsert_thought` recomputes the fingerprint, treat the database value as authoritative and keep the metadata field as an audit mirror.

## Provenance Object

`metadata.provenance` should explain the import path without storing raw private source content:

```json
{
  "method": "llm_extraction",
  "source_record": "conversation abc123",
  "source_locator": "messages 12-18",
  "artifact": "chatgpt-export/conversations.json",
  "extractor_model": "openai/gpt-4o-mini",
  "review_status": "unreviewed"
}
```

Recommended `method` values:

- `direct_record`: one upstream record became one thought.
- `chunked_record`: one upstream record was split into several thoughts.
- `llm_extraction`: an LLM extracted one or more candidate thoughts.
- `deterministic_conversion`: a file was converted before import.
- `manual_confirmation`: a human explicitly confirmed the thought before import.

## Privacy And Safety Rules

- Do not store service-role keys, OAuth tokens, cookies, private URLs with signed query strings, or connection strings.
- Do not store local absolute paths by default. Prefer relative paths from the import root, or redacted paths such as `exports/chatgpt/conversations.json`.
- Do not store raw transcripts, large source blobs, model reasoning traces, or secret-bearing code blocks in metadata.
- Treat LLM-extracted or inferred memories as evidence by default. Instruction-grade memory requires human confirmation or a trusted import path.
- If sensitivity is uncertain, escalate rather than downgrade: `standard` -> `personal` -> `restricted`.

## Full Example

See [ingestion-metadata.example.json](examples/ingestion-metadata.example.json) for a complete example thought row. The example is valid JSON and can be parsed by standard JSON tooling.

## Importer Author Checklist

Before opening a new importer PR, verify:

- The recipe README has a dry-run command.
- The recipe README explains how to run a small batch before a full import.
- Imported rows include `metadata.source` and `metadata.source_type`.
- Imported rows include importer name, version, `imported_at`, hashes, and provenance.
- Local paths are relative or redacted.
- Source URLs do not contain secrets.
- Re-running the importer does not create uncontrolled duplicates.
- The expected verification path is documented: Supabase query, recipe report, MCP search, or all three.
