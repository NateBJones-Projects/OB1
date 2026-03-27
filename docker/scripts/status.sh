#!/bin/bash
# Show OB1 stack status
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
DOCKER_DIR="$(dirname "$SCRIPT_DIR")"

cd "$DOCKER_DIR"

echo "=== OB1 Containers ==="
docker compose ps
echo ""

echo "=== Ollama Models ==="
docker compose exec -T ob1-ollama ollama list 2>/dev/null || echo "(ollama not running)"
echo ""

echo "=== Thought Count ==="
docker compose exec -T ob1-postgres psql -U openbrain -c "SELECT count(*) AS thoughts FROM thoughts;" 2>/dev/null || echo "(postgres not running)"
