# OpenBrain Native OpenClaw Extension Setup

This is a setup overview for new engineers. The canonical install/config source is `docs/install-local.md`.

## Audience

Engineers who need to install and run the plugin on an existing OpenClaw + OpenBrain environment.

## Steps

1. Follow `install-local.md` for installation/config.
2. Follow `validation-checklist.md` for end-to-end checks.
3. Use `troubleshooting.md` if checks fail.

## Required outcome

A fresh agent session can invoke:
- `openbrain_search`
- `openbrain_capture`
- `openbrain_list_recent`

without `TOOL_MISSING`.

## Notes

- Use profile-safe additive policy (`alsoAllow`) for plugin tools.
- Keep plugin trust pinned via `plugins.allow` and install records.
