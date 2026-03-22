#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "usage: $0 <openbrain-mcp-url>" >&2
  exit 1
fi

URL="$1"
ROOT_DIR=$(cd "$(dirname "$0")/.." && pwd)

cd "$ROOT_DIR/extension"
PKG=$(npm pack --silent)

openclaw plugins install "$ROOT_DIR/extension/$PKG" --pin
openclaw plugins enable openbrain-native

openclaw config set "plugins.entries['openbrain-native'].config.url" "\"$URL\"" --strict-json
openclaw config set "plugins.entries['openbrain-native'].config.envelopeMode" "true" --strict-json
openclaw config set "plugins.entries['openbrain-native'].config.defaultLimit" "8" --strict-json
openclaw config set "plugins.entries['openbrain-native'].config.timeoutMs" "25000" --strict-json

# Merge-safe plugins.allow update: preserve existing allowlist and append openbrain-native if missing.
PLUGINS_ALLOW_JSON=$(python3 - <<'PY'
import json, os
cfg_path = os.environ.get('OPENCLAW_CONFIG', os.path.expanduser('~/.openclaw/openclaw.json'))
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

# Merge-safe tools.alsoAllow update: preserve existing alsoAllow and append required entries.
TOOLS_ALSO_ALLOW_JSON=$(python3 - <<'PY'
import json, os
cfg_path = os.environ.get('OPENCLAW_CONFIG', os.path.expanduser('~/.openclaw/openclaw.json'))
try:
    with open(cfg_path, 'r', encoding='utf-8') as f:
        cfg = json.load(f)
except FileNotFoundError:
    cfg = {}
required = ['openbrain-native','openbrain_search','openbrain_capture','openbrain_list_recent']
also = cfg.get('tools', {}).get('alsoAllow')
if not isinstance(also, list):
    also = []
for item in required:
    if item not in also:
        also.append(item)
print(json.dumps(also, separators=(',', ':')))
PY
)
openclaw config set "tools.alsoAllow" "$TOOLS_ALSO_ALLOW_JSON" --strict-json
# Optional per-agent additive override if your config uses agent-level policy.

openclaw config validate
openclaw gateway restart || true

echo "Install + config complete. Run: openclaw plugins info openbrain-native --json"
