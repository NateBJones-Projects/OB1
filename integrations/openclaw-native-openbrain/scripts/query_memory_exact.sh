#!/usr/bin/env bash
set -euo pipefail

term="${1:-}"
if [[ -z "$term" ]]; then
  term="${2:-}"
fi
if [[ -z "$term" ]]; then
  echo "usage: query_memory_exact.sh '<term>'" >&2
  exit 1
fi

args_json=$(python3 - "$term" <<'PY'
import json,sys
print(json.dumps({"query": sys.argv[1], "limit": 5}, separators=(",", ":")))
PY
)

exec /home/lom/.openclaw/workspace/scripts/openbrain_call.sh search_thoughts "$args_json"
