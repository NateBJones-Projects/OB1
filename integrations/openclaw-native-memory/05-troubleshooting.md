# Troubleshooting

Use this as a symptom → cause → fix → re-validation guide.

## Re-validation bundle (run after every fix)

```bash
openclaw config validate
openclaw plugins info openbrain-native --json
openclaw agent --session-id native-recheck-search --message "If tool search_thoughts is available, call it with query 'OpenBrain' limit 1 and reply exactly TOOL_OK. Otherwise reply exactly TOOL_MISSING." --json
MARKER="recheck-$(date -u +%Y%m%dT%H%M%SZ)-$RANDOM"
openclaw agent --session-id native-recheck-capture --message "Use tool capture_thought to capture content: ${MARKER}. category Decisions, tags platform:openclaw,topic:openbrain,kind:validation. Reply exactly CAPTURE_OK." --json
bash scripts/recall_memory.sh "$MARKER" 1
```

Expected green signals:
- config valid
- plugin status loaded with tool names
- `TOOL_OK`
- `CAPTURE_OK`
- marker appears in recall output

## Compatibility matrix (minimum tested)

| Component | Minimum |
|---|---|
| OpenClaw | `>= 0.2.0` |
| Node.js | `>= 20.0.0` |
| npm | `>= 10.0.0` |
| Plugin | current repo release tag |

If versions are below floor or mixed unexpectedly after upgrade, pin/rollback to a known-good combination before deeper debugging.

## Failure matrix

| Symptom | Probable cause | Fix | Re-validate |
|---|---|---|---|
| `TOOL_MISSING` | profile policy filtered optional plugin tool | use `tools.alsoAllow` and `agents[].tools.alsoAllow` for openbrain tools | run re-validation bundle |
| `401/403` from MCP | wrong key/token, expired credential, wrong auth mode | verify URL key vs `config.apiKey`; rotate/update token | `search_thoughts` check + bundle |
| timeout / DNS / TLS errors | endpoint unreachable, DNS issue, cert chain/proxy issue | verify endpoint reachability and cert/proxy path | curl check + bundle |
| malformed JSON/SSE parse | endpoint response framing mismatch or gateway/proxy altering stream | verify `accept` header and raw response body framing | direct curl probe + bundle |
| capture appears successful but not persisted | non-strict capture path used in fallback scripts | use `--strict` for captures and inspect error log | strict capture + recall marker |
| `loaded without install/load-path provenance` warning | plugin copied manually or trust not pinned | install via `openclaw plugins install`, set `plugins.allow`, keep install record | plugin info + restart + bundle |
| wrong tool names called by plugin | MCP server tool names differ from defaults | set `searchToolName` / `captureToolName` / `listToolName` in plugin config | `search_thoughts` and `capture_thought` tests |
| intermittent 429/5xx | backend rate limiting/transient upstream failure | add retry/backoff and reduce burst calls | rerun bundle after cooldown |
| plugin not loaded / tools absent | plugin disabled, install failed, load error at startup | reinstall/enable plugin and confirm `openclaw plugins info openbrain-native --json` shows `status: loaded` | run re-validation bundle |
| gateway unhealthy/stale runtime | gateway not running, partial restart, stale process | check `openclaw status`, restart gateway/service, confirm active pid/state | run re-validation bundle |
| stale session still shows old behavior | session created before policy/plugin changes | use a fresh `--session-id` for all checks and close/restart stale sessions | rerun search + capture checks in fresh session |
| config path/schema mistake | wrong JSON path or strict-json quoting issue left ineffective config | print effective config values and reapply with exact path under `plugins.entries['openbrain-native'].config.*` | `openclaw config validate` + re-validation bundle |
| wrong MCP endpoint path/version | URL host reachable but route/protocol contract wrong | verify exact MCP endpoint path and minimal JSON-RPC probe request | direct probe + `search_thoughts` check |
| missing script/runtime dependencies | fallback scripts require tools not present (`python3`, `curl`) | install dependencies or run native plugin-only checks | run checklist commands without fallback scripts |
| retrieval quality drift | capture succeeds but search relevance/consistency poor | tune query terms/limits, validate with known marker records, review backend index health | marker recall + targeted semantic query checks |
| plugin API incompatibility after OpenClaw/plugin upgrade | runtime/plugin contract mismatch across versions | pin compatible plugin/OpenClaw versions, or rollback to last known-good pair | version check + full re-validation bundle |
| config changes seem ignored | editing wrong active config file/context (`OPENCLAW_CONFIG`, different user/service) | print active config path, apply changes to active file, restart gateway | config validate + plugin info + fresh session tool check |
| tool listed but call denied by policy/security layer | execution policy/sandbox restrictions, not tool registration | align policy/security settings to allow intended calls with least privilege | fresh session direct tool-call check + bundle |
| capture OK but immediate search miss | backend indexing/eventual consistency delay | add short bounded retry window before declaring failure (for example 3 tries over 60-120s) | timed recall retries + semantic/exact checks |
| flaky checks right after restart | gateway/plugin initialization race | wait for readiness before validation and avoid parallel validation spam | status healthy + rerun bundle once |
| tool call fails with schema/argument error | invalid args passed to tool/MCP endpoint | validate payload shape and required fields, then retry with minimal known-good payload | direct `search_thoughts` with minimal args + bundle |
| config read/write fails under service | config file ownership/permissions mismatch for active service user | verify active config path + file owner/perm; align with service user and retry | config validate + plugin info + fresh tool check |
| package install fails or behaves unexpectedly | wrong/stale/corrupt tgz artifact | verify exact package filename/version and `sha256sum` before install; rebuild package if mismatch | reinstall package + plugin info + bundle |
| `openclaw` / `python3` / `curl` / node/npm missing | PATH/dependency issue on host | verify binaries with `command -v`, install missing deps, ensure service/user PATH alignment | rerun failed command + bundle |
| endpoint works in one shell but fails in another | proxy env poisoning (`HTTP_PROXY`/`HTTPS_PROXY`/`NO_PROXY`) | print/unset proxy env for validation shell, set proper NO_PROXY for MCP host | direct curl probe + bundle |
| intermittent 401/403 with correct key | host clock skew/token validity window mismatch | verify NTP sync and UTC time, sync clock, then retry | auth probe + bundle |
| small capture works, large capture fails | upstream payload/body size limit (413/truncation) | split/chunk captures or reduce body size; adjust upstream limits if owned | large + small capture test |
| duplicate records appear after retries | non-idempotent retry behavior | use unique marker IDs and dedupe guard before retrying capture | forced retry test + dedupe check |
| parallel validation gives flaky outcomes | shared temp/session collisions across concurrent checks | serialize validation, use unique session IDs and marker IDs per run | two sequential runs both pass |

## Auth diagnostics (copy/paste)

```bash
CFG_PATH="${OPENCLAW_CONFIG:-$HOME/.openclaw/openclaw.json}"

# 1) Inspect current plugin config
python3 - <<'PY'
import json, os
cfg_path=os.environ.get('OPENCLAW_CONFIG', os.path.expanduser('~/.openclaw/openclaw.json'))
cfg=json.load(open(cfg_path))
print('config_path=', cfg_path)
print(cfg.get('plugins',{}).get('entries',{}).get('openbrain-native',{}))
PY

# 2) Probe endpoint reachability (replace URL if needed)
URL=$(python3 - <<'PY'
import json, os
cfg_path=os.environ.get('OPENCLAW_CONFIG', os.path.expanduser('~/.openclaw/openclaw.json'))
cfg=json.load(open(cfg_path))
print(cfg['plugins']['entries']['openbrain-native']['config']['url'])
PY
)

echo "Probing: $URL"
curl -sS -i -X POST "$URL" \
  -H 'content-type: application/json' \
  -H 'accept: application/json, text/event-stream' \
  --data '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"search_thoughts","arguments":{"query":"openbrain","limit":1}}}' | sed -n '1,30p'
```

Interpretation:
- `2xx`: transport/auth likely OK
- `401/403`: auth mismatch or expired token
- `404/5xx`: endpoint path/server issue

## Network/TLS diagnostics

```bash
# DNS + TCP + TLS quick probe
python3 - <<'PY'
import urllib.parse, json, os
cfg_path=os.environ.get('OPENCLAW_CONFIG', os.path.expanduser('~/.openclaw/openclaw.json'))
cfg=json.load(open(cfg_path))
url=cfg['plugins']['entries']['openbrain-native']['config']['url']
u=urllib.parse.urlparse(url)
print('config_path=', cfg_path)
print('host=',u.hostname,'port=',u.port or ('443' if u.scheme=='https' else '80'))
PY

# TLS handshake/HTTP response headers
curl -sS -I "$URL" | sed -n '1,20p'
```

If this fails before app-level response, fix network/proxy/cert path first.

## Gateway/plugin logs first (canonical)

```bash
openclaw gateway status
# user service environments
journalctl --user -u openclaw-gateway.service -n 200 --no-pager
# system service environments
sudo journalctl -u openclaw-gateway.service -n 200 --no-pager
```

Look first for:
- plugin load failures (`openbrain-native`, `registering tools`, stack traces)
- config parse/path errors
- upstream MCP HTTP/auth/timeout errors

## Bounded retry recipe for transient 429/5xx

Use bounded retries only for transient upstream failures:

```bash
for i in 1 2 3 4 5; do
  if bash scripts/query_memory.sh "openbrain" 1; then
    echo RETRY_OK
    break
  fi
  sleep $((i*i))
done
```

Do not use this for 401/403, policy denials, schema/argument errors, or config failures.

## Policy-denial diagnostic sequence

1. Confirm plugin/tool is visible:
```bash
openclaw plugins info openbrain-native --json
```
2. Confirm additive allow policy is present:
```bash
python3 - <<'PY'
import json, os
cfg_path=os.environ.get('OPENCLAW_CONFIG', os.path.expanduser('~/.openclaw/openclaw.json'))
cfg=json.load(open(cfg_path))
print(cfg.get('tools',{}).get('alsoAllow'))
print(cfg.get('agents',{}).get('list',[{}])[0].get('tools',{}).get('alsoAllow'))
PY
```
3. Run a fresh-session direct tool call. If denied before tool execution, it is policy; if it executes and fails, investigate plugin/backend.

## Fallback script failure notes

When using fallback scripts in `scripts/`:
- `openbrain_call.sh` can fail if endpoint is unreachable or returns malformed framing.
- `openbrain_capture.sh` defaults to best-effort; use `--strict` for guaranteed failure surfacing.
- failed capture logs: `reports/openbrain-capture-errors.log`

## Gateway restart looks noisy

Some environments return CLI SIGTERM while restart still succeeds.
Validate with:

```bash
openclaw status
openclaw plugins info openbrain-native --json
```

## Plugin version and rollback guardrail

If behavior regresses after upgrade:
1. reinstall prior known-good plugin package/tag
2. restart gateway
3. run re-validation bundle
4. only then resume normal operations
