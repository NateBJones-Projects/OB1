#!/usr/bin/env bash
set -euo pipefail

# Direct OpenBrain MCP caller (no mcporter dependency).
#
# Usage:
#   openbrain_call.sh <tool_name> [args_json]
#
# Env:
#   OPENBRAIN_URL            Optional override for MCP endpoint URL
#   OPENBRAIN_CALL_RETRIES   Retry count (default: 2)
#   OPENBRAIN_CALL_TIMEOUT_S Timeout per request seconds (default: 25)

TOOL_NAME="${1:-}"
ARGS_JSON="${2:-'{}'}"

if [[ -z "$TOOL_NAME" ]]; then
  echo "usage: openbrain_call.sh <tool_name> [args_json]" >&2
  exit 1
fi

if [[ -z "${OPENBRAIN_URL:-}" ]]; then
  OPENBRAIN_URL=$(python3 - <<'PY'
import json
cfg=json.load(open('/home/lom/.openclaw/workspace/config/mcporter.json'))
print(cfg['mcpServers']['openbrain']['baseUrl'])
PY
)
fi

RETRIES="${OPENBRAIN_CALL_RETRIES:-2}"
TIMEOUT_S="${OPENBRAIN_CALL_TIMEOUT_S:-25}"

payload=$(python3 - "$TOOL_NAME" "$ARGS_JSON" <<'PY'
import json,sys
name=sys.argv[1]
args=json.loads(sys.argv[2])
print(json.dumps({
  "jsonrpc":"2.0",
  "id":1,
  "method":"tools/call",
  "params":{"name":name,"arguments":args}
}, separators=(",",":")))
PY
)

attempt=0
last_err=""
while (( attempt <= RETRIES )); do
  if raw=$(curl -sS -X POST "$OPENBRAIN_URL" \
      -H 'content-type: application/json' \
      -H 'accept: application/json, text/event-stream' \
      --max-time "$TIMEOUT_S" \
      --data "$payload" 2>&1); then

    parsed=$(python3 - <<'PY' "$raw"
import json,sys
raw=sys.argv[1]
# Supports both raw JSON and SSE payloads.
if raw.lstrip().startswith('{'):
    obj=json.loads(raw)
else:
    data_lines=[]
    for line in raw.splitlines():
        if line.startswith('data: '):
            data_lines.append(line[6:])
    if not data_lines:
        raise SystemExit('No MCP data payload found')
    obj=json.loads(data_lines[-1])

if obj.get('error'):
    raise SystemExit(json.dumps(obj['error']))

result=obj.get('result',{})
content=result.get('content',[])
texts=[c.get('text','') for c in content if isinstance(c,dict) and c.get('type')=='text']
if texts:
    print('\n\n'.join(t for t in texts if t))
else:
    print(json.dumps(result, indent=2))
PY
) && { printf "%s\n" "$parsed"; exit 0; }

    last_err="$parsed"
  else
    last_err="$raw"
  fi

  if (( attempt == RETRIES )); then
    break
  fi
  sleep $((attempt + 1))
  attempt=$((attempt + 1))
done

printf "%s\n" "$last_err" >&2
exit 1
