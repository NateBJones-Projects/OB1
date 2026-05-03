# OpenBrain Agent Memory for OpenClaw

OpenClaw tool plugin for OB1 Agent Memory recall, write-back, usage reporting, memory inspection, review actions, and recall-trace debugging.

## Install

```bash
openclaw plugins install clawhub:@openbrain/openclaw-agent-memory
```

## Required Config

```json5
{
  plugins: {
    entries: {
      "openbrain-agent-memory": {
        config: {
          endpoint: "https://YOUR_PROJECT_REF.supabase.co/functions/v1/agent-memory-api",
          accessKeyEnv: "OB1_AGENT_MEMORY_KEY",
          workspaceId: "workspace_123",
          projectId: "project_456"
        }
      }
    }
  }
}
```

Install the paired skill from ClawHub or use the bundled plugin skill so agents respect OB1 provenance, review, and use-policy rules.
