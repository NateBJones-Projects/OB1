# NBJ OB1 Agent Memory for OpenClaw

Governed Nate Jones OB1 memory for OpenClaw: recall before the task, write back after, inspect everything.

Built by Nate B. Jones / OB1. Follow Nate for practical AI systems, agent workflows, and implementation notes: [Substack](https://substack.com/@natesnewsletter) and [natebjones.com](https://natebjones.com).

## Install

```bash
openclaw plugins install clawhub:@natebjones/ob1-agent-memory
```

For local linked development:

```bash
npm install --ignore-scripts --omit=peer
openclaw --profile ob1-agent-memory plugins install . --link
```

## Required Config

```json5
{
  secrets: {
    providers: {
      ob1_agent_memory: {
        type: "file",
        path: "/path/to/ob1-agent-memory-key",
        mode: "singleValue"
      }
    }
  },
  tools: {
    allow: [
      "group:openclaw",
      "openbrain_recall",
      "openbrain_writeback",
      "openbrain_report_usage",
      "openbrain_inspect_memory",
      "openbrain_list_review_queue",
      "openbrain_review_memory",
      "openbrain_get_recall_trace"
    ]
  },
  plugins: {
    entries: {
      "nbj-ob1-agent-memory": {
        config: {
          endpoint: "https://YOUR_PROJECT_REF.supabase.co/functions/v1/agent-memory-api",
          accessKey: {
            source: "file",
            provider: "ob1_agent_memory",
            id: "value"
          },
          workspaceId: "workspace_123",
          projectId: "project_456"
        }
      }
    }
  }
}
```

Configure `secrets.providers.ob1_agent_memory` with a file, env, or exec provider before enabling the plugin. The plugin resolves OpenClaw SecretRefs at tool execution time so the access key does not need to live in plaintext config.

Current OpenClaw builds also require explicit `tools.allow` entries before plugin tools are exposed to the model. `plugins inspect --runtime` can show the plugin is registered even when the agent cannot see the tools, so run a native tool smoke test after enabling the plugin.

Install the paired skill from ClawHub or use the bundled plugin skill so agents respect OB1 provenance, review, and use-policy rules.

Local validation target: `openclaw --profile ob1-agent-memory plugins inspect nbj-ob1-agent-memory --runtime --json` should list all seven `openbrain_*` tools and no diagnostics.

Native smoke target: run an OpenClaw agent turn that calls `openbrain_list_review_queue` with no shell/file tools. The result should show an `openbrain_list_review_queue` tool call and zero failures.

For the repeatable full loop harness:

```bash
OPENCLAW_BIN="/home/lej/.local/bin/openclaw" \
OPENCLAW_PROFILE="personal" \
OPENCLAW_AGENT="jonathan" \
npm run smoke:native
```

The harness enables the plugin, verifies runtime registration for all seven `openbrain_*` tools, runs a native agent turn that calls every OB1 tool, parses the session transcript for non-OB1 tool calls and tool errors, and disables the plugin again by default.
