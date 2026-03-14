# Codebase Concerns

**Analysis Date:** 2026-03-13

## Documentation Gaps — High Priority

**Incomplete step-by-step instructions in recipes:**
- Issue: Four recipes have placeholder TODOs instead of complete step-by-step instructions, blocking users from completing setup
- Files:
  - `recipes/email-history-import/README.md` (line 39): "TODO: Matt Hallett to fill in step-by-step instructions"
  - `recipes/daily-digest/README.md` (line 43): "TODO: Fill in step-by-step instructions"
  - `schemas/crm-contacts/README.md` (line 16): "TODO: Matt Hallett to fill in step-by-step instructions"
  - `integrations/discord-capture/README.md` (line 43): "TODO: Fill in step-by-step instructions"
- Impact: Users cannot complete these recipes without reaching out for help. PRs referencing these contributions will fail the automated review (Rule 9: README completeness checks for step-by-step instructions)
- Fix approach: Matt Hallett to prioritize filling these in. See `recipes/chatgpt-conversation-import/README.md` (lines 36-90) for the expected level of detail — numbered steps, copy-paste ready commands, environment variable guidance, and explicit outputs at each stage

**Incomplete security contact information:**
- Issue: Security policy template missing actual contact email
- Files: `SECURITY.md` (line 7), `CODE_OF_CONDUCT.md` (line 39)
- Impact: Security researchers and code of conduct reporters cannot reach anyone
- Fix approach: Insert actual contact email address in both files

## Test Coverage Gaps — Medium Priority

**No automated testing:**
- Issue: Zero test files found across the entire codebase (no `.test.ts`, `.spec.py`, `.test.js` files)
- Files: All recipe/extension code files lack corresponding test files
- Impact: Code changes to recipes (e.g., `recipes/chatgpt-conversation-import/import-chatgpt.py`, `recipes/source-filtering/backfill-metadata.ts`, extension index.ts files) have no automated coverage. Regression is only caught if users report bugs
- Fix approach: Add basic test suites for:
  - Python scripts: `import-chatgpt.py` should test conversation filtering, LLM prompt construction, Supabase insert logic
  - TypeScript edge functions: Extension `index.ts` files should test RLS policies, metadata insertion, type validation
  - Consider using `pytest` for Python, `vitest` for TypeScript. Pattern: co-locate `.test.ts` files next to code

## Error Handling — Medium Priority

**Limited error context in production edge functions:**
- Issue: Extension edge functions (`extensions/*/index.ts`) lack granular error logging and user-friendly error messages
- Files:
  - `extensions/job-hunt/index.ts` (521 lines)
  - `extensions/professional-crm/index.ts` (429 lines)
  - `extensions/meal-planning/index.ts` (385 lines)
- Impact: When an edge function fails, users see generic "HTTP 500" without details. Debugging requires logs from Supabase dashboard
- Fix approach:
  - Add structured error responses (e.g., `{ status: 400, error: "Invalid input", detail: "..." }`)
  - Log errors with context (input, step, external service response)
  - Document error codes in each extension README's troubleshooting section

**Python script error messages could be more specific:**
- Issue: `recipes/chatgpt-conversation-import/import-chatgpt.py` has broad exception handlers that catch multiple error types together
- Files: `recipes/chatgpt-conversation-import/import-chatgpt.py`
- Impact: Users see "Error: Failed to generate embedding" without knowing if it was auth, rate limiting, or malformed data
- Fix approach: Separate error handlers by cause; include the underlying exception detail in output

## Fragile Areas — Medium Priority

**Large Python script with complex filtering logic:**
- Issue: `recipes/chatgpt-conversation-import/import-chatgpt.py` (840 lines) implements a three-stage pipeline (filtering, summarization, ingestion) with intricate conversation evaluation rules
- Files: `recipes/chatgpt-conversation-import/import-chatgpt.py`
- Why fragile:
  - Conversation filtering has 6 different filters (Stage 1) with hardcoded rules (title patterns like "poem", "joke"; min message count; min word count)
  - LLM prompt tuning is critical for thought quality — if prompt changes, output format may break parsing
  - Deduplication uses hash of title + timestamp; clock skew or title changes cause re-imports
- Safe modification:
  - Make filter rules configurable (via CLI flags like `--no-title-filter`, `--min-messages=2`)
  - Test filtering independently before running full pipeline
  - Document expected LLM output format; validate JSON before inserting
- Test coverage gaps: No unit tests for filtering, summarization, or deduplication logic

**Extension edge functions depend on shared RLS pattern:**
- Issue: All 6 extensions rely on the same Row Level Security pattern defined in `primitives/rls/README.md`
- Files: `extensions/meal-planning/schema.sql`, `extensions/job-hunt/schema.sql`, `extensions/professional-crm/schema.sql`, etc.
- Why fragile:
  - If someone modifies an extension's RLS policy incorrectly, it silently allows unauthorized access (no error, just leaks data)
  - No centralized schema template; each extension re-implements RLS rules
- Safe modification:
  - All RLS policies must be reviewed before deployment
  - Add a SQL linter rule that validates `ENABLE ROW LEVEL SECURITY` + `CREATE POLICY` syntax
  - Consider a `rls-template.sql` that extensions can extend rather than re-implement
- Current safeguard: `.github/workflows/ob1-review.yml` Rule 5 blocks `ALTER TABLE ... DROP COLUMN` on core `thoughts` table, but doesn't validate RLS correctness

**Markdown link validation is not automated:**
- Issue: READMEs contain many relative links to docs, primitives, and sibling recipes
- Files: All contribution READMEs (e.g., `extensions/household-knowledge/README.md` links to `../../docs/01-getting-started.md`, `../../primitives/rls/`)
- Impact: Broken links (e.g., if a primitive is renamed or moved) won't be caught until a user clicks it
- Fix approach: `.github/workflows/ob1-review.yml` has Rule 13 (Internal links) but it's not fully implemented. Add shell script to validate all relative links resolve to existing files

## Missing Critical Features — Medium Priority

**No version tracking for contributions:**
- Issue: `metadata.json` includes version (e.g., "1.0.0"), but there's no changelog, release notes, or upgrade guide when versions change
- Files: All `metadata.json` files (no accompanying CHANGELOG.md in any contribution folder)
- Impact: If `recipes/chatgpt-conversation-import` goes from v1.0 to v1.1 with breaking changes (e.g., different metadata schema), users using v1.0 won't know to upgrade
- Fix approach:
  - Add a `CHANGELOG.md` requirement for contributions that are used by other projects (recipes that are imported as dependencies)
  - Document breaking changes prominently in README when version bumps occur
  - In `metadata.json`, add optional `breaking_changes` field linking to upgrade guide

**No "health check" for contributions after merge:**
- Issue: A PR can be merged successfully, but if Supabase schema changes or OpenRouter API changes, the contribution silently breaks
- Files: Entire repo (no post-merge validation)
- Impact: Community members discover broken recipes only after following all setup steps
- Fix approach:
  - Add optional smoke test in each contribution (e.g., `test.sh` that runs basic sanity checks)
  - `.github/workflows/ob1-review.yml` could optionally run these tests on merge (requires setting up test Supabase project)
  - Document known working versions of dependencies (Node.js, Deno, Python, Supabase CLI)

**Limited guidance on debugging MCP connection issues:**
- Issue: Several recipes use remote MCP endpoints, but troubleshooting connection failures is not documented
- Files: `integrations/discord-capture/README.md`, `integrations/slack-capture/README.md`, all extensions
- Impact: Users struggle when MCP tools don't appear in Claude Desktop or return "connection refused" errors
- Fix approach:
  - Add a "Debugging MCP connections" section to `primitives/remote-mcp/README.md`
  - Include checks: verify Edge Function is deployed (`supabase functions list`), check function logs (`supabase functions logs`), test with curl before connecting to Claude Desktop
  - Document the custom connector URL format and auth pattern

## Deployment & Infrastructure Risks — Medium Priority

**No environment variable validation at runtime:**
- Issue: Edge functions assume required env vars are set (e.g., `OPENROUTER_API_KEY`, `SUPABASE_SERVICE_ROLE_KEY`) but don't validate upfront
- Files: All extension `index.ts` files, recipe scripts
- Impact: Function fails halfway through execution with cryptic "undefined variable" error instead of fast-failing at startup
- Fix approach:
  - Add a `validateEnv()` function at the top of each edge function that checks all required vars and returns a 400 with a clear message
  - Example: `if (!Deno.env.get('OPENROUTER_API_KEY')) return new Response(JSON.stringify({ error: 'Missing OPENROUTER_API_KEY' }), { status: 400 })`

**No secrets rotation guidance:**
- Issue: READMEs ask users to set credentials but don't explain how to rotate them
- Files: All integration/recipe READMEs with credential trackers
- Impact: If a user accidentally commits a service role key, they don't know how to revoke it cleanly
- Fix approach:
  - Add a "Rotating Credentials" section to `docs/01-getting-started.md` covering:
    - How to rotate OpenRouter API keys
    - How to regenerate Supabase service role keys
    - How to reset Discord/Slack bot tokens
    - Post-rotation troubleshooting

**Large SQL migration files without rollback instructions:**
- Issue: Extension schema files (e.g., `extensions/job-hunt/schema.sql`, 174 lines) create tables but don't include rollback scripts
- Files: All `schema.sql` files in `extensions/` and `schemas/`
- Impact: If a user deploys a schema that conflicts with existing tables, they can't easily undo it
- Fix approach:
  - Require a `rollback.sql` file for each schema contribution
  - Or use Supabase migrations (`.sql` files in `supabase/migrations/`) instead of standalone scripts
  - Document in CONTRIBUTING.md that schema files should include comments explaining how to drop tables if needed

## Workflow & Review Automation Gaps — Low Priority

**LLM clarity review is stubbed out:**
- Issue: `.github/workflows/ob1-review.yml` line 425 has a TODO: "LLM clarity review — planned for v2"
- Files: `.github/workflows/ob1-review.yml`
- Impact: Unclear or incomplete README instructions slip through automated review; only caught by human reviewers
- Fix approach:
  - Implement Rule 11 (LLM clarity review) using GitHub's API to call an LLM
  - Requires: Adding `LLM_REVIEW_API_KEY` secret to repo
  - Checks: Does README have numbered steps? Do examples have copy-paste-ready commands? Is each step outcome explicit?

**No PR template validation:**
- Issue: `.github/PULL_REQUEST_TEMPLATE.md` has a checklist, but GitHub doesn't enforce that checkboxes are checked before merge
- Files: `.github/PULL_REQUEST_TEMPLATE.md`
- Impact: Contributors submit PRs without testing on their own instance, submitting untested recipes
- Fix approach:
  - Add a required GitHub Action that parses PR body and checks that all checkboxes are marked
  - Blocks PR from merging until checkboxes are checked
  - Pattern: Parse markdown checkboxes, fail if any `- [ ]` remain

**No dependency version pinning for recipes:**
- Issue: `recipes/chatgpt-conversation-import/requirements.txt` lists `requests` but no version; Python scripts in extensions don't have a `package.json` with pinned versions
- Files: `recipes/chatgpt-conversation-import/requirements.txt`
- Impact: A future `requests` version with breaking changes could break the script for new users
- Fix approach:
  - Pin versions: `requests==2.31.0` instead of `requests`
  - Document in CONTRIBUTING.md that all `requirements.txt` and `package.json` must pin versions
  - Add a check to `.github/workflows/ob1-review.yml` that rejects unpinned dependencies

## Data Integrity Concerns — Low Priority

**Deduplication logic in ChatGPT import relies on sync log:**
- Issue: `recipes/chatgpt-conversation-import/import-chatgpt.py` tracks which conversations were imported in `chatgpt-sync-log.json`
- Files: `recipes/chatgpt-conversation-import/import-chatgpt.py` (line 90, 150)
- Impact: If user deletes `chatgpt-sync-log.json`, all conversations are re-imported as duplicates; no database-side dedup
- Fix approach:
  - Add a `chatgpt_conversation_id` metadata field to track source conversation IDs
  - Implement a database-side upsert (check if thought with same source ID exists, update instead of insert)
  - Document that `chatgpt-sync-log.json` is a convenience cache, not the source of truth

**Backfill script in source-filtering may update incorrect thoughts:**
- Issue: `recipes/source-filtering/backfill-metadata.ts` updates thoughts based on semantic similarity, but doesn't validate before updating
- Files: `recipes/source-filtering/backfill-metadata.ts`
- Impact: Backfill could update a thought's metadata incorrectly if LLM extracts wrong type/topics
- Fix approach:
  - Add a dry-run mode (already exists, see README line 105) — always document this
  - Show a preview of what will be updated before confirming
  - Add optional approval step (print updates, wait for user confirmation before committing)

## Performance Concerns — Low Priority

**Large Python script processes entire ChatGPT export in memory:**
- Issue: `recipes/chatgpt-conversation-import/import-chatgpt.py` loads all conversations from zip into memory before filtering
- Files: `recipes/chatgpt-conversation-import/import-chatgpt.py`
- Impact: Very large exports (5000+ conversations) could exhaust memory; slow machines may struggle
- Improvement path:
  - Stream conversations from zip file instead of loading all at once
  - Process conversations in batches (e.g., 50 at a time)
  - Already has a `--limit` flag to cap processing; document this for large exports
  - Consider adding `--batch-size` flag to control memory usage

**No query optimization documentation for extensions:**
- Issue: Extensions with large tables (e.g., `extensions/professional-crm/schema.sql`, 131 lines) don't document indexing strategy
- Files: All extension `schema.sql` files
- Impact: Users may run slow queries on large datasets without knowing which columns to filter by
- Fix approach:
  - Add comments in `schema.sql` explaining which columns should have indexes and why
  - Document query patterns in extension README (e.g., "List all interactions for a contact" is `SELECT * FROM interactions WHERE contact_id = ?`)
  - Example: `extensions/professional-crm/schema.sql` should document that `contact_id` FK is indexed for fast lookups

## Metadata & Schema Consistency — Low Priority

**No validation of metadata.json against schema at submission time:**
- Issue: `metadata.schema.json` defines the structure, but it's not enforced in `.github/workflows/ob1-review.yml` — only basic field checks are done
- Files: `.github/workflows/ob1-review.yml` (Rule 3), `.github/metadata.schema.json`
- Impact: Invalid metadata (e.g., wrong difficulty enum, missing nested fields) passes automated review if the shell script doesn't catch it
- Fix approach:
  - Use `jq` with `--arg-file` to validate against the JSON schema, or use a dedicated JSON schema validator
  - Current check: Manual field list verification. Better approach: `jsonschema validate metadata.json metadata.schema.json`
  - Requires installing `jsonschema` or equivalent in CI

**No documented metadata standards for custom fields:**
- Issue: Extensions add custom fields to `metadata.json` (e.g., `learning_order`, `requires_primitives`) but guidelines for future custom fields aren't documented
- Files: `.github/metadata.schema.json`, `CONTRIBUTING.md`
- Impact: Future contributions may add conflicting custom fields without a review process
- Fix approach:
  - Document the process for adding new metadata fields (e.g., "new fields must be added to the schema and documented in CONTRIBUTING.md")
  - Add a check in `.github/workflows/ob1-review.yml` that rejects unknown fields in metadata.json

---

*Concerns audit: 2026-03-13*
