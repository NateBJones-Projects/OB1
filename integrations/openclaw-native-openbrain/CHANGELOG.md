# Changelog

## v1.0.0

- Fixed MCP response parsing to support both plain JSON and SSE-framed `event/message` payloads.
- Improved release/install/deploy docs for operator safety and clarity:
  - corrected development install path (`./extension`)
  - added explicit single-auth-mode guidance (URL key vs bearer)
  - added merge-safe trusted plugin allowlist guidance
  - added remote deployment workflow and release preflight checklist
- Added README note clarifying native plugin performance/reliability benefits over wrapper-based flows.

## v0.2.3

- Expanded troubleshooting coverage with a full failure matrix (symptom -> cause -> fix -> re-validation).
- Added auth diagnostics (401/403), transport/TLS/DNS checks, and direct MCP probe examples.
- Added SSE/JSON framing and fallback script failure guidance (`--strict`, error log path).
- Standardized extension config examples to `plugins.entries['openbrain-native'].config.*`.
- Standardized profile-safe tool policy examples to `alsoAllow`.
- Replaced brittle hardcoded package filename examples with dynamic artifact selection.
- Added explicit prerequisites/preflight checks and install method matrix.
- Added mandatory release gate requirement and rollback drill to release process.

## v0.2.2

- Added first-class deployment runbook (`docs/deploy.md`)
- Added explicit validation checklist with copy/paste commands (`docs/validation-checklist.md`)
- Added canonical setup doc (`docs/openbrain-native-openclaw-extension-setup.md`)
- Expanded root README to a complete onboarding map for humans
- Linked setup doc flow to validation checklist for repeatable verification

## v0.2.1

- Documented and validated `TOOL_MISSING` root cause under `tools.profile`.
- Added explicit guidance to use `tools.alsoAllow` / `agents.list[].tools.alsoAllow` for optional plugin tools.
- Updated install and troubleshooting docs with exact profile-safe policy examples.

## v0.2.0

- Switched helper scripts to direct OpenBrain MCP HTTP JSON-RPC (no `mcporter` dependency)
- Added first-class human docs:
  - install-local
  - architecture
  - troubleshooting
  - release-process
  - handoff-for-next-ai
- Added operational scripts:
  - `build-extension-package.sh`
  - `install-extension-local.sh`
  - `query_memory.sh`
  - `query_memory_exact.sh`
  - `recall_memory.sh`
- Improved repository structure for repeatable deployment and community sharing.

## v0.1.0

- Added native OpenClaw plugin scaffold for OpenBrain MCP (`extension/openbrain-native`)
- Added optional tools: `openbrain_search`, `openbrain_capture`, `openbrain_list_recent`
- Added direct HTTP JSON-RPC tool-calling path
- Added `OBMETA v1` envelope fallback for metadata portability
- Added migration fallback wrapper scripts and setup docs
- Added provenance-warning remediation notes
