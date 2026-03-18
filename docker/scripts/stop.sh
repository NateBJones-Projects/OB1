#!/bin/bash
# Stop the OB1 stack (data is preserved in volumes)
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
DOCKER_DIR="$(dirname "$SCRIPT_DIR")"

cd "$DOCKER_DIR"

echo "Stopping OB1..."
docker compose down
echo "Stopped. Data is preserved — run start.sh to resume."
