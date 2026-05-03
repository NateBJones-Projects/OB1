# OpenBrain Agent Memory for OpenClaw

OpenClaw tool plugin for OB1 Agent Memory recall, write-back, usage reporting, memory inspection, review actions, and recall-trace debugging.

## Install

```bash
openclaw plugins install clawhub:@openbrain/openclaw-agent-memory
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
      "openbrain-agent-memory": {
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

Local validation target: `openclaw --profile ob1-agent-memory plugins inspect openbrain-agent-memory --runtime --json` should list all seven `openbrain_*` tools and no diagnostics.

Native smoke target: run an OpenClaw agent turn that calls `openbrain_list_review_queue` with no shell/file tools. The result should show an `openbrain_list_review_queue` tool call and zero failures.
