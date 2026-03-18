#!/bin/bash
# Start the OB1 stack
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
DOCKER_DIR="$(dirname "$SCRIPT_DIR")"

cd "$DOCKER_DIR"

echo "Starting OB1..."
docker compose up -d --build

echo ""
echo "Waiting for services to be healthy..."
docker compose ps

echo ""
echo "MCP server: http://localhost:3000"
echo "Connection URL: http://localhost:3000?key=$(grep MCP_ACCESS_KEY .env | cut -d= -f2)"
