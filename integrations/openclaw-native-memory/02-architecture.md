# Architecture

## Native plugin path

`LLM Agent -> OpenClaw Tool Runtime -> openbrain-native plugin -> OpenBrain MCP HTTP endpoint`

The plugin sends JSON-RPC requests to MCP method `tools/call`.

## Tool mapping

The plugin now exposes the same tool IDs as the remote MCP server and is intended to load as a native OpenClaw `kind: "memory"` plugin:

- `search_thoughts` -> MCP `search_thoughts`
- `capture_thought` -> MCP `capture_thought`
- `list_thoughts` -> MCP `list_thoughts`
- `thought_stats` -> MCP `thought_stats`
- `delete_thought` -> MCP `delete_thought`

## Metadata behavior

Some OpenBrain deployments only accept `capture_thought({content})`.

To preserve category/tags/source semantics, plugin supports envelope fallback:

```text
[OBMETA v1]
category: <...>
tags: <...>
source: <...>
---
<content>
```

Disable envelope mode if your server supports structured capture metadata.

## Fallback scripts

`scripts/openbrain_call.sh` and friends provide direct RPC operations without `mcporter`. They are useful for CLI jobs, cron, and migration phases.
