# OpenBrain Native for OpenClaw

Native OpenClaw plugin that exposes OpenBrain memory operations as first-class agent tools.

## Status

- Plugin implemented and installable
- Profile-safe tool policy documented (`alsoAllow` fix for `TOOL_MISSING`)
- Repeatable install/deploy/validate docs included
- Release process included

## Tools provided

- `openbrain_search`
- `openbrain_capture`
- `openbrain_list_recent`

## Scope

In scope:
- OpenClaw-side plugin integration
- native agent tool exposure
- reproducible install/deploy/validate workflow

Out of scope:
- provisioning the OpenBrain backend itself (assumed already available)

## Prerequisites

Tested minimum versions:

| Component | Version floor | Notes |
| --- | --- | --- |
| OpenClaw | `>= 0.2.0` | CLI + gateway required |
| Node.js | `>= 20.0.0` | Needed for extension packaging |
| npm | `>= 10.0.0` | Needed for `npm pack` flow |

Also required:
- OpenBrain MCP HTTP endpoint reachable
- `openclaw` CLI available on PATH

## Step-by-step instructions

Canonical setup flow starts here:
1. Install and configure plugin: `docs/install-local.md`
2. Deploy to target node/stage/prod: `docs/deploy.md`
3. Validate end-to-end checks: `docs/validation-checklist.md`
4. If checks fail, resolve with: `docs/troubleshooting.md`
5. Configure housekeeping baseline: `docs/housekeeping.md`

## Expected outcome

After completing setup and validation:
- OpenClaw reports plugin `openbrain-native` as loaded
- tools `openbrain_search`, `openbrain_capture`, `openbrain_list_recent` are available in fresh sessions
- marker capture + recall checks pass

## Troubleshooting

Use `docs/troubleshooting.md` for symptom-to-fix guidance, including:
- tool visibility/policy issues (`TOOL_MISSING`)
- auth and endpoint failures
- plugin load/restart issues
- validation/retrieval correctness checks

## Repository layout

- `extension/` - plugin source and manifest
- `scripts/` - helper scripts (direct OpenBrain RPC, no mcporter dependency)
- `docs/` - setup/deploy/validation/troubleshooting/release/handoff docs
- `CHANGELOG.md` - release notes

## Why this exists

Moves from:

`agent -> shell wrapper -> npx mcporter -> MCP`

to native plugin tools in OpenClaw runtime:

`agent -> openbrain-native plugin -> OpenBrain MCP`

## Performance and reliability

Using native plugin tools is significantly faster than shell wrappers because it removes subprocess hops and external CLI startup overhead.

Practical impact:
- lower latency per memory operation
- fewer moving parts (less wrapper/process failure surface)
- cleaner in-session tool UX and better reliability under load

## Releases

- Latest: see GitHub Releases
- Changelog: `CHANGELOG.md`
