#!/bin/bash
# Reset OB1 — destroys all data and starts fresh
# Models are preserved (stored in a separate volume)
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
DOCKER_DIR="$(dirname "$SCRIPT_DIR")"

cd "$DOCKER_DIR"

echo "WARNING: This will delete ALL thoughts from your Open Brain."
echo "Ollama models will be preserved."
read -p "Type 'yes' to confirm: " CONFIRM

if [ "$CONFIRM" != "yes" ]; then
    echo "Aborted."
    exit 1
fi

echo "Stopping OB1..."
docker compose down

echo "Removing database volume..."
docker volume rm ob1_ob1-pgdata 2>/dev/null || true

echo "Starting fresh..."
docker compose up -d --build

echo ""
echo "OB1 reset complete. Run pull-models.sh if this is a first-time setup."
