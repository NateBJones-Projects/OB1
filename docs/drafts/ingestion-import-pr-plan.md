# Non-Dashboard Ingestion and Import PR Plan

This plan covers the fork-first PR sequence for improving OB1 ingestion without adding dashboard scope.

Co-evolution note: this sequence was refined with the local `co-evolve-bouncer.sh` loop using `codex,claude` agents on June 5, 2026. The key correction from the review was to land docs, metadata vocabulary, and verification before adding any write-capable CLI or backend behavior.

## Landing Order

1. PR 1: Ingestion Start Here README
2. PR 3: Common Ingest Contract and Metadata Convention
3. PR 7: Import Verification and Coverage Audit
4. PR 2: OB1 Import Kit CLI Skeleton
5. PR 4: Heavy File Conversion to Importable Artifacts
6. PR 5: Ingestion Jobs Schema and Dry-Run Lifecycle
7. PR 6: Smart Ingest Backend Function

This order gives users a safe path immediately, then gives maintainers a shared metadata contract and verification harness before new write paths arrive.

## PR 1: Ingestion Start Here README

Purpose: make `recipes/README.md` the canonical first stop for "I have files or exports. How do I get them into OB1 safely?"

Scope:

- Add a beginner-oriented data import flow: setup, choose importer, configure credentials, dry run, small batch, verify, full import, verify again.
- Add a source-to-recipe table for current importers.
- Add credential and local data safety notes.
- Link to `docs/01-getting-started.md`.
- Link heavy files to `skills/heavy-file-ingestion/` as a convert-first path, not a finished importer.
- Explain verification through Supabase, importer output, and MCP search.

Out of scope:

- Dashboard pages.
- New CLI commands.
- New database schema.
- Describing planned features as if they already work.

Acceptance criteria:

- A first-time OB1 user can identify the correct importer in under one minute.
- Commands show dry-run-first shapes.
- Every linked recipe exists or is clearly described as a preprocessing path.
- No examples include secrets or personal paths.

Risk:

- Aspirational docs can create dead ends. Keep this PR grounded in what works today.

Sequencing:

- Lands first and can ship independently.

## PR 3: Common Ingest Contract and Metadata Convention

Purpose: normalize imported thought provenance so imports are auditable, dedupable, and reversible.

Scope:

- Document a canonical metadata contract for importers:
  - `source_type`
  - `source_label`
  - `source_id`
  - `source_path` or `source_url`
  - `imported_at`
  - `importer_name`
  - `importer_version`
  - `input_hash`
  - `content_fingerprint`
  - `original_created_at`
  - `sensitivity_tier`
  - `provenance`
- Define required vs optional fields.
- Define timestamp format as ISO 8601 UTC.
- Define SHA-256 as the default hash algorithm unless an existing OB1 primitive says otherwise.
- Explain the difference between `input_hash` and `content_fingerprint`.
- Require local absolute paths to be redacted or converted to relative paths.
- Require source URLs to be stripped of tokens and query secrets.
- Include at least one example fixture.

Out of scope:

- Migrating every existing importer in one PR.
- Hard schema validation for all existing rows.
- Changing the base `thoughts` table.
- Adding job tracking tables.

Acceptance criteria:

- New importer authors have one place to learn the metadata shape.
- Existing importers keep working.
- Converted heavy-file artifacts and future job tracking can reference the same contract.
- Sensitive local paths and secrets are excluded by default.

Risk:

- Over-standardization can slow useful importer contributions. Frame this as required for new importers and recommended for older ones.

Sequencing:

- Lands before CLI, conversion manifests, jobs, or smart ingest.

## PR 7: Import Verification and Coverage Audit

Purpose: give users and maintainers a non-dashboard way to prove imports worked.

Scope:

- Add a read-only verification recipe or script that reports:
  - row counts by `source_type`
  - recent imports by `imported_at`
  - metadata completeness against the PR 3 contract
  - missing embeddings
  - duplicate fingerprints
  - sample imported thoughts
  - optional MCP search check
  - skipped/duplicate counts where sync logs or ingestion jobs exist
- Support human-readable output and optional JSON.
- Use explicit exit codes:
  - `0` for configured checks pass
  - `1` for verification failures
  - `2` for missing config or dependencies
- Gracefully skip checks when optional dependencies are unavailable.

Out of scope:

- Dashboard reporting.
- Destructive cleanup.
- Automatic repair.
- Hard dependency on MCP.

Acceptance criteria:

- Runs safely against a configured OB1 database.
- Can verify at least one existing importer.
- Flags missing metadata from pre-contract imports without failing harshly by default.
- Includes troubleshooting guidance.

Risk:

- Row counts alone create false confidence. Include metadata, embedding, duplicate, and retrieval checks.

Sequencing:

- Lands after the metadata contract and before new write-capable paths.

## PR 2: OB1 Import Kit CLI Skeleton

Purpose: introduce a single non-dashboard command surface for ingestion without replacing existing recipes.

Initial shape:

```text
scripts/ob1-ingest doctor
scripts/ob1-ingest detect <path>
scripts/ob1-ingest dry-run <path>
scripts/ob1-ingest verify [source_type]
```

Scope:

- Start as a repo-local script, not a global package.
- Keep commands read-only in the first PR.
- `doctor` checks environment, local dependencies, credential presence, database connectivity if configured, and available importers.
- `detect` inspects a file or folder and recommends a recipe.
- `dry-run` dispatches only to importers with existing dry-run support.
- `verify` calls the PR 7 verification script.
- Document Windows PowerShell and macOS/Linux usage.

Out of scope:

- Write-capable `apply`.
- Full importer parity.
- Hosted backend.
- Dashboard upload.
- Large document extraction.

Acceptance criteria:

- `doctor` works without writing to the database.
- `detect` recommends useful recipes for at least two or three representative inputs.
- `dry-run` dispatches to at least one existing importer.
- Unsupported sources fail with clear next steps.
- Docs state exactly what is implemented and what is planned.

Risk:

- The CLI can become a second ingestion framework. Keep it a thin dispatcher until repeated importer behavior justifies shared code.

Sequencing:

- Lands after metadata and verification so it can point to both from day one.

## PR 4: Heavy File Conversion to Importable Artifacts

Purpose: make large or binary files ingestible by converting them into deterministic intermediate artifacts before LLM extraction or thought creation.

Scope:

- Reuse the policy and scripts from `skills/heavy-file-ingestion/`.
- Start with a small supported set, such as markdown folders, CSV, and one binary format with reliable local conversion.
- Produce markdown, CSV, text, and/or index artifacts.
- Generate an import manifest using the PR 3 metadata contract.
- Record:
  - raw input hashes
  - converter name and version
  - output artifact hashes
  - skipped-file records with reasons
- Explain the convert-first flow:

```text
raw files -> deterministic artifacts -> dry run -> review -> import -> verify
```

Out of scope:

- OCR-heavy processing.
- Perfect parsing for every document.
- Dashboard upload.
- Automatic memory creation from unreviewed documents.

Acceptance criteria:

- A sample folder with supported file types produces inspectable artifacts.
- The manifest records source hashes, converter details, artifact hashes, and skip reasons.
- Unsupported files are skipped clearly.
- Docs explain dependencies and fallbacks.

Risk:

- Users may assume conversion means semantic correctness. Docs should state that conversion creates inspectable artifacts; review and import are separate steps.

Sequencing:

- Lands after the metadata contract. The CLI can later detect and route manifests.

## PR 5: Ingestion Jobs Schema and Dry-Run Lifecycle

Purpose: add import job tracking for large imports as an operational safety layer, not a dashboard dependency.

Scope:

- Add migration SQL and RLS guidance for:
  - `ingestion_jobs`
  - `ingestion_items`
- Track lifecycle states:

```text
pending -> extracting -> dry_run_complete -> reviewed -> executing -> complete | failed
```

- Track item decisions:
  - `add`
  - `skip`
  - `duplicate`
- Include job source metadata, importer name/version, counts, errors, timestamps, idempotency keys, minimal indexes, and example SQL queries.
- Prefer item summaries, hashes, source references, and candidate metadata over raw content storage.
- Include rollback/drop instructions.

Out of scope:

- Dashboard job viewer.
- Queue or worker orchestration.
- Hosted service assumptions.
- Requiring every importer to adopt jobs immediately.

Acceptance criteria:

- SQL install instructions work from a clean OB1 Supabase database.
- Dry-run, review, and apply lifecycle is documented with concrete examples.
- Existing importers continue working without these tables.
- No dashboard is required to inspect job state.

Risk:

- Schema is expensive to change after adoption. Keep it minimal and focused on auditability, idempotency, and reviewable dry runs.

Sequencing:

- Lands before smart ingest. Does not block simple recipe imports.

## PR 6: Smart Ingest Backend Function

Purpose: add an optional backend ingestion path for raw text that can extract candidate thoughts, dedupe them, record decisions, and execute only after dry-run review.

Scope:

- Define the HTTP contract:

```text
POST /ingest/dry-run
POST /ingest/jobs/:id/apply
GET  /ingest/jobs/:id
```

- Use existing OB1 auth where possible. If a static ingestion key is documented for private deployments, include rotation guidance and make the risk explicit.
- Default long documents to dry-run behavior.
- Treat source text as untrusted data.
- Candidate extraction from raw text.
- Fingerprint dedupe and semantic dedupe where embeddings/search are available.
- Job and item records using PR 5 schema.
- Conservative sensitivity handling.
- No raw transcript storage unless explicitly configured.

Out of scope:

- Dashboard review UI.
- Raw transcript archive.
- Unsafe automatic instruction-grade memory.
- Replacing deterministic importers.
- Full source adapter framework.

Acceptance criteria:

- Unauthorized requests fail.
- Dry run creates job/item records but does not create final thoughts.
- Apply only executes reviewed or approved actions.
- Duplicates are skipped or marked clearly.
- Source-text prompt injection cannot change auth, job state, apply behavior, or system prompts.
- Example curl commands work.

Risk:

- This is the highest-risk PR because it touches auth, privacy, dedupe quality, prompt injection, and memory quality. Treat it as optional or experimental until reviewed closely.

Sequencing:

- Lands last. Depends on the metadata contract, job schema, and verification/audit path.
