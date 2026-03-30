#!/bin/bash
# Pull/update Ollama models for OB1
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
DOCKER_DIR="$(dirname "$SCRIPT_DIR")"

cd "$DOCKER_DIR"

echo "Pulling nomic-embed-text (embedding model)..."
docker compose exec -T ob1-ollama ollama pull nomic-embed-text

echo ""
echo "Pulling llama3 (metadata extraction model)..."
docker compose exec -T ob1-ollama ollama pull llama3

echo ""
echo "Done. Available models:"
docker compose exec -T ob1-ollama ollama list
