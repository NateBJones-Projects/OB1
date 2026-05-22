# NBJ OB1 Agent Memory for OpenClaw 0.1.6

ClawHub install compatibility fix.

## Changed

- Marks the `openclaw` peer dependency as optional for npm install planning.
- Keeps the OpenClaw peer declaration so the host SDK can still be symlinked by
  OpenClaw during plugin install.
- Updates install docs so OpenClaw `2026.5.7` and newer use the one-line
  ClawHub install path.
- Keeps the tarball fallback documented for OpenClaw `2026.5.2`.

## Verification Target

The one-line install should work from a clean profile:

```bash
openclaw --profile ob1-agent-memory plugins install clawhub:@natebjones/ob1-agent-memory
openclaw --profile ob1-agent-memory plugins inspect nbj-ob1-agent-memory --runtime --json
```

Runtime inspect should show version `0.1.6`, all seven `openbrain_*` tools,
and no diagnostics.
