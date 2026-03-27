#!/bin/bash
# Pull the required Ollama models after containers are running.
# Run this once after the first 'docker compose up'.

echo "Waiting for Ollama to be ready..."
until curl -sf http://localhost:11434/api/tags > /dev/null 2>&1; do
  sleep 2
done

echo "Pulling nomic-embed-text (embedding model)..."
curl -sf http://localhost:11434/api/pull -d '{"name": "nomic-embed-text"}' | while read -r line; do
  status=$(echo "$line" | grep -o '"status":"[^"]*"' | head -1)
  [ -n "$status" ] && printf "\r  %s" "$status"
done
echo ""

echo "Pulling llama3 (metadata extraction model)..."
curl -sf http://localhost:11434/api/pull -d '{"name": "llama3"}' | while read -r line; do
  status=$(echo "$line" | grep -o '"status":"[^"]*"' | head -1)
  [ -n "$status" ] && printf "\r  %s" "$status"
done
echo ""

echo "Done! Models are ready."
echo "Your MCP server is at: http://localhost:3000"
