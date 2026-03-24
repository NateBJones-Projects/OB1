# OpenClaw Native OpenBrain Memory

This integration adds a native OpenClaw memory plugin for OpenBrain.

It replaces wrapper-style memory flows with a native OpenClaw memory extension talking to a matching OpenBrain MCP server contract.

## TL;DR

If you want this working quickly:

1. Download the latest extension package:
   - https://github.com/NomLom/openbrain-native-openclaw
   - https://github.com/NomLom/openbrain-native-openclaw/releases
2. Install it into OpenClaw
3. Edit your OpenClaw config to allow the plugin and point it at your MCP server
4. Restart the gateway
5. Run the smoke test

For the exact install steps, use [`04-04-OPENCLAW-NATIVE-MEMORY-EXTENSION.md`](./04-04-OPENCLAW-NATIVE-MEMORY-EXTENSION.md).
For the MCP server contract and deploy steps, use [`03-MCP-SERVER.md`](./03-MCP-SERVER.md).
If anything fails, use [`05-05-TROUBLESHOOTING.md`](./05-05-TROUBLESHOOTING.md).

## Why this exists

The old shape worked, but it was clunky:

`agent -> wrapper/tool shim -> MCP`

This integration moves it to:

`agent -> native OpenClaw memory plugin -> OpenBrain MCP server`

That gives you:
- lower latency
- cleaner tool names
- exact-id maintenance flows
- less wrapper drift
- a memory backend that fits OpenClaw properly

## Why the MCP server needs changes

The stock Open Brain MCP server shape is not enough for this integration.

This version expects:
- `search_thoughts`
- `capture_thought`
- `list_thoughts`
- `thought_stats`
- `delete_thought`

It also expects search/list results to return ids in `structuredContent.items[]` so OpenClaw can delete, verify, and undo exact rows without dumping ids into user-facing text.

## Where things live

### In this OB1 repo

This repo covers:
- what the integration is
- why native OpenClaw memory needs a slightly different MCP contract
- which server files to deploy
- how to validate the server side
- how to connect that server to OpenClaw

Relevant server source files:
- `server/index.ts`
- `server/deno.json`

### In NomLom's extension repo

The extension package and extension-specific technical docs live here:
- Repo: https://github.com/NomLom/openbrain-native-openclaw
- Releases: https://github.com/NomLom/openbrain-native-openclaw/releases

That is the source of truth for the packaged extension artifact people should download and install.

## Files in this integration

- [`02-02-AI-INSTRUCTIONS.md`](./02-02-AI-INSTRUCTIONS.md) — one-shot handoff for an AI or operator
- [`03-MCP-SERVER.md`](./03-MCP-SERVER.md) — build, deploy, and validate the MCP server side
- [`04-04-OPENCLAW-NATIVE-MEMORY-EXTENSION.md`](./04-04-OPENCLAW-NATIVE-MEMORY-EXTENSION.md) — install the extension into OpenClaw and verify it works
- [`05-05-TROUBLESHOOTING.md`](./05-05-TROUBLESHOOTING.md) — practical fixes first, deeper diagnostics after
- [`metadata.json`](./metadata.json) — contribution metadata

## Expected outcome

When this is working:
- OpenClaw loads `openbrain-native` as a memory plugin
- OpenClaw exposes `search_thoughts`, `capture_thought`, `list_thoughts`, `thought_stats`, and `delete_thought`
- the MCP server returns ids in structured output, not in user-facing text
- delete/undo/verification flows can target exact rows

## Common issues

- Plugin not loading: check `openclaw plugins info openbrain-native --json`
- 401/403 errors: check your MCP auth mode and key placement
- Tool missing in chat: check OpenClaw allowlists and plugin load state
- IDs not showing in machine-readable output: check the MCP server code and redeploy the function

For the actual fixes, go to [`05-05-TROUBLESHOOTING.md`](./05-05-TROUBLESHOOTING.md).
