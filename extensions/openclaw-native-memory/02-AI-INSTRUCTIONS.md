# AI Instructions

Use this if you are an AI or operator and need the shortest working path.

## Do this in order

1. Deploy or update the MCP server using [`03-MCP-SERVER.md`](./03-MCP-SERVER.md)
2. Download the extension from:
   - https://github.com/NomLom/openbrain-native-openclaw
   - https://github.com/NomLom/openbrain-native-openclaw/releases
3. Install and configure it using [`04-04-OPENCLAW-NATIVE-MEMORY-EXTENSION.md`](./04-04-OPENCLAW-NATIVE-MEMORY-EXTENSION.md)
4. Run:

```bash
bash scripts/smoke-test.sh
```

5. If that fails, use [`05-05-TROUBLESHOOTING.md`](./05-05-TROUBLESHOOTING.md)

## Done when

You are done only when:
- the plugin loads in OpenClaw
- search returns ids in `structuredContent.items[]`
- delete by id works
