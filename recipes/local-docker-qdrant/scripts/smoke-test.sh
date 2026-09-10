#!/usr/bin/env bash
# smoke-test.sh — Integration smoke test for the local-docker-qdrant recipe.
# Usage: bash scripts/smoke-test.sh
# Assumes the stack is running: docker compose up --build -d
# Requires: curl, jq, OPEN_BRAIN_KEY environment variable
set -euo pipefail

# --- Guard: require jq ---
if ! command -v jq &>/dev/null; then
  echo "ERROR: jq is required but not found on PATH."
  echo "  Windows: winget install jqlang.jq"
  echo "  Or download jq.exe from https://jqlang.org/download/ and place it in a directory on your PATH."
  exit 1
fi

# --- Guard: require OPEN_BRAIN_KEY ---
if [[ -z "${OPEN_BRAIN_KEY:-}" ]]; then
  echo "ERROR: OPEN_BRAIN_KEY environment variable is not set."
  echo "  Export it before running: export OPEN_BRAIN_KEY=<your-key>"
  exit 1
fi

echo "Starting smoke tests for local-docker-qdrant..."
echo "  MCP server : http://localhost:3100"
echo "  Qdrant     : http://localhost:6333"
echo ""

# --- Step 1: Qdrant collection check ---
echo "Step 1: Qdrant collection check..."
COLLECTION=$(curl -s http://localhost:6333/collections/thoughts)
VECTOR_SIZE=$(echo "$COLLECTION" | jq -r '.result.config.params.vectors.size')
DISTANCE=$(echo "$COLLECTION" | jq -r '.result.config.params.vectors.distance')
if [[ "$VECTOR_SIZE" == "1024" && "$DISTANCE" == "Cosine" ]]; then
  echo "  PASS: collection exists, vector size=1024, distance=Cosine"
else
  echo "  FAIL: unexpected collection config: size=$VECTOR_SIZE distance=$DISTANCE"
  exit 1
fi

# --- Step 2: Capture a test thought (private by default) ---
echo "Step 2: Capture test thought..."
CAPTURE_RESP=$(curl -s -X POST http://localhost:3100/capture-external \
  -H "Content-Type: application/json" \
  -H "x-brain-key: $OPEN_BRAIN_KEY" \
  -d '{"content":"Smoke test thought: Open Brain Qdrant stack is working correctly","source":"smoke-test"}')
CAPTURED_ID=$(echo "$CAPTURE_RESP" | jq -r '.id')
if [[ -z "$CAPTURED_ID" || "$CAPTURED_ID" == "null" ]]; then
  echo "  FAIL: capture returned no id. Response: $CAPTURE_RESP"
  exit 1
fi
echo "  PASS: captured id=$CAPTURED_ID"

# --- Step 3: Search and verify the captured thought appears ---
echo "Step 3: Search for captured thought..."
sleep 1  # Allow Qdrant to index the point
SEARCH_RESP=$(curl -s -X POST http://localhost:3100/search-external \
  -H "Content-Type: application/json" \
  -H "x-brain-key: $OPEN_BRAIN_KEY" \
  -d '{"query":"Open Brain Qdrant stack smoke test","limit":5,"threshold":0.1}')
FOUND=$(echo "$SEARCH_RESP" | jq -r --arg id "$CAPTURED_ID" '.results[]? | select(.id == $id) | .id')
if [[ "$FOUND" == "$CAPTURED_ID" ]]; then
  echo "  PASS: captured thought found in search results"
else
  echo "  FAIL: captured thought not found in results. Response: $SEARCH_RESP"
  exit 1
fi

# --- Step 4: Capture a shared thought ---
echo "Step 4: Capture shared thought..."
SHARED_RESP=$(curl -s -X POST http://localhost:3100/capture-external \
  -H "Content-Type: application/json" \
  -H "x-brain-key: $OPEN_BRAIN_KEY" \
  -d '{"content":"Smoke test shared thought: visible to all users","source":"smoke-test","visibility":"shared"}')
SHARED_ID=$(echo "$SHARED_RESP" | jq -r '.id')
if [[ -z "$SHARED_ID" || "$SHARED_ID" == "null" ]]; then
  echo "  FAIL: shared capture returned no id. Response: $SHARED_RESP"
  exit 1
fi
echo "  PASS: shared thought captured id=$SHARED_ID"

# --- Step 5: Browse mode — verify results returned ---
echo "Step 5: Browse mode (tag filter)..."
BROWSE_RESP=$(curl -s -X POST http://localhost:3100/search-external \
  -H "Content-Type: application/json" \
  -H "x-brain-key: $OPEN_BRAIN_KEY" \
  -d '{"source":"smoke-test","limit":10}')
BROWSE_COUNT=$(echo "$BROWSE_RESP" | jq '.results | length')
BROWSE_MODE=$(echo "$BROWSE_RESP" | jq -r '.mode')
if [[ "$BROWSE_MODE" == "browse" && "$BROWSE_COUNT" -ge 1 ]]; then
  echo "  PASS: browse mode returned $BROWSE_COUNT result(s)"
else
  echo "  FAIL: browse mode failed. mode=$BROWSE_MODE count=$BROWSE_COUNT"
  exit 1
fi

echo ""
echo "All smoke tests PASSED."
echo "Stack is healthy at http://localhost:3100"
echo "Qdrant collection: http://localhost:6333/collections/thoughts"
