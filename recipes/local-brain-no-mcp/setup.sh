#!/usr/bin/env bash
# local-brain-no-mcp -- one-time setup
#
# What this does:
#   1. Verifies host prereqs (docker, compose >= 2.20, git, openssl, python3)
#   2. Clones supabase/supabase to ./supabase-docker (if missing)
#   3. Writes supabase-docker/docker/.env with freshly generated secrets
#      (POSTGRES_PASSWORD, JWT_SECRET, ANON_KEY, SERVICE_ROLE_KEY, dashboard
#      creds, vault key, logflare tokens) and appends our embedding/Ollama vars
#   4. Symlinks recipes/local-brain-no-mcp/functions/{capture,search,_shared}
#      into supabase-docker/docker/volumes/functions/
#   5. Copies the thoughts schema init scripts into
#      supabase-docker/docker/volumes/db/init/
#
# Idempotent: re-running will not overwrite an existing .env (and therefore
# will not invalidate keys for already-captured data).

set -euo pipefail

# ---------- locations ----------
RECIPE_DIR="$(cd "$(dirname "$0")" && pwd)"
SUPABASE_DIR="${RECIPE_DIR}/supabase-docker"
DOCKER_DIR="${SUPABASE_DIR}/docker"
ENV_FILE="${DOCKER_DIR}/.env"
INIT_DIR="${DOCKER_DIR}/volumes/db/init"
FN_DIR="${DOCKER_DIR}/volumes/functions"

log() { printf '  \033[36m==>\033[0m %s\n' "$*"; }
warn() { printf '  \033[33m!!!\033[0m %s\n' "$*" >&2; }
die() { printf '  \033[31mxxx\033[0m %s\n' "$*" >&2; exit 1; }

# ---------- prereqs ----------
check_prereqs() {
  command -v docker >/dev/null || die "docker not found"
  command -v git    >/dev/null || die "git not found"
  command -v openssl>/dev/null || die "openssl not found"
  command -v python3>/dev/null || die "python3 not found"

  local v
  v="$(docker compose version --short 2>/dev/null || true)"
  [ -n "$v" ] || die "docker compose v2 not found"
  # crude semver compare: require >= 2.20
  local major minor
  major="${v%%.*}"; minor="${v#*.}"; minor="${minor%%.*}"
  if [ "$major" -lt 2 ] || { [ "$major" -eq 2 ] && [ "$minor" -lt 20 ]; }; then
    die "docker compose >= 2.20 required (you have $v) -- 'include:' directive needed"
  fi
  log "prereqs ok (docker compose $v)"
}

# ---------- clone supabase ----------
clone_supabase() {
  if [ -d "$SUPABASE_DIR/.git" ]; then
    log "supabase-docker already cloned -- skipping"
    return
  fi
  log "cloning supabase/supabase (shallow)..."
  git clone --depth 1 https://github.com/supabase/supabase "$SUPABASE_DIR"
  [ -f "${DOCKER_DIR}/docker-compose.yml" ] || die "cloned supabase but docker/docker-compose.yml not present -- repo layout may have changed"
}

# ---------- secrets ----------
gen_secret_hex() { openssl rand -hex "${1:-32}"; }

gen_jwts() {
  # writes ANON_KEY and SERVICE_ROLE_KEY to stdout as two lines
  local jwt_secret="$1"
  python3 - "$jwt_secret" <<'PY'
import sys, json, hmac, hashlib, base64, time
secret = sys.argv[1].encode()

def b64u(b):
    return base64.urlsafe_b64encode(b).rstrip(b"=").decode()

def sign(payload):
    header = {"alg": "HS256", "typ": "JWT"}
    h = b64u(json.dumps(header,    separators=(",", ":")).encode())
    p = b64u(json.dumps(payload,   separators=(",", ":")).encode())
    sig = hmac.new(secret, f"{h}.{p}".encode(), hashlib.sha256).digest()
    return f"{h}.{p}.{b64u(sig)}"

now = int(time.time())
exp = now + 10 * 365 * 24 * 3600  # 10 years
print(sign({"iss": "supabase", "role": "anon",         "iat": now, "exp": exp}))
print(sign({"iss": "supabase", "role": "service_role", "iat": now, "exp": exp}))
PY
}

write_env() {
  if [ -f "$ENV_FILE" ]; then
    warn ".env already exists at $ENV_FILE -- preserving existing secrets"
    return
  fi

  local example="${DOCKER_DIR}/.env.example"
  [ -f "$example" ] || die "$example not found in cloned supabase repo"

  log "generating secrets..."
  local pg_pass jwt_secret anon srk dash_pass vault_key
  pg_pass="$(gen_secret_hex 24)"
  jwt_secret="$(gen_secret_hex 32)"
  dash_pass="$(gen_secret_hex 16)"
  vault_key="$(gen_secret_hex 16)"  # 32 hex chars = 16 bytes

  local jwts
  jwts="$(gen_jwts "$jwt_secret")"
  anon="$(printf '%s\n' "$jwts" | sed -n 1p)"
  srk="$( printf '%s\n' "$jwts" | sed -n 2p)"

  log "writing $ENV_FILE..."
  # Start from upstream example, replace the placeholder values. Supabase's
  # example uses recognizable defaults like "your-super-secret-..." so we
  # target those.
  cp "$example" "$ENV_FILE"

  # Replace the documented placeholder values. We do this with python so we
  # don't have to worry about sed escaping characters in the generated
  # secrets.
  python3 - "$ENV_FILE" "$pg_pass" "$jwt_secret" "$anon" "$srk" "$dash_pass" "$vault_key" <<'PY'
import sys, re, pathlib
path = pathlib.Path(sys.argv[1])
pg_pass, jwt_secret, anon, srk, dash_pass, vault_key = sys.argv[2:8]

txt = path.read_text()

def setvar(name, value):
    global txt
    pattern = re.compile(rf"^{re.escape(name)}=.*$", re.MULTILINE)
    if pattern.search(txt):
        txt = pattern.sub(f"{name}={value}", txt)
    else:
        txt += f"\n{name}={value}\n"

setvar("POSTGRES_PASSWORD",   pg_pass)
setvar("JWT_SECRET",          jwt_secret)
setvar("ANON_KEY",            anon)
setvar("SERVICE_ROLE_KEY",    srk)
setvar("DASHBOARD_USERNAME",  "supabase")
setvar("DASHBOARD_PASSWORD",  dash_pass)
setvar("VAULT_ENC_KEY",       vault_key)
# logflare tokens are required by the analytics service; use random hex.
import secrets
setvar("LOGFLARE_PUBLIC_ACCESS_TOKEN",  secrets.token_hex(32))
setvar("LOGFLARE_PRIVATE_ACCESS_TOKEN", secrets.token_hex(32))

path.write_text(txt)
PY

  # Append our overlay vars (EMBED_*, OLLAMA_*) sourced from .env.example.
  log "appending overlay vars from $(basename "$RECIPE_DIR/.env.example")..."
  {
    printf '\n# ---------- local-brain-no-mcp overlay ----------\n'
    grep -E '^(EMBED_|OLLAMA_|BRAIN_HOST)' "$RECIPE_DIR/.env.example" || true
  } >> "$ENV_FILE"

  chmod 600 "$ENV_FILE"
}

# ---------- functions symlinks ----------
link_functions() {
  mkdir -p "$FN_DIR"
  local f
  for f in capture search list _shared; do
    local target="$FN_DIR/$f"
    if [ -L "$target" ] || [ -e "$target" ]; then
      rm -rf "$target"
    fi
    ln -s "${RECIPE_DIR}/functions/$f" "$target"
    log "linked functions/$f"
  done
}

# ---------- db init scripts ----------
copy_init_scripts() {
  mkdir -p "$INIT_DIR"
  local f
  for f in "$RECIPE_DIR"/volumes/db/init/*.sh "$RECIPE_DIR"/volumes/db/init/*.sql; do
    [ -e "$f" ] || continue
    cp "$f" "$INIT_DIR/"
    chmod +x "$INIT_DIR/$(basename "$f")" 2>/dev/null || true
    log "installed init/$(basename "$f")"
  done
}

# ---------- pull the embed model ----------
print_next_steps() {
  local kong_port brain_host anon_key
  kong_port="$(grep -E '^KONG_HTTP_PORT=' "$ENV_FILE" | cut -d= -f2-)"
  brain_host="$(grep -E '^BRAIN_HOST='     "$ENV_FILE" | cut -d= -f2-)"
  anon_key="$(  grep -E '^ANON_KEY='       "$ENV_FILE" | cut -d= -f2-)"
  kong_port="${kong_port:-8000}"
  brain_host="${brain_host:-$(hostname)}"

  cat <<EOF

  ${0##*/} done.

  Next:

    1. Bring up the stack (from this directory):

         docker compose up -d

    2. Pull the embedding model into Ollama (one-time, ~270 MB):

         docker compose exec ollama ollama pull "\${EMBED_MODEL:-nomic-embed-text}"

    3. Check Studio at:

         http://${brain_host}:3000
         user: supabase  pass: (see DASHBOARD_PASSWORD in $ENV_FILE)

    4. Install the ob1-local-http skill on each dev host. Tell Claude Code:

         export BRAIN_URL="http://${brain_host}:${kong_port}"
         export BRAIN_ANON_KEY="${anon_key}"

       Then 'cp -r skills/ob1-local-http ~/.claude/skills/' (or your client's
       skill dir).

  See README.md for backup, dim coherence, and the no-MCP design notes.

EOF
}

main() {
  check_prereqs
  clone_supabase
  write_env
  link_functions
  copy_init_scripts
  print_next_steps
}

main "$@"
