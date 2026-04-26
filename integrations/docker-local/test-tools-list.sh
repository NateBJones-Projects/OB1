#!/usr/bin/env bash
set -euo pipefail

if [[ ! -f .env ]]; then
  echo "Missing .env. Copy .env.example to .env and fill it in first." >&2
  exit 1
fi

set -a
source .env
set +a

curl -sS -X POST http://localhost:8000 \
  -H "x-brain-key: ${MCP_ACCESS_KEY}" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"tools/list","id":1}' | python3 -m json.tool
