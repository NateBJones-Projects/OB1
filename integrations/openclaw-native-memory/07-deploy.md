# Deployment Runbook

This runbook covers deploying the plugin to a target OpenClaw node.

## Assumptions

- OpenBrain backend is already operational.
- You can run `openclaw` CLI commands on the target node.

Tested minimum versions:

| Component | Version floor |
| --- | --- |
| OpenClaw | `>= 0.2.0` |
| Node.js | `>= 20.0.0` |
| npm | `>= 10.0.0` |

## Environments

Use the same procedure for dev/stage/prod with different endpoint values.

## Remote deployment workflow (operator on laptop, target on node)

1. Build package artifact from tagged source.
2. Copy artifact to target node.
3. Install artifact on target with `openclaw plugins install <artifact> --pin`.
4. Apply config + allowlists on target.
5. Restart gateway on target.
6. Run validation checklist on target (or against target session).

Recommended conventions:
- dev: test endpoint + relaxed cadence
- stage: mirror prod config, no experimental toggles
- prod: pinned release tag + explicit change window

## Concrete remote deploy example (scp + ssh)

Operator machine builds artifact, copies to target, then installs on target:

```bash
# operator machine
cd extension
npm pack --silent
PKG=$(ls -t openclaw-openbrain-native-*.tgz | head -n1)
sha256sum "$PKG"
scp "$PKG" ops@<target-host>:/tmp/

# run install/config on target over ssh
ssh ops@<target-host> <<'SH'
set -euo pipefail
PKG_PATH=$(ls -t /tmp/openclaw-openbrain-native-*.tgz | head -n1)
openclaw plugins install "$PKG_PATH" --pin
openclaw plugins enable openbrain-native
openclaw config set "plugins.entries['openbrain-native'].config.url" '"https://<openbrain-endpoint>"' --strict-json
openclaw config set "plugins.entries['openbrain-native'].config.envelopeMode" "true" --strict-json

# merge-safe plugins.allow update
PLUGINS_ALLOW_JSON=$(python3 - <<'PY'
import json, os
cfg_path = os.environ.get('OPENCLAW_CONFIG', os.path.join(os.path.expanduser('~'), '.openclaw', 'openclaw.json'))
try:
    with open(cfg_path, 'r', encoding='utf-8') as f:
        cfg = json.load(f)
except FileNotFoundError:
    cfg = {}
allow = cfg.get('plugins', {}).get('allow')
if not isinstance(allow, list):
    allow = []
if 'openbrain-native' not in allow:
    allow.append('openbrain-native')
print(json.dumps(allow, separators=(',', ':')))
PY
)
openclaw config set "plugins.allow" "$PLUGINS_ALLOW_JSON" --strict-json

# merge-safe tools.alsoAllow update
TOOLS_ALSO_ALLOW_JSON=$(python3 - <<'PY'
import json, os
cfg_path = os.environ.get('OPENCLAW_CONFIG', os.path.join(os.path.expanduser('~'), '.openclaw', 'openclaw.json'))
try:
    with open(cfg_path, 'r', encoding='utf-8') as f:
        cfg = json.load(f)
except FileNotFoundError:
    cfg = {}
required=['openbrain-native','search_thoughts','capture_thought','list_thoughts']
also=cfg.get('tools',{}).get('alsoAllow')
if not isinstance(also,list):
    also=[]
for item in required:
    if item not in also:
        also.append(item)
print(json.dumps(also, separators=(',', ':')))
PY
)
openclaw config set "tools.alsoAllow" "$TOOLS_ALSO_ALLOW_JSON" --strict-json

openclaw config validate
openclaw gateway restart
SH
```

## Deploy from release tag

```bash
# Example: checkout release in this repo
# git checkout vX.Y.Z

cd extension
npm pack --silent

# install package into target OpenClaw runtime
openclaw plugins install ./openclaw-openbrain-native-<version>.tgz --pin
openclaw plugins enable openbrain-native
```

## Configure

Run from target node with OpenClaw config access.

```bash
openclaw config set "plugins.entries['openbrain-native'].config.url" '"https://<openbrain-endpoint>"' --strict-json
openclaw config set "plugins.entries['openbrain-native'].config.envelopeMode" "true" --strict-json
openclaw config set "tools.alsoAllow" '["openbrain-native","search_thoughts","capture_thought","list_thoughts"]' --strict-json
openclaw config validate
```

Auth mode (choose one):
- URL key mode: keep key in URL, do not set apiKey
- bearer mode: URL without key + set `plugins.entries['openbrain-native'].config.apiKey`

Credential hygiene during deploy:
- Avoid embedding secrets directly in commands that will be saved to shell history.
- Prefer env vars or your secret manager, then inject at runtime.
- For interactive terminals, use `read -s` when entering tokens.
- Redact endpoint keys/tokens from deploy logs before sharing.
- Rotate any secret that appears in logs, terminals, or screenshots.

Merge-safe trusted plugin allowlist update (executable):

```bash
PLUGINS_ALLOW_JSON=$(python3 - <<'PY'
import json, os
cfg_path = os.environ.get('OPENCLAW_CONFIG', os.path.join(os.path.expanduser('~'), '.openclaw', 'openclaw.json'))
try:
    with open(cfg_path, 'r', encoding='utf-8') as f:
        cfg = json.load(f)
except FileNotFoundError:
    cfg = {}
allow = cfg.get('plugins', {}).get('allow')
if not isinstance(allow, list):
    allow = []
if 'openbrain-native' not in allow:
    allow.append('openbrain-native')
print(json.dumps(allow, separators=(',', ':')))
PY
)
openclaw config set "plugins.allow" "$PLUGINS_ALLOW_JSON" --strict-json
```

## Restart

```bash
openclaw gateway restart
# if wrapper behaves oddly in your env:
# systemctl --user restart openclaw-gateway.service
```

## Post-deploy verification

Run `04-validation-checklist.md` in full.

## Rollback

1. Reinstall previous package tag/version
2. Re-enable plugin config from previous known-good snapshot
3. Restart gateway
4. Re-run validation checklist

## Upgrade policy

- Always tag releases
- Deploy by tag, not floating branch
- Validate in stage before prod
