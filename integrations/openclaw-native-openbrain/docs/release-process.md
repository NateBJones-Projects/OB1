# Release Process

## 1) Update version + changelog

- bump `extension/package.json` version
- update `CHANGELOG.md`

## 2) Build package

```bash
cd extension
npm pack --silent
```

## 3) Mandatory pre-release gates

Preflight checklist before tagging:
- `git status` clean
- on intended release branch
- `gh auth status` OK (for release publishing)
- package version + changelog updated
- rollback artifact/version identified

Before tagging, run and record:

```bash
# from workspace root containing release-qa-gates skill
skills/release-qa-gates/scripts/run_release_gates.sh /abs/path/to/this/repo
```

Required outcome:
- no `FAIL` gates
- if `PASS WITH GAPS`, document owner + due date per gap

Release evidence bundle (required):
- latest gate summary path (`reports/release-gates/<stamp>/SUMMARY.md`)
- plugin info artifact (`openclaw plugins info openbrain-native --json` output)
- runtime marker validation evidence (`TOOL_CHECK_OK`, `CAPTURE_CHECK_OK`, `RECALL_CHECK_OK`)
- packaged artifact name + checksum (`sha256sum extension/openclaw-openbrain-native-*.tgz`)
- rollback artifact/version reference

## 4) Commit + tag

```bash
git add .
git commit -m "release: vX.Y.Z"
git tag -a vX.Y.Z -m "vX.Y.Z"
git push origin main --tags
```

## 5) GitHub release

```bash
gh release create vX.Y.Z --title "vX.Y.Z" --notes-file CHANGELOG.md
```

Optionally attach the tgz asset:

```bash
gh release upload vX.Y.Z extension/openclaw-openbrain-native-<version>.tgz
```

## 6) Rollback drill (recommended)

Immediately after release, verify rollback path once in stage:

```bash
# reinstall prior tag/package
openclaw plugins install ./openclaw-openbrain-native-<previous-version>.tgz --pin
openclaw plugins enable openbrain-native
openclaw gateway restart || systemctl --user restart openclaw-gateway.service
```

Then run the validation checklist to confirm green state.
