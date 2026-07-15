#!/usr/bin/env bash
# Drain the enrichment queue by repeatedly invoking the worker.
# Usage: ./backfill.sh <function-url> <mcp-access-key>
# Stops on circuit break (provider outage) or when remaining hits 0.
#
# NOTE: no `set -x` — the access key must never be echoed to logs.
set -euo pipefail

URL="${1:?usage: backfill.sh <function-url> <mcp-access-key>}"
KEY="${2:?usage: backfill.sh <function-url> <mcp-access-key>}"

ITER=0
START=$(date +%s)

while :; do
  ITER=$((ITER + 1))

  RESP=$(curl -sf --max-time 180 "${URL}?limit=20" -H "x-brain-key: ${KEY}") || {
    echo "$(date +%T) invoke failed (non-2xx/timeout); retrying in 60s"
    sleep 60
    continue
  }
  echo "$(date +%T) ${RESP}"

  CIRCUIT=$(printf '%s' "$RESP" | python3 -c 'import sys,json;print(json.load(sys.stdin)["circuit_broken"])' 2>/dev/null) || CIRCUIT="parse_error"
  REMAINING=$(printf '%s' "$RESP" | python3 -c 'import sys,json;print(json.load(sys.stdin)["remaining"])' 2>/dev/null) || REMAINING="parse_error"

  if [ "$CIRCUIT" = "True" ]; then
    echo "$(date +%T) circuit broken — provider outage or budget exhausted. Stopping."
    exit 1
  fi

  # Periodic progress line.
  if [ $((ITER % 10)) -eq 0 ]; then
    ELAPSED=$(( $(date +%s) - START ))
    echo "$(date +%T) [progress] iteration ${ITER}, remaining ${REMAINING}, elapsed ${ELAPSED}s"
  fi

  # Correction: the worker returns remaining = -1 as an unknown-count sentinel
  # when its count query fails. Treat only remaining == 0 as a clean drain.
  # Negative or non-numeric values are transient count failures, not completion.
  if ! [[ "$REMAINING" =~ ^-?[0-9]+$ ]]; then
    echo "$(date +%T) WARN: remaining is non-numeric ('${REMAINING}') — transient count failure; retrying in 30s"
    sleep 30
    continue
  fi
  if [ "$REMAINING" -eq 0 ]; then
    echo "$(date +%T) queue drained."
    break
  fi
  if [ "$REMAINING" -lt 0 ]; then
    echo "$(date +%T) WARN: remaining is negative (${REMAINING}, count-query sentinel) — not drained; retrying in 30s"
    sleep 30
    continue
  fi

  sleep 5
done
