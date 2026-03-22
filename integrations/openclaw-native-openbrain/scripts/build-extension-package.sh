#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR=$(cd "$(dirname "$0")/.." && pwd)
cd "$ROOT_DIR/extension"

echo "[build] packing extension..."
PKG=$(npm pack --silent)
echo "[build] created: $ROOT_DIR/extension/$PKG"
