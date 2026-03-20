#!/bin/bash
# Generate self-signed TLS certificate for the OB1 HTTPS proxy
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
DOCKER_DIR="$(dirname "$SCRIPT_DIR")"
CERT_DIR="${DOCKER_DIR}/nginx/certs"

mkdir -p "$CERT_DIR"

if [ -f "$CERT_DIR/ob1.crt" ] && [ -f "$CERT_DIR/ob1.key" ]; then
  echo "Certificates already exist at $CERT_DIR — skipping."
  exit 0
fi

LAN_IP=$(hostname -I | awk '{print $1}')

echo "Generating self-signed certificate for localhost + ${LAN_IP}..."

openssl req -x509 -nodes -days 3650 \
  -newkey rsa:2048 \
  -keyout "$CERT_DIR/ob1.key" \
  -out "$CERT_DIR/ob1.crt" \
  -subj "/CN=ob1-local" \
  -addext "subjectAltName=DNS:localhost,IP:127.0.0.1,IP:${LAN_IP}"

echo "Certificate generated:"
echo "  $CERT_DIR/ob1.crt"
echo "  $CERT_DIR/ob1.key"
echo ""
echo "To trust this cert on Windows (removes browser/app warnings):"
echo "  1. Copy ob1.crt to your Windows machine"
echo "  2. Double-click → Install Certificate → Local Machine → Trusted Root Certification Authorities"
