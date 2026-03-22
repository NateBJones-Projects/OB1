#!/usr/bin/env bash
set -euo pipefail

# OpenBrain capture helper.
#
# Default mode is best-effort (non-blocking) for cron/hooks.
# Use --strict to fail on write errors.
# Use --dry-run to print payload without writing.
#
# Usage:
#   openbrain_capture.sh "text to store"
#   openbrain_capture.sh --strict "text to store"

STRICT=0
DRY_RUN=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --strict)
      STRICT=1
      shift
      ;;
    --dry-run)
      DRY_RUN=1
      shift
      ;;
    --help|-h)
      echo 'usage: openbrain_capture.sh [--strict] [--dry-run] "content"' >&2
      exit 0
      ;;
    *)
      break
      ;;
  esac
done

CONTENT="${1:-}"
if [[ -z "$CONTENT" ]]; then
  echo 'usage: openbrain_capture.sh [--strict] [--dry-run] "content"' >&2
  exit 1
fi

ARGS_JSON=$(python3 - "$CONTENT" <<'PY'
import json,sys
print(json.dumps({"content": sys.argv[1]}, separators=(",", ":")))
PY
)

if [[ "$DRY_RUN" -eq 1 ]]; then
  printf '%s\n' "$ARGS_JSON"
  exit 0
fi

if /home/lom/.openclaw/workspace/scripts/openbrain_call.sh capture_thought "$ARGS_JSON" >/dev/null 2>&1; then
  exit 0
fi

log_file="/home/lom/.openclaw/workspace/reports/openbrain-capture-errors.log"
mkdir -p "$(dirname "$log_file")"
{
  echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] capture_thought failed"
  echo "content_preview=${CONTENT:0:180}"
  echo "---"
} >> "$log_file"

if [[ "$STRICT" -eq 1 ]]; then
  echo "openbrain capture failed (see $log_file)" >&2
  exit 1
fi

exit 0
