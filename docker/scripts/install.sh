#!/bin/bash
# ============================================================================
# OB1 (Open Brain) — Full Install Script for Ubuntu 24.04
# ============================================================================
# This script:
#   0. Installs Claude Code (via npm)
#   1. Checks / installs prerequisites: Docker, Docker Compose, Git, Python 3
#   2. Clones the OB1 repo, configures .env, starts the stack, pulls models,
#      and connects Claude Code to the local MCP server
# ============================================================================
set -euo pipefail

# ── Colours & helpers ───────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'
BOLD='\033[1m'; NC='\033[0m'

info()  { echo -e "${CYAN}[INFO]${NC}  $*"; }
ok()    { echo -e "${GREEN}[OK]${NC}    $*"; }
warn()  { echo -e "${YELLOW}[WARN]${NC}  $*"; }
fail()  { echo -e "${RED}[FAIL]${NC}  $*"; exit 1; }

need_cmd() {
  if command -v "$1" &>/dev/null; then
    ok "$1 is already installed ($(command -v "$1"))"
    return 1  # already present
  fi
  return 0    # needs install
}

# ── Configurable defaults ──────────────────────────────────────────────────
REPO_URL="https://github.com/cyb5r67/OB1.git"
INSTALL_DIR="${OB1_INSTALL_DIR:-$HOME/OB1}"
BRANCH="docker-local-setup"

echo ""
echo -e "${BOLD}╔══════════════════════════════════════════════════════════════╗${NC}"
echo -e "${BOLD}║          OB1 (Open Brain) — Local Install Script            ║${NC}"
echo -e "${BOLD}╚══════════════════════════════════════════════════════════════╝${NC}"
echo ""

# ── 0. Install Claude Code ─────────────────────────────────────────────────
echo -e "${BOLD}── Step 0: Claude Code ──────────────────────────────────────${NC}"

# Node.js is a prerequisite for Claude Code (npm install)
if need_cmd node; then
  info "Installing Node.js 22.x LTS via NodeSource..."
  curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
  sudo apt-get install -y nodejs
  ok "Node.js $(node --version) installed"
fi

if need_cmd claude; then
  info "Installing Claude Code via npm..."
  sudo npm install -g @anthropic-ai/claude-code
  ok "Claude Code installed"
else
  info "Upgrading Claude Code to latest..."
  sudo npm update -g @anthropic-ai/claude-code 2>/dev/null || true
fi

# ── 1. Check / install prerequisites ──────────────────────────────────────
echo ""
echo -e "${BOLD}── Step 1: Prerequisites ───────────────────────────────────${NC}"

# --- Git ---
if need_cmd git; then
  info "Installing Git..."
  sudo apt-get update -qq
  sudo apt-get install -y git
  ok "Git installed"
fi

# --- Python 3 ---
if need_cmd python3; then
  info "Installing Python 3..."
  sudo apt-get update -qq
  sudo apt-get install -y python3 python3-pip
  ok "Python 3 installed"
fi

# --- Docker Engine ---
if need_cmd docker; then
  info "Installing Docker Engine..."
  sudo apt-get update -qq
  sudo apt-get install -y ca-certificates curl gnupg

  # Add Docker's official GPG key
  sudo install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg | \
    sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
  sudo chmod a+r /etc/apt/keyrings/docker.gpg

  # Add the Docker apt repository
  echo \
    "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] \
    https://download.docker.com/linux/ubuntu \
    $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | \
    sudo tee /etc/apt/sources.list.d/docker.list > /dev/null

  sudo apt-get update -qq
  sudo apt-get install -y docker-ce docker-ce-cli containerd.io \
    docker-buildx-plugin docker-compose-plugin

  # Let current user run docker without sudo
  sudo usermod -aG docker "$USER"
  ok "Docker Engine installed"
  warn "You were added to the 'docker' group. If docker commands fail below,"
  warn "log out and back in (or run: newgrp docker) then re-run this script."
fi

# --- Docker Compose (v2 plugin) ---
if ! docker compose version &>/dev/null 2>&1; then
  info "Installing Docker Compose plugin..."
  sudo apt-get update -qq
  sudo apt-get install -y docker-compose-plugin
  ok "Docker Compose plugin installed"
else
  ok "Docker Compose is available ($(docker compose version --short 2>/dev/null))"
fi

# --- Verify Docker daemon is running ---
if ! docker info &>/dev/null 2>&1; then
  info "Starting Docker daemon..."
  sudo systemctl enable --now docker
  ok "Docker daemon started"
else
  ok "Docker daemon is running"
fi

# --- NVIDIA GPU check (optional) ---
echo ""
if command -v nvidia-smi &>/dev/null; then
  ok "NVIDIA GPU detected — Ollama will use GPU acceleration"
  if ! dpkg -l nvidia-container-toolkit &>/dev/null 2>&1; then
    info "Installing NVIDIA Container Toolkit (required for Docker GPU access)..."
    # Add the NVIDIA container toolkit repo
    curl -fsSL https://nvidia.github.io/libnvidia-container/gpgkey | \
      sudo gpg --dearmor -o /usr/share/keyrings/nvidia-container-toolkit-keyring.gpg
    curl -s -L https://nvidia.github.io/libnvidia-container/stable/deb/nvidia-container-toolkit.list | \
      sed 's#deb https://#deb [signed-by=/usr/share/keyrings/nvidia-container-toolkit-keyring.gpg] https://#g' | \
      sudo tee /etc/apt/sources.list.d/nvidia-container-toolkit.list > /dev/null
    sudo apt-get update -qq
    sudo apt-get install -y nvidia-container-toolkit
    sudo nvidia-ctk runtime configure --runtime=docker
    sudo systemctl restart docker
    ok "NVIDIA Container Toolkit installed and configured"
  else
    ok "NVIDIA Container Toolkit is already installed"
  fi
else
  info "No NVIDIA GPU detected — Ollama will run on CPU (slower but works fine)"
fi

# ── Print version summary ─────────────────────────────────────────────────
echo ""
echo -e "${BOLD}── Installed versions ──────────────────────────────────────${NC}"
echo "  Node.js:         $(node --version 2>/dev/null || echo 'n/a')"
echo "  npm:             $(npm --version 2>/dev/null || echo 'n/a')"
echo "  Claude Code:     $(claude --version 2>/dev/null || echo 'n/a')"
echo "  Git:             $(git --version 2>/dev/null || echo 'n/a')"
echo "  Python:          $(python3 --version 2>/dev/null || echo 'n/a')"
echo "  Docker:          $(docker --version 2>/dev/null || echo 'n/a')"
echo "  Docker Compose:  $(docker compose version --short 2>/dev/null || echo 'n/a')"
echo ""

# ── 2. Clone repository & install application ─────────────────────────────
echo -e "${BOLD}── Step 2: Clone & Install ─────────────────────────────────${NC}"

if [ -d "$INSTALL_DIR/.git" ]; then
  info "OB1 repo already exists at $INSTALL_DIR — pulling latest..."
  git -C "$INSTALL_DIR" fetch origin
  git -C "$INSTALL_DIR" checkout "$BRANCH"
  git -C "$INSTALL_DIR" pull origin "$BRANCH"
else
  info "Cloning OB1 into $INSTALL_DIR..."
  git clone --branch "$BRANCH" "$REPO_URL" "$INSTALL_DIR"
  ok "Repository cloned"
fi

cd "$INSTALL_DIR/docker"

# --- Configure .env ---
if [ ! -f .env ]; then
  info "Generating .env from template..."
  cp .env.example .env

  # Generate a random MCP access key
  MCP_KEY=$(openssl rand -hex 32)
  sed -i "s|your-generated-access-key-here|${MCP_KEY}|" .env
  ok ".env created with auto-generated MCP_ACCESS_KEY"
else
  ok ".env already exists — keeping current values"
fi

# --- Generate TLS certificates for HTTPS proxy ---
info "Generating self-signed TLS certificate..."
bash scripts/gen-certs.sh

# --- Start the Docker stack ---
info "Starting the OB1 Docker stack (this may take a few minutes on first run)..."

# If no NVIDIA GPU / toolkit, use an override that removes the GPU requirement
HAS_GPU=false
if command -v nvidia-smi &>/dev/null && docker info 2>/dev/null | grep -qi "nvidia"; then
  HAS_GPU=true
fi

if [ "$HAS_GPU" = false ]; then
  info "No NVIDIA GPU or toolkit — starting in CPU-only mode..."
  # Python one-liner to strip the deploy key from ob1-ollama
  python3 -c "
import yaml, sys
with open('docker-compose.yml') as f:
    cfg = yaml.safe_load(f)
cfg['services']['ob1-ollama'].pop('deploy', None)
with open('docker-compose.cpu.yml', 'w') as f:
    yaml.dump(cfg, f, default_flow_style=False, sort_keys=False)
" 2>/dev/null || {
    # Fallback if PyYAML not available: use grep -v to strip deploy block
    grep -v -E "^    deploy:|^      resources:|^        reservations:|^          devices:|^            - driver:|^              count:|^              capabilities:" \
      docker-compose.yml > docker-compose.cpu.yml
  }
  docker compose -f docker-compose.cpu.yml up -d --build
  rm -f docker-compose.cpu.yml
else
  ok "NVIDIA GPU detected — using GPU acceleration"
  docker compose up -d --build
fi

ok "Docker stack is running"
docker compose ps

# --- Pull Ollama models ---
echo ""
info "Pulling AI models into Ollama (this downloads ~5 GB on first run)..."
info "  - nomic-embed-text (embeddings, ~274 MB)"
info "  - llama3 (metadata extraction, ~4.7 GB)"
echo ""

bash scripts/pull-models.sh
ok "Models pulled"

# --- Connect Claude Code ---
echo ""
info "Connecting Claude Code to the local MCP server..."
bash scripts/connect.sh
ok "Claude Code connected"

# ── Done ───────────────────────────────────────────────────────────────────
ACCESS_KEY=$(grep MCP_ACCESS_KEY .env | cut -d= -f2)

echo ""
echo -e "${BOLD}╔══════════════════════════════════════════════════════════════╗${NC}"
echo -e "${BOLD}║                    Installation Complete                     ║${NC}"
echo -e "${BOLD}╚══════════════════════════════════════════════════════════════╝${NC}"
echo ""
echo -e "  ${GREEN}MCP Server:${NC}    http://localhost:3000"
echo -e "  ${GREEN}Open WebUI:${NC}    http://localhost:8080"
echo -e "  ${GREEN}pgAdmin:${NC}       http://localhost:5050"
echo -e "  ${GREEN}PostgreSQL:${NC}    localhost:5432  (user: openbrain)"
echo ""
echo -e "  ${GREEN}Connection URL:${NC} http://localhost:3000?key=${ACCESS_KEY}"
echo ""
echo "  Restart Claude Code to pick up the MCP connection, then try:"
echo '    "Remember that I set up Open Brain today"'
echo ""
echo "  Management scripts are in: $INSTALL_DIR/docker/scripts/"
echo "    ./scripts/status.sh   — Check service health"
echo "    ./scripts/logs.sh     — View logs"
echo "    ./scripts/stop.sh     — Stop the stack"
echo ""
