#!/bin/bash
# Show OB1 logs. Usage: ./logs.sh [service] [--follow]
# Services: ob1-mcp, ob1-postgres, ob1-ollama
# Example: ./logs.sh ob1-mcp --follow

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
DOCKER_DIR="$(dirname "$SCRIPT_DIR")"

cd "$DOCKER_DIR"

if [ -z "$1" ]; then
    docker compose logs --tail=50
else
    docker compose logs "$@"
fi
