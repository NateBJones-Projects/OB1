#!/usr/bin/env bash
set -euo pipefail

query=${1:?query required}
limit=${2:-5}

args_json=$(python3 - "$query" "$limit" <<'PY'
import json,sys
print(json.dumps({"query": sys.argv[1], "limit": int(sys.argv[2])}, separators=(",", ":")))
PY
)

exec /home/lom/.openclaw/workspace/scripts/openbrain_call.sh search_thoughts "$args_json"
