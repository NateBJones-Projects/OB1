# Architecture

## Native plugin path

`LLM Agent -> OpenClaw Tool Runtime -> openbrain-native plugin -> OpenBrain MCP HTTP endpoint`

The plugin sends JSON-RPC requests to MCP method `tools/call`.

## Tool mapping

- `openbrain_search` -> MCP `search_thoughts`
- `openbrain_capture` -> MCP `capture_thought`
- `openbrain_list_recent` -> MCP `list_thoughts`

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
