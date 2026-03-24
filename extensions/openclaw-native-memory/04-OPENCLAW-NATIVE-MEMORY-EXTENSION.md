# OpenClaw Native Memory Extension

This doc covers how to install the OpenClaw OpenBrain native memory extension into OpenClaw and configure OpenClaw so it can run.

## Download the extension

- Repo: https://github.com/NomLom/openbrain-native-openclaw
- Releases: https://github.com/NomLom/openbrain-native-openclaw/releases

If a release package exists, use that.

Expected package pattern:
- `openclaw-openbrain-native-<version>.tgz`

## Quickstart

1. Download the latest extension package from the releases page.
2. Install it into OpenClaw.
3. Edit your OpenClaw config so the plugin is allowed and points at your MCP server.
4. Restart the gateway.
5. Run the smoke test.

## Auth modes and security

Supported patterns:
- key in URL
- bearer token in `config.apiKey`

Use one mode, not both.

Security notes:
- do not leave long-lived keys in screenshots, shell history, tickets, or pasted logs
- prefer env vars or a secret manager when you can
- if you store secrets in config, treat the config file as sensitive

## macOS / Linux

<details>
<summary><strong>Install on macOS / Linux</strong></summary>

### 1. Install the package

```bash
openclaw plugins install /path/to/downloads/openclaw-openbrain-native-<version>.tgz --pin
openclaw plugins enable openbrain-native
```

### 2. Back up your config

```bash
cp ~/.openclaw/openclaw.json ~/.openclaw/openclaw.json.bak-$(date +%s)
```

### 3. Edit your config file

Open:

```bash
nano ~/.openclaw/openclaw.json
```

Make sure it contains the plugin entry and allowlists you need.

Example URL-key mode:

```json
{
  "plugins": {
    "allow": ["openbrain-native"],
    "entries": {
      "openbrain-native": {
        "enabled": true,
        "config": {
          "url": "https://PROJECT_REF.supabase.co/functions/v1/open-brain-mcp?key=MCP_KEY",
          "apiKey": null
        }
      }
    }
  },
  "tools": {
    "alsoAllow": [
      "openbrain-native",
      "search_thoughts",
      "capture_thought",
      "list_thoughts",
      "thought_stats",
      "delete_thought"
    ]
  }
}
```

Example bearer mode:

```json
{
  "plugins": {
    "allow": ["openbrain-native"],
    "entries": {
      "openbrain-native": {
        "enabled": true,
        "config": {
          "url": "https://PROJECT_REF.supabase.co/functions/v1/open-brain-mcp",
          "apiKey": "BEARER_TOKEN"
        }
      }
    }
  },
  "tools": {
    "alsoAllow": [
      "openbrain-native",
      "search_thoughts",
      "capture_thought",
      "list_thoughts",
      "thought_stats",
      "delete_thought"
    ]
  }
}
```

### 4. Validate and restart

```bash
openclaw config validate
openclaw gateway restart
```

If needed:

```bash
systemctl --user restart openclaw-gateway.service
```

### 5. Confirm plugin loaded

```bash
openclaw plugins info openbrain-native --json
```

### 6. Smoke test

```bash
bash scripts/smoke-test.sh
```

For end-to-end MCP validation:

```bash
export MCP_URL='https://PROJECT_REF.supabase.co/functions/v1/open-brain-mcp?key=MCP_KEY'
bash scripts/smoke-test.sh
```

For bearer mode:

```bash
export MCP_URL='https://PROJECT_REF.supabase.co/functions/v1/open-brain-mcp'
export MCP_BEARER_TOKEN='BEARER_TOKEN'
bash scripts/smoke-test.sh
```

</details>

## Windows

<details>
<summary><strong>Install on Windows</strong></summary>

### 1. Install the package

```powershell
openclaw plugins install C:\path\to\openclaw-openbrain-native-<version>.tgz --pin
openclaw plugins enable openbrain-native
```

### 2. Back up your config

```powershell
Copy-Item "$env:USERPROFILE\.openclaw\openclaw.json" "$env:USERPROFILE\.openclaw\openclaw.json.bak-$(Get-Date -Format yyyyMMddHHmmss)"
```

### 3. Edit your config file

Open:

```powershell
notepad "$env:USERPROFILE\.openclaw\openclaw.json"
```

Make sure it contains the same plugin entry and `tools.alsoAllow` values shown above.

### 4. Validate and restart

```powershell
openclaw config validate
openclaw gateway restart
```

### 5. Confirm plugin loaded

```powershell
openclaw plugins info openbrain-native --json
```

### 6. Smoke test

```powershell
bash scripts/smoke-test.sh
```

For end-to-end MCP validation:

```powershell
$env:MCP_URL='https://PROJECT_REF.supabase.co/functions/v1/open-brain-mcp?key=MCP_KEY'
bash scripts/smoke-test.sh
```

For bearer mode:

```powershell
$env:MCP_URL='https://PROJECT_REF.supabase.co/functions/v1/open-brain-mcp'
$env:MCP_BEARER_TOKEN='BEARER_TOKEN'
bash scripts/smoke-test.sh
```

</details>

## Done when

You are done when:
- the plugin loads as memory
- tools appear
- search works
- ids are available in machine-readable MCP output
- delete by id works end-to-end
