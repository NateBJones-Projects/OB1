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
  plugins: {
    entries: {
      "openbrain-agent-memory": {
        config: {
          endpoint: "https://YOUR_PROJECT_REF.supabase.co/functions/v1/agent-memory-api",
          accessKey: "${OB1_AGENT_MEMORY_KEY}",
          workspaceId: "workspace_123",
          projectId: "project_456"
        }
      }
    }
  }
}
```

OpenClaw resolves `${OB1_AGENT_MEMORY_KEY}` from its config/environment layer before plugin activation. The plugin itself does not read `process.env`.

Install the paired skill from ClawHub or use the bundled plugin skill so agents respect OB1 provenance, review, and use-policy rules.

Local validation target: `openclaw --profile ob1-agent-memory plugins inspect openbrain-agent-memory --runtime --json` should list all seven `openbrain_*` tools and no diagnostics.
