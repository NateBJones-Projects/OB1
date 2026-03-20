#!/bin/bash
# Connect Claude Code and Claude Desktop to the local OB1 MCP server
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
DOCKER_DIR="$(dirname "$SCRIPT_DIR")"

cd "$DOCKER_DIR"

ACCESS_KEY=$(grep MCP_ACCESS_KEY .env | cut -d= -f2)

# Detect LAN IP for cross-machine access
LAN_IP=$(hostname -I | awk '{print $1}')
MCP_HTTP="http://${LAN_IP}:3000"
MCP_HTTPS="https://${LAN_IP}:3443"

# ── Claude Code (HTTP — works natively) ────────────────────────────────────
echo "Connecting Claude Code to OB1..."
claude mcp add --transport http open-brain \
  "${MCP_HTTP}" \
  --header "x-brain-key: ${ACCESS_KEY}" 2>/dev/null || true

echo "  Done. Restart Claude Code to pick up the connection."

# ── Claude Desktop (HTTPS via nginx proxy) ─────────────────────────────────
echo ""
echo "Configuring Claude Desktop (HTTPS connector)..."

# Determine claude_desktop_config.json location
if [ "$(uname -s)" = "Darwin" ]; then
  CONFIG_DIR="$HOME/Library/Application Support/Claude"
elif grep -qi microsoft /proc/version 2>/dev/null; then
  # WSL — write to Windows-side AppData
  WIN_USER=$(cmd.exe /C "echo %USERNAME%" 2>/dev/null | tr -d '\r')
  CONFIG_DIR="/mnt/c/Users/${WIN_USER}/AppData/Roaming/Claude"
else
  CONFIG_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/Claude"
fi

CONFIG_FILE="${CONFIG_DIR}/claude_desktop_config.json"
mkdir -p "$CONFIG_DIR"

CONNECTOR_URL="${MCP_HTTPS}?key=${ACCESS_KEY}"

if [ -f "$CONFIG_FILE" ]; then
  python3 -c "
import json
with open('$CONFIG_FILE') as f:
    cfg = json.load(f)
cfg.setdefault('mcpServers', {})
cfg['mcpServers']['open-brain'] = {
    'command': 'npx',
    'args': ['mcp-remote', '$CONNECTOR_URL']
}
with open('$CONFIG_FILE', 'w') as f:
    json.dump(cfg, f, indent=2)
"
else
  python3 -c "
import json
cfg = {
    'mcpServers': {
        'open-brain': {
            'command': 'npx',
            'args': ['mcp-remote', '$CONNECTOR_URL']
        }
    }
}
with open('$CONFIG_FILE', 'w') as f:
    json.dump(cfg, f, indent=2)
"
fi

echo "  Done. Written to: $CONFIG_FILE"
echo "  Restart Claude Desktop to pick up the connection."

# ── Summary ────────────────────────────────────────────────────────────────
echo ""
echo "Connection details:"
echo "  MCP (HTTP):   ${MCP_HTTP}?key=${ACCESS_KEY}"
echo "  MCP (HTTPS):  ${MCP_HTTPS}?key=${ACCESS_KEY}"
echo ""
echo "  Claude Code:     connected via HTTP (restart to activate)"
echo "  Claude Desktop:  connected via HTTPS (restart to activate)"
echo ""
echo "NOTE: The HTTPS cert is self-signed. To avoid warnings, install"
echo "  ${DOCKER_DIR}/nginx/certs/ob1.crt as a trusted root CA on your machine."
