# Handoff Notes (for the next AI/operator)

## Goal
Make OpenBrain memory operations native inside OpenClaw, with repeatable deployment and clear rollback path.

## Current state
- `openbrain-native` plugin exists and loads.
- Native tools are defined in plugin source.
- Direct-RPC helper scripts are available for operations without mcporter.
- Repo includes install, validation, troubleshooting, and release docs.

## Important checks after any change
1. `openclaw config validate`
2. `openclaw plugins info openbrain-native --json`
3. fresh-session tool availability check
4. one live search + one live capture test

## If something breaks
- Keep/restore wrapper fallback scripts in `scripts/`.
- Verify plugin URL/config and allowlists.
- Verify gateway service state and restart.

## Out-of-scope assumptions
- OpenBrain server provisioning/auth policy is already handled externally.
