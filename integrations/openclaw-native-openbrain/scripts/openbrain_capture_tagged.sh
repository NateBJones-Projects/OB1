#!/usr/bin/env bash
set -euo pipefail

# Structured capture wrapper for OpenBrain when the MCP schema only exposes {content}.
# Encodes metadata in a stable text envelope so retrieval can still use taxonomy markers.
#
# Usage:
#   openbrain_capture_tagged.sh --content "..." --category Decisions --tags "platform:azure,intent:preflight"
#   openbrain_capture_tagged.sh --content "..." --category Boot --tags "boot,taxonomy:v1" --dry-run

CATEGORY="Resources/References"
TAGS=""
SOURCE="openclaw-workspace"
STRICT=0
DRY_RUN=0
CONTENT=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --content)
      CONTENT="${2:-}"
      shift 2
      ;;
    --category)
      CATEGORY="${2:-}"
      shift 2
      ;;
    --tags)
      TAGS="${2:-}"
      shift 2
      ;;
    --source)
      SOURCE="${2:-}"
      shift 2
      ;;
    --strict)
      STRICT=1
      shift
      ;;
    --dry-run)
      DRY_RUN=1
      shift
      ;;
    --help|-h)
      cat <<'EOF'
usage: openbrain_capture_tagged.sh --content "..." [--category "..."] [--tags "a,b"] [--source "..."] [--strict] [--dry-run]
EOF
      exit 0
      ;;
    *)
      echo "unknown arg: $1" >&2
      exit 2
      ;;
  esac
done

if [[ -z "$CONTENT" ]]; then
  echo "--content is required" >&2
  exit 1
fi

TAG_LINE=""
if [[ -n "$TAGS" ]]; then
  # Normalize comma-separated tags: trim whitespace around commas.
  TAG_LINE=$(python3 - "$TAGS" <<'PY'
import sys
parts=[p.strip() for p in sys.argv[1].split(',') if p.strip()]
print(', '.join(parts))
PY
)
fi

if [[ -n "$TAG_LINE" ]]; then
  ENVELOPE=$(cat <<EOF
[OBMETA v1]
category: $CATEGORY
tags: $TAG_LINE
source: $SOURCE
---
$CONTENT
EOF
)
else
  ENVELOPE=$(cat <<EOF
[OBMETA v1]
category: $CATEGORY
source: $SOURCE
---
$CONTENT
EOF
)
fi

if [[ "$DRY_RUN" -eq 1 ]]; then
  printf '%s\n' "$ENVELOPE"
  exit 0
fi

if [[ "$STRICT" -eq 1 ]]; then
  exec /home/lom/.openclaw/workspace/scripts/openbrain_capture.sh --strict "$ENVELOPE"
fi

exec /home/lom/.openclaw/workspace/scripts/openbrain_capture.sh "$ENVELOPE"
