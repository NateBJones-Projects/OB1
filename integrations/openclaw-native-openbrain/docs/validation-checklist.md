# Validation Checklist (Copy/Paste)

Run after install/deploy.

## Required working directory

Run commands from the plugin repo root only (the directory that contains `scripts/`, `docs/`, and `extension/`):

```bash
cd /path/to/openbrain-native-openclaw
[ -d scripts ] && [ -d docs ] && [ -d extension ] && [ -f scripts/recall_memory.sh ] \
  && echo "CWD_OK" \
  || { echo "CWD_BAD: must run from openbrain-native-openclaw repo root"; exit 1; }
```

## 1) Config + plugin health

```bash
openclaw config validate
openclaw plugins info openbrain-native --json > /tmp/openbrain-plugin-info.json
python3 - <<'PY'
import json, sys
obj=json.load(open('/tmp/openbrain-plugin-info.json'))
status=obj.get('status')
tools=set(obj.get('toolNames') or [])
required={'openbrain_search','openbrain_capture','openbrain_list_recent'}
if status!='loaded':
    print('PLUGIN_STATUS_BAD', status)
    sys.exit(1)
if not required.issubset(tools):
    print('PLUGIN_TOOLS_MISSING', sorted(required-tools))
    sys.exit(1)
print('PLUGIN_OK')
PY
```

Expected:
- command exits 0
- output includes exact `PLUGIN_OK`

## 2) Tool-policy sanity

```bash
python3 - <<'PY'
import json, os
cfg_path=os.environ.get('OPENCLAW_CONFIG', os.path.expanduser('~/.openclaw/openclaw.json'))
cfg=json.load(open(cfg_path))
print('config_path=', cfg_path)
print('tools.profile=',cfg.get('tools',{}).get('profile'))
print('tools.alsoAllow=',cfg.get('tools',{}).get('alsoAllow'))
print('agent.tools.alsoAllow=',cfg.get('agents',{}).get('list',[{}])[0].get('tools',{}).get('alsoAllow'))
PY
```

Expected:
- `tools.alsoAllow` includes openbrain plugin/tool IDs
- if using profiles, avoid plugin-only `allow` lists (use `alsoAllow`)

## 3) Fresh-session native tool check

```bash
openclaw agent --session-id native-validate-search --message "If tool openbrain_search is available, call it with query 'OpenBrain' limit 1 and reply exactly TOOL_OK. Otherwise reply exactly TOOL_MISSING." --json > /tmp/openbrain-tool-check.json
python3 - <<'PY'
import json, sys

obj = json.load(open('/tmp/openbrain-tool-check.json'))

strings = []
def walk(x):
    if isinstance(x, str):
        strings.append(x.strip())
    elif isinstance(x, dict):
        for v in x.values():
            walk(v)
    elif isinstance(x, list):
        for v in x:
            walk(v)

walk(obj)
if 'TOOL_OK' in strings and 'TOOL_MISSING' not in strings:
    print('TOOL_CHECK_OK')
    sys.exit(0)
print('TOOL_CHECK_BAD')
sys.exit(1)
PY
```

Expected:
- command exits 0
- output includes exact `TOOL_CHECK_OK`

## 4) Capture + retrieve marker

```bash
MARKER="openbrain-native-marker-$(date -u +%Y%m%dT%H%M%SZ)-$RANDOM"
openclaw agent --session-id native-validate-capture --message "Use tool openbrain_capture to capture content: ${MARKER}. category Decisions, tags platform:openclaw,topic:openbrain,kind:validation. Reply exactly CAPTURE_OK." --json > /tmp/openbrain-capture-check.json
python3 - <<'PY'
import json, sys
obj = json.load(open('/tmp/openbrain-capture-check.json'))
strings = []
def walk(x):
    if isinstance(x, str):
        strings.append(x.strip())
    elif isinstance(x, dict):
        for v in x.values():
            walk(v)
    elif isinstance(x, list):
        for v in x:
            walk(v)
walk(obj)
if 'CAPTURE_OK' in strings:
    print('CAPTURE_CHECK_OK')
    sys.exit(0)
print('CAPTURE_CHECK_BAD')
sys.exit(1)
PY

# verify through direct RPC helper
bash scripts/recall_memory.sh "$MARKER" 1 > /tmp/openbrain-recall-check.txt
python3 - <<PY
import sys
marker = """$MARKER"""
out = open('/tmp/openbrain-recall-check.txt', 'r', encoding='utf-8', errors='ignore').read()
if marker in out:
    print('RECALL_CHECK_OK')
    sys.exit(0)
print('RECALL_CHECK_BAD')
sys.exit(1)
PY
```

Expected:
- command exits 0
- output includes exact `CAPTURE_CHECK_OK`
- output includes exact `RECALL_CHECK_OK`

## 5) Failure handling checks

If `TOOL_MISSING` appears:
- restart gateway
- use a fresh session id
- confirm `tools.alsoAllow` (global and/or agent) includes plugin tools
- confirm plugin is loaded via `openclaw plugins info`
