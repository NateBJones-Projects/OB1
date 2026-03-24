# Troubleshooting

Start here if the integration does not work.

## Fast decision flow

- plugin not loading? fix OpenClaw install/config first
- 401/403? fix auth mode first
- tools missing? fix allowlists and plugin load state first
- ids missing from search/list? stop and fix the MCP server first
- delete by id missing? stop and fix the MCP server first

## Quick fixes first

### Plugin not loading

Check plugin status:

```bash
openclaw plugins info openbrain-native --json
```

If it is not loaded:
- reinstall the package
- confirm `plugins.allow` contains `openbrain-native`
- restart the gateway

### 401 or 403 errors

Check your auth mode.

You should be using one of these:
- key in URL
- bearer token in `config.apiKey`

Not both.

### Tool missing in chat

Check allowlists:

```bash
python3 - <<'PY'
import json, os
cfg=json.load(open(os.path.expanduser('~/.openclaw/openclaw.json')))
print(cfg.get('tools',{}).get('alsoAllow'))
PY
```

You should see:
- `search_thoughts`
- `capture_thought`
- `list_thoughts`
- `thought_stats`
- `delete_thought`

### Search works but no ids show up

That is an MCP server problem, not an OpenClaw install problem.

Run the validation commands in [`03-MCP-SERVER.md`](./03-MCP-SERVER.md).

### Delete by id fails

Run tool list against the MCP server and confirm `delete_thought` exists.

## Practical validation bundle

Run these in order:

```bash
openclaw config validate
openclaw plugins info openbrain-native --json
openclaw agent --session-id native-recheck-search --message "If tool search_thoughts is available, call it with query 'OpenBrain' limit 1 and reply exactly TOOL_OK. Otherwise reply exactly TOOL_MISSING." --json
bash scripts/smoke-test.sh
```

## Deep diagnostics

## Compatibility matrix (minimum tested)

| Component | Minimum |
|---|---|
| OpenClaw | `>= 0.2.0` |
| Node.js | `>= 20.0.0` |
| npm | `>= 10.0.0` |
| Plugin | current repo release tag |

If versions are below floor or mixed unexpectedly after upgrade, pin or roll back to a known-good combination before deeper debugging.

## Failure matrix

| Symptom | Probable cause | Fix | Re-validate |
|---|---|---|---|
| `TOOL_MISSING` | profile policy filtered optional plugin tool | use `tools.alsoAllow` and `agents[].tools.alsoAllow` for openbrain tools | run the validation bundle |
| `401/403` from MCP | wrong key/token, expired credential, wrong auth mode | verify URL key vs `config.apiKey`; rotate or update token | `search_thoughts` check + validation bundle |
| timeout / DNS / TLS errors | endpoint unreachable, DNS issue, cert chain/proxy issue | verify endpoint reachability and cert/proxy path | curl check + validation bundle |
| malformed JSON/SSE parse | endpoint response framing mismatch or gateway/proxy altering stream | verify `accept` header and raw response body framing | direct curl probe + validation bundle |
| capture appears successful but not persisted | backend insert/classification failed after a partial success path | inspect MCP response and rerun a minimal capture + search validation | strict capture + recall marker |
| wrong tool names called by plugin | MCP server tool names differ from defaults | set `searchToolName` / `captureToolName` / `listToolName` in plugin config | `search_thoughts` and `capture_thought` tests |
| intermittent 429/5xx | backend rate limiting or transient upstream failure | add retry/backoff and reduce burst calls | rerun after cooldown |
| plugin not loaded / tools absent | plugin disabled, install failed, load error at startup | reinstall or enable plugin and confirm `openclaw plugins info openbrain-native --json` shows `status: loaded` | run the validation bundle |
| gateway unhealthy or stale runtime | gateway not running, partial restart, stale process | check `openclaw status`, restart gateway/service, confirm active pid/state | run the validation bundle |
| stale session still shows old behavior | session created before policy/plugin changes | use a fresh `--session-id` for all checks and close or restart stale sessions | rerun search + capture checks in a fresh session |
| config path/schema mistake | wrong JSON path or strict-json quoting issue left ineffective config | print effective config values and reapply with the exact path under `plugins.entries['openbrain-native'].config.*` | `openclaw config validate` + validation bundle |
| wrong MCP endpoint path/version | URL host reachable but route/protocol contract wrong | verify exact MCP endpoint path and minimal JSON-RPC probe request | direct probe + `search_thoughts` check |
| retrieval quality drift | capture succeeds but search relevance or consistency is poor | tune query terms/limits, validate with known marker records, review backend index health | marker recall + targeted semantic query checks |
| plugin API incompatibility after OpenClaw/plugin upgrade | runtime/plugin contract mismatch across versions | pin compatible plugin/OpenClaw versions, or roll back to last known-good pair | version check + full validation bundle |
| config changes seem ignored | editing wrong active config file/context (`OPENCLAW_CONFIG`, different user/service) | print active config path, apply changes to the active file, restart gateway | config validate + plugin info + fresh session tool check |
| tool listed but call denied by policy/security layer | execution policy or sandbox restrictions, not tool registration | align policy/security settings to allow intended calls with least privilege | fresh session direct tool-call check + validation bundle |
| capture OK but immediate search miss | backend indexing/eventual consistency delay | add a short bounded retry window before declaring failure | timed recall retries + semantic/exact checks |
| flaky checks right after restart | gateway/plugin initialization race | wait for readiness before validation and avoid parallel validation spam | status healthy + rerun once |
| tool call fails with schema/argument error | invalid args passed to tool/MCP endpoint | validate payload shape and required fields, then retry with minimal known-good payload | direct `search_thoughts` with minimal args + validation bundle |
| config read/write fails under service | config file ownership or permissions mismatch for active service user | verify active config path + file owner/perm; align with service user and retry | config validate + plugin info + fresh tool check |
| package install fails or behaves unexpectedly | wrong, stale, or corrupt tgz artifact | verify exact package filename/version and checksum before install; rebuild package if needed | reinstall package + plugin info + validation bundle |
| `openclaw` / `python3` / `curl` / node/npm missing | PATH/dependency issue on host | verify binaries with `command -v`, install missing deps, ensure service/user PATH alignment | rerun failed command + validation bundle |
| endpoint works in one shell but fails in another | proxy env poisoning (`HTTP_PROXY`/`HTTPS_PROXY`/`NO_PROXY`) | print or unset proxy env for the validation shell, set proper NO_PROXY for MCP host | direct curl probe + validation bundle |
| intermittent 401/403 with correct key | host clock skew/token validity window mismatch | verify NTP sync and UTC time, sync clock, then retry | auth probe + validation bundle |
| small capture works, large capture fails | upstream payload/body size limit (413/truncation) | split or chunk captures, or reduce body size; adjust upstream limits if you own them | large + small capture test |
| duplicate records appear after retries | non-idempotent retry behavior | use unique marker IDs and a dedupe guard before retrying capture | forced retry test + dedupe check |
| parallel validation gives flaky outcomes | shared temp/session collisions across concurrent checks | serialize validation, use unique session IDs and marker IDs per run | two sequential runs both pass |

## Auth diagnostics

```bash
CFG_PATH="${OPENCLAW_CONFIG:-$HOME/.openclaw/openclaw.json}"

python3 - <<'PY'
import json, os
cfg_path=os.environ.get('OPENCLAW_CONFIG', os.path.expanduser('~/.openclaw/openclaw.json'))
cfg=json.load(open(cfg_path))
print('config_path=', cfg_path)
print(cfg.get('plugins',{}).get('entries',{}).get('openbrain-native',{}))
PY

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
- `404/5xx`: endpoint path or server issue

## Network/TLS diagnostics

```bash
python3 - <<'PY'
import urllib.parse, json, os
cfg_path=os.environ.get('OPENCLAW_CONFIG', os.path.expanduser('~/.openclaw/openclaw.json'))
cfg=json.load(open(cfg_path))
url=cfg['plugins']['entries']['openbrain-native']['config']['url']
u=urllib.parse.urlparse(url)
print('config_path=', cfg_path)
print('host=',u.hostname,'port=',u.port or ('443' if u.scheme=='https' else '80'))
PY

curl -sS -I "$URL" | sed -n '1,20p'
```

If this fails before app-level response, fix network, proxy, or cert path first.

## Gateway/plugin logs

```bash
openclaw gateway status
journalctl --user -u openclaw-gateway.service -n 200 --no-pager
sudo journalctl -u openclaw-gateway.service -n 200 --no-pager
```

Look first for:
- plugin load failures
- config parse/path errors
- upstream MCP HTTP/auth/timeout errors

## Bounded retry recipe for transient 429/5xx

Use bounded retries only for transient upstream failures:

```bash
for i in 1 2 3 4 5; do
  if openclaw agent --session-id native-retry-check --message "Use tool search_thoughts with query openbrain and limit 1. Reply exactly RETRY_OK if it works." --json | grep -q RETRY_OK; then
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

## Gateway restart looks noisy

Some environments return CLI SIGTERM while restart still succeeds.
Validate with:

```bash
openclaw status
openclaw plugins info openbrain-native --json
```

## Plugin version and rollback guardrail

If behavior regresses after upgrade:
1. reinstall prior known-good plugin package or tag
2. restart gateway
3. run the validation bundle again
4. only then resume normal operations

## When to stop debugging here

If the MCP server does not return the right tool list or structured output shape, stop changing OpenClaw config and fix the server first.
