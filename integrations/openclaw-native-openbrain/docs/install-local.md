# Local Install (OpenClaw)

This document is the canonical install/config source of truth. Keep setup/deploy docs aligned to this file and link back here instead of duplicating detailed steps.

Assumes:
- OpenClaw installed and running
- OpenBrain MCP endpoint already available

## Prerequisites + preflight

Tested minimum versions:

| Component | Version floor |
| --- | --- |
| OpenClaw | `>= 0.2.0` |
| Node.js | `>= 20.0.0` |
| npm | `>= 10.0.0` |

Preflight checks:

```bash
openclaw --version
openclaw gateway status
node -v
npm -v
```

Expected:
- OpenClaw CLI available
- gateway service reachable
- Node/npm available for packaging

## Install method matrix

- Local development: install from extension path (fast iteration)
- Release/stage/prod: install from packaged `.tgz` (pin exact artifact)

This guide uses the **release-grade packaged method**.

## 1) Build extension package

```bash
cd extension
npm pack --silent
PKG=$(ls -t openclaw-openbrain-native-*.tgz | head -n1)
echo "$PKG"
```

## 2) Install plugin

```bash
sha256sum "./$PKG"
openclaw plugins install "./$PKG" --pin
openclaw plugins enable openbrain-native
```

## 3) Configure plugin

Auth options (choose exactly one mode per environment):
- URL key mode: URL includes query key (for deployments that use URL keys)
- bearer mode: URL without key + `config.apiKey`

When switching modes, explicitly unset the inactive field so stale auth state cannot interfere.

URL key mode (clear `apiKey`):

```bash
openclaw config set "plugins.entries['openbrain-native'].config.url" '"https://<host>/mcp?key=<url-key>"' --strict-json
openclaw config set "plugins.entries['openbrain-native'].config.apiKey" "null" --strict-json
```

Bearer mode (remove key from URL, set token via env var):

```bash
read -rsp 'OpenBrain bearer token: ' OPENBRAIN_API_KEY; echo
openclaw config set "plugins.entries['openbrain-native'].config.url" '"https://<host>/mcp"' --strict-json
openclaw config set "plugins.entries['openbrain-native'].config.apiKey" "\"${OPENBRAIN_API_KEY}\"" --strict-json
unset OPENBRAIN_API_KEY
```

### Credential hygiene (required)

- Do not paste long-lived keys directly into shell history.
- Prefer env vars or secret storage (for example CI secret store, vault, or injected runtime env).
- Use `read -s` for interactive token entry when working from a terminal.
- Redact secrets from shared logs, screenshots, and tickets before posting.
- If a key is exposed, rotate it before continuing.

Optional plugin settings:

```bash
openclaw config set "plugins.entries['openbrain-native'].config.envelopeMode" "true" --strict-json
openclaw config set "plugins.entries['openbrain-native'].config.defaultLimit" "8" --strict-json
openclaw config set "plugins.entries['openbrain-native'].config.timeoutMs" "25000" --strict-json
```

## 4) Trust + tool allowlists

Pin trusted plugin IDs. Keep existing entries, then add `openbrain-native`.

Executable merge-safe approach:

```bash
PLUGINS_ALLOW_JSON=$(python3 - <<'PY'
import json, os
cfg_path = os.environ.get('OPENCLAW_CONFIG', os.path.join(os.path.expanduser('~'), '.openclaw', 'openclaw.json'))
try:
    with open(cfg_path, 'r', encoding='utf-8') as f:
        cfg = json.load(f)
except FileNotFoundError:
    cfg = {}
allow = cfg.get('plugins', {}).get('allow')
if not isinstance(allow, list):
    allow = []
if 'openbrain-native' not in allow:
    allow.append('openbrain-native')
print(json.dumps(allow, separators=(',', ':')))
PY
)
openclaw config set "plugins.allow" "$PLUGINS_ALLOW_JSON" --strict-json
```

Enable optional plugin tools with profile-safe additive policy:

```bash
openclaw config set "tools.alsoAllow" '["openbrain-native","openbrain_search","openbrain_capture","openbrain_list_recent"]' --strict-json
# Per-agent override is optional and config-layout dependent; prefer global tools.alsoAllow unless you specifically need per-agent policy.
```

## 5) Validate config + restart

```bash
openclaw config validate
openclaw gateway restart
```

If your environment wraps restart awkwardly, restart the user service directly:

```bash
systemctl --user restart openclaw-gateway.service
```

## 6) Confirm plugin loaded

```bash
openclaw plugins info openbrain-native --json
```

Expected `toolNames` includes:
- `openbrain_search`
- `openbrain_capture`
- `openbrain_list_recent`

print(json.dumps(also, separators=(',', ':')))
PY
)
openclaw config set "tools.alsoAllow" "$TOOLS_ALSO_ALLOW_JSON" --strict-json
# Per-agent override is optional and config-layout dependent; prefer global tools.alsoAllow unless you specifically need per-agent policy.
```

## 5) Validate config + restart

```bash
openclaw config validate
openclaw gateway restart
```

If your environment wraps restart awkwardly, restart the user service directly:

```bash
systemctl --user restart openclaw-gateway.service
```

## 6) Confirm plugin loaded

```bash
openclaw plugins info openbrain-native --json
```

Expected `toolNames` includes:
- `openbrain_search`
- `openbrain_capture`
- `openbrain_list_recent`
