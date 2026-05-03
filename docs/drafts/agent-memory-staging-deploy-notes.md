# Agent Memory Staging Deploy Notes

This draft captures the first real Supabase staging deploy for OB1 Agent Memory. Use it to update the public setup guides after the smoke test is complete.

## Project

- Supabase project: Jonathan's personal OB1 database, used as the OB1 staging/test target during this launch work
- Project ref: tracked in Linear `NAT-833`; avoid committing staging project refs into public docs.
- Purpose: personal Open Brain database plus isolated Agent Memory smoke/test scopes

## Personal Database Boundary

- Treat this database as Jonathan's personal Open Brain database.
- Keep launch tests under explicit smoke/test project IDs such as `agent-memory-api-smoke` and `agent-memory-openclaw-smoke`.
- Do not delete or bulk mutate non-test personal memories.
- Use the Agent Memory cleanup harness in dry-run mode first; `--apply` marks matching smoke/test memories as rejected rather than deleting rows.

## Scope

This pass should verify:

- Fresh OB1 base schema can be installed repeatably.
- Agent Memory sidecar schema can be applied after base OB1.
- Agent Memory API can deploy as a Supabase Edge Function.
- Required function secrets are clear and documented.
- Recall, write-back, usage reporting, review queue, inspector, trace, and audit basics work against a live project.

## Guide Deltas To Watch

- Whether the base OB1 guide should gain a CLI migration path alongside SQL Editor copy/paste.
- Draft CLI base schema added in [agent-memory-staging-base.sql](agent-memory-staging-base.sql) for this staging pass.
- Whether Agent Memory setup should ship as Supabase migrations or remain recipe SQL first.
- `SUPABASE_SERVICE_ROLE_KEY` was available automatically in the deployed Edge Function; only `OPENROUTER_API_KEY` and `MCP_ACCESS_KEY` needed to be set manually for this staging pass.
- Whether fresh Supabase projects need `pgcrypto` explicitly enabled for `sha256`.
- Fresh Supabase already had `pgcrypto`; the idempotent `CREATE EXTENSION IF NOT EXISTS pgcrypto` emitted a harmless notice. Keep it in CLI/migration docs.
- Whether the API needs better health checks for missing tables, missing secrets, and OpenRouter embedding failures.
- Whether example payloads should use UUID-looking placeholders instead of readable strings.
- Whether guide copy should clarify that publishable Supabase keys are not enough for server-side Agent Memory writes.
- Supabase Edge Functions preserved the function slug in the request path. Hono routes needed path normalization for `/agent-memory-api/*`.

## Staging Run Log

- 2026-05-03: Fresh project details received. Local Supabase CLI is authenticated and can see the OB1 project.
- 2026-05-03: `OPENROUTER_API_KEY` is not present in the local shell environment, so embedding-backed smoke tests will need that secret before end-to-end recall/write-back can pass.
- 2026-05-03: OpenRouter key received for staging function secret. Do not store it in repo files.
- 2026-05-03: Created an isolated temp Supabase workdir and linked it explicitly to the OB1 staging project ref.
- 2026-05-03: `supabase db push --dry-run --linked` showed exactly two pending migrations: base OB1 and Agent Memory.
- 2026-05-03: Applied base OB1 and Agent Memory migrations to the staging project.
- 2026-05-03: Remote schema dump confirmed `thoughts`, `match_thoughts`, `upsert_thought`, `agent_memories`, recall trace tables, and audit tables exist.
- 2026-05-03: Deployed `agent-memory-api` with explicit `--project-ref <OB1_STAGING_PROJECT_REF> --no-verify-jwt --use-api`.
- 2026-05-03: First health check returned `404` because Hono saw the Supabase function slug in the request path.
- 2026-05-03: Patched API request handling to normalize `/agent-memory-api/*` before route matching; redeployed; `/health` returned `200`.
- 2026-05-03: Live write-back smoke test created generated memories with `can_use_as_instruction=false`, `can_use_as_evidence=true`, and `requires_user_confirmation=true`.
- 2026-05-03: Conservative recall with `include_unconfirmed=false` returned zero pending memories.
- 2026-05-03: Recall with `include_unconfirmed=true` returned five evidence-only memories and created a recall trace.
- 2026-05-03: Usage reporting marked two recall items as used; recall trace endpoint returned five items with two used.
- 2026-05-03: Review action `evidence_only` moved one memory out of the pending queue without making it instruction-grade.
- 2026-05-03: Conservative recall then returned the evidence-only memory while keeping `can_use_as_instruction=false`.
- 2026-05-03: Unsafe write-back containing an `api_key` placeholder was blocked with HTTP `422`.
- 2026-05-03: Rotated the staging `MCP_ACCESS_KEY` for OpenClaw live testing and stored it only as a Supabase function secret plus a Spark OpenClaw SecretRef-backed file. Do not commit or paste the value.
- 2026-05-03: Linked the OpenClaw plugin into Jonathan's personal Spark profile against the OB1 staging function endpoint.
- 2026-05-03: Plugin schema initially rejected SecretRef-shaped `accessKey`; patched the manifest and plugin runtime to resolve OpenClaw SecretRefs at tool execution time.
- 2026-05-03: Runtime inspect listed all seven `openbrain_*` tools, but the model could not call them until the profile's `tools.allow` list explicitly included each `openbrain_*` tool.
- 2026-05-03: Native OpenClaw smoke test called `openbrain_list_review_queue` successfully from an agent turn with zero plugin failures.
- 2026-05-03: Full native OpenClaw plugin smoke passed using only `openbrain_*` tools: write-back, recall, usage reporting, review action, memory inspect, and recall-trace lookup all succeeded.
- 2026-05-03: Added repeatable smoke harnesses for direct API validation and native OpenClaw plugin validation.
- 2026-05-03: Direct API harness passed against OB1 staging with health, write-back, conservative recall gate, include-unconfirmed recall, usage report, review action, inspector, recall trace, and unsafe write-back blocking.
- 2026-05-03: Native OpenClaw harness passed on Spark; transcript parsing observed all seven `openbrain_*` tool calls, zero non-OB1 tool calls, zero tool errors, and an evidence-only review result.
- 2026-05-03: Added an Agent Memory list endpoint and dashboard governance foundation for review queue, memory inspector, and recall trace lookup.
- 2026-05-03: Added a cleanup harness that refuses non-test project IDs and marks matching active smoke/test memories as rejected only when `--apply` is passed.

## Verified Smoke Tests

| Area | Result |
| ---- | ------ |
| Base schema | Applied |
| Agent Memory schema | Applied |
| Edge Function deploy | Applied |
| Health endpoint | Passed |
| Write-back | Passed |
| Default generated memory policy | Passed |
| Conservative recall gate | Passed |
| Include-unconfirmed recall | Passed |
| Recall trace | Passed |
| Usage reporting | Passed |
| Review action | Passed |
| Unsafe write-back blocking | Passed |
| OpenClaw plugin runtime inspect | Passed |
| OpenClaw native tool exposure | Passed |
| OpenClaw native full plugin loop | Passed |
| Repeatable API smoke harness | Passed |
| Repeatable native OpenClaw smoke harness | Passed |
| Personal DB test cleanup harness | Added |
| Dashboard review/inspector/trace foundation | Added |

## Open Items

- `supabase migration list --linked` had one transient CLI auth failure after the migration push, while schema dump still succeeded. Recheck with newer Supabase CLI before turning this into public docs.
- The staging `MCP_ACCESS_KEY` has been rotated once for Spark testing. Rotate it again before any broader shared test if access scope changes.
