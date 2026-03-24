#!/usr/bin/env bash
set -euo pipefail

if ! openclaw plugins info openbrain-native --json >/tmp/openbrain-plugin-info.json; then
  echo "PLUGIN_INFO_FAILED"
  exit 1
fi

python3 - <<'PY'
import json,sys
obj=json.load(open('/tmp/openbrain-plugin-info.json'))
if obj.get('status')!='loaded':
    print('PLUGIN_NOT_LOADED')
    sys.exit(1)
print('PLUGIN_OK')
PY

if [ -z "${MCP_URL:-}" ]; then
  echo "PLUGIN_ONLY_OK"
  echo "Set MCP_URL to run end-to-end MCP validation"
  echo "Example: export MCP_URL='https://PROJECT_REF.supabase.co/functions/v1/open-brain-mcp?key=MCP_KEY'"
  exit 0
fi

MARKER="openclaw-native-smoke-test-$(date +%s)"
AUTH_ARGS=()
if [ -n "${MCP_BEARER_TOKEN:-}" ]; then
  AUTH_ARGS=(-H "Authorization: Bearer ${MCP_BEARER_TOKEN}")
fi

curl -s -X POST "$MCP_URL" \
  -H 'content-type: application/json' \
  -H 'accept: application/json, text/event-stream' \
  "${AUTH_ARGS[@]}" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"capture_thought","arguments":{"content":"'"$MARKER"'"}}}' >/tmp/openbrain-capture.out

curl -s -X POST "$MCP_URL" \
  -H 'content-type: application/json' \
  -H 'accept: application/json, text/event-stream' \
  "${AUTH_ARGS[@]}" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"search_thoughts","arguments":{"query":"'"$MARKER"'","limit":1}}}' >/tmp/openbrain-search.out

python3 - <<'PY'
import json,re,sys
raw=open('/tmp/openbrain-search.out','r',encoding='utf-8').read().strip()
obj=None
m=re.search(r'data: (\{.*\})', raw, re.S)
if m:
    try:
        obj=json.loads(m.group(1))
    except Exception:
        obj=None
if obj is None:
    try:
        obj=json.loads(raw)
    except Exception:
        print('SEARCH_OUTPUT_PARSE_FAILED')
        sys.exit(1)
items=((obj.get('result') or {}).get('structuredContent') or {}).get('items') or []
if not items:
    print('SEARCH_ITEMS_MISSING')
    sys.exit(1)
item=items[0]
if 'id' not in item:
    print('SEARCH_ID_MISSING')
    sys.exit(1)
print(item['id'])
PY >/tmp/openbrain-id.txt

ID=$(cat /tmp/openbrain-id.txt)

curl -s -X POST "$MCP_URL" \
  -H 'content-type: application/json' \
  -H 'accept: application/json, text/event-stream' \
  "${AUTH_ARGS[@]}" \
  -d '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"delete_thought","arguments":{"id":"'"$ID"'"}}}' >/tmp/openbrain-delete.out

echo "SMOKE_TEST_OK id=$ID"
