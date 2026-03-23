# OpenClaw Native OpenBrain Memory

This contribution documents and ships an OpenClaw plugin that turns an OpenBrain MCP server into the active native memory backend for OpenClaw.

## What it does

This plugin moves OpenClaw from shell-wrapped memory access to a native memory plugin path:

`agent -> openbrain-native memory plugin -> OpenBrain MCP server`

It exposes these MCP-aligned tools:
- `search_thoughts`
- `capture_thought`
- `list_thoughts`
- `thought_stats`
- `delete_thought`

It also registers as `kind: "memory"`, allowing OpenClaw to treat it as the active memory plugin rather than a generic tool bundle.

## Why this matters

Without a native memory plugin, memory access is slower, less reliable, and less semantically integrated with the runtime.

Advantages of the native memory approach:
- lower latency than shell wrappers and external bridge CLIs
- fewer moving parts and fewer process-level failure points
- tool names aligned with the live MCP server contract
- memory plugin slot support inside OpenClaw
- memory prompt section support for recall/capture guidance
- exact-id maintenance flows for stale, wrong, or noisy memories

## Prerequisites

- Working OpenClaw install
- Working OpenBrain MCP server
- Node.js 20+
- npm 10+
- OpenClaw gateway access

## Included docs and code

1. `01-install-local.md` — build/install/config flow
2. `02-architecture.md` — plugin/runtime/tool architecture
3. `03-setup-and-validation.md` — setup notes and validation flow
4. `04-validation-checklist.md` — end-to-end checks
5. `05-troubleshooting.md` — common issues and fixes
6. `06-housekeeping.md` — maintenance policy and delete guidance
7. `07-deploy.md` — deployment notes, including MCP server rebuild/redeploy steps
8. `08-release-process.md` — release/update workflow
9. `AI-INSTRUCTIONS.md` — AI-oriented implementation and review notes
10. `plugin-extension/` — the actual OpenClaw plugin source used for this integration

## Expected outcome

When working correctly:
- OpenClaw loads `openbrain-native` as `kind: "memory"`
- the memory slot switches to `openbrain-native`
- the runtime exposes the five memory tools above
- the plugin points at a live OpenBrain MCP endpoint
- delete operations target exact ids, not fuzzy content guesses

## If you had never seen this before, what you need

At minimum, a newcomer needs all three layers:

1. **The OpenBrain MCP server contract**
   - tool names
   - auth pattern
   - redeploy steps after interface changes
2. **The OpenClaw plugin code**
   - actual extension source
   - plugin manifest/schema
   - package metadata
3. **The operating docs**
   - install
   - validation
   - troubleshooting
   - maintenance policy

This contribution now includes all three so someone can rebuild the integration instead of guessing it from prose alone.

## Security / secrets

No secrets should be committed here.

Do not commit:
- MCP access keys
- OpenRouter keys
- full live endpoint URLs containing secrets
- copied local config files with embedded credentials

Use plugin config and environment/secret storage instead.

## Troubleshooting

Start with:
- `03-setup-and-validation.md`
- `04-validation-checklist.md`
- `05-troubleshooting.md`

## Contribution note

This repo documents the OpenClaw-side integration and packaging. It does not replace the upstream OpenBrain MCP server project.
