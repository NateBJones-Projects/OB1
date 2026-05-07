#!/bin/bash
# enrichment-pipeline.sh — Post-import enrichment pipeline
# Run after Gmail/Chat/Drive imports complete

set -e
cd /home/ubuntu/open-brain-v2

# Load env
source .env.local
export OPEN_BRAIN_URL OPEN_BRAIN_SERVICE_KEY OPENAI_API_KEY
export LLM_API_KEY="$OPENAI_API_KEY"
export LLM_BASE_URL="https://api.openai.com/v1"
export LLM_MODEL="gpt-4o-mini"

MCP_KEY="103b14a836b25e08c9a83fe1faf7dd404f38ed06278c17e05b5a933d6bb9ef64"
EDGE_FN="${OPEN_BRAIN_URL}/functions/v1/dok-pipeline"

echo "=== Enrichment Pipeline Starting ==="
TOTAL=$(curl -s "$OPEN_BRAIN_URL/rest/v1/thoughts?select=id&limit=1" -H "apikey: $OPEN_BRAIN_SERVICE_KEY" -H "Authorization: Bearer $OPEN_BRAIN_SERVICE_KEY" -H "Prefer: count=exact" -I 2>/dev/null | grep -oP '\d+$')
echo "Total thoughts: $TOTAL"
echo ""

# Step 1: Wiki compiler (entities + autobiography)
echo "[1/5] Running wiki compiler (entities + edges + autobiography)..."
node recipes/wiki-compiler/compile-wiki.mjs --topic autobiography --edge-limit 100 --entity-batch-limit 50 2>&1 | tail -30
echo ""

# Step 2: Classify edges (lower threshold to find more relations)
echo "[2/5] Running typed edge classifier..."
node recipes/typed-edge-classifier/classify-edges.mjs --limit 200 --min-confidence 0.5 --single-model gpt-4o-mini 2>&1 | tail -30
echo ""

# Step 3: DOK2 — categorize
echo "[3/5] Running DOK pipeline — categorize (DOK2)..."
curl -s "${EDGE_FN}?action=categorize&key=${MCP_KEY}" -X POST \
  -H "Authorization: Bearer ${OPEN_BRAIN_SERVICE_KEY}" \
  -H "Content-Type: application/json" \
  -d '{}' 2>&1
echo ""

# Step 4: DOK3 — synthesize
echo "[4/5] Running DOK pipeline — synthesize (DOK3)..."
curl -s "${EDGE_FN}?action=synthesize&key=${MCP_KEY}" -X POST \
  -H "Authorization: Bearer ${OPEN_BRAIN_SERVICE_KEY}" \
  -H "Content-Type: application/json" \
  -d '{}' 2>&1
echo ""

# Step 5: Final stats
echo "[5/5] Final stats..."
echo "  Thoughts: $(curl -s "$OPEN_BRAIN_URL/rest/v1/thoughts?select=id&limit=1" -H "apikey: $OPEN_BRAIN_SERVICE_KEY" -H "Authorization: Bearer $OPEN_BRAIN_SERVICE_KEY" -H "Prefer: count=exact" -I 2>/dev/null | grep -oP '\d+$')"
echo "  Entities: $(curl -s "$OPEN_BRAIN_URL/rest/v1/entities?select=id&limit=1" -H "apikey: $OPEN_BRAIN_SERVICE_KEY" -H "Authorization: Bearer $OPEN_BRAIN_SERVICE_KEY" -H "Prefer: count=exact" -I 2>/dev/null | grep -oP '\d+$' || echo '0')"
echo "  Edges: $(curl -s "$OPEN_BRAIN_URL/rest/v1/edges?select=id&limit=1" -H "apikey: $OPEN_BRAIN_SERVICE_KEY" -H "Authorization: Bearer $OPEN_BRAIN_SERVICE_KEY" -H "Prefer: count=exact" -I 2>/dev/null | grep -oP '\d+$' || echo '0')"
echo "  Thought Edges: $(curl -s "$OPEN_BRAIN_URL/rest/v1/thought_edges?select=id&limit=1" -H "apikey: $OPEN_BRAIN_SERVICE_KEY" -H "Authorization: Bearer $OPEN_BRAIN_SERVICE_KEY" -H "Prefer: count=exact" -I 2>/dev/null | grep -oP '\d+$' || echo '0')"
echo "  DOK Levels: $(curl -s "$OPEN_BRAIN_URL/rest/v1/dok_levels?select=id&limit=1" -H "apikey: $OPEN_BRAIN_SERVICE_KEY" -H "Authorization: Bearer $OPEN_BRAIN_SERVICE_KEY" -H "Prefer: count=exact" -I 2>/dev/null | grep -oP '\d+$' || echo '0')"

echo ""
echo "=== Enrichment Pipeline Complete ==="
