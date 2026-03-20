#!/bin/bash
# Start the OB1 stack
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
DOCKER_DIR="$(dirname "$SCRIPT_DIR")"

cd "$DOCKER_DIR"

echo "Starting OB1..."

# Detect GPU availability — use CPU-only compose if no NVIDIA driver/toolkit
if command -v nvidia-smi &>/dev/null && docker info 2>/dev/null | grep -qi "nvidia"; then
  echo "  NVIDIA GPU detected — starting with GPU acceleration"
  docker compose up -d --build
else
  echo "  No NVIDIA GPU/toolkit — starting in CPU-only mode"
  grep -v -E "^    deploy:|^      resources:|^        reservations:|^          devices:|^            - driver:|^              count:|^              capabilities:" \
    docker-compose.yml > docker-compose.cpu.yml
  docker compose -f docker-compose.cpu.yml up -d --build
  rm -f docker-compose.cpu.yml
fi

echo ""
echo "Waiting for services to be healthy..."
docker compose ps

LAN_IP=$(hostname -I | awk '{print $1}')
ACCESS_KEY=$(grep MCP_ACCESS_KEY .env | cut -d= -f2)

echo ""
echo "MCP server:     http://${LAN_IP}:3000"
echo "MCP (HTTPS):    https://${LAN_IP}:3443"
echo "Connection URL: http://${LAN_IP}:3000?key=${ACCESS_KEY}"
