#!/usr/bin/env bash
set -euo pipefail

# Retrieve bootstrap/taxonomy memories for fresh sessions.
#
# Usage:
#   openbrain_bootstrap.sh
#   openbrain_bootstrap.sh "boot taxonomy:v1"

QUERY="${1:-boot taxonomy:v1 OpenBrain tagging}"
LIMIT="${2:-5}"

args_json=$(python3 - "$QUERY" "$LIMIT" <<'PY'
import json,sys
print(json.dumps({"query": sys.argv[1], "limit": int(sys.argv[2])}, separators=(",", ":")))
PY
)

exec /home/lom/.openclaw/workspace/scripts/openbrain_call.sh search_thoughts "$args_json"
