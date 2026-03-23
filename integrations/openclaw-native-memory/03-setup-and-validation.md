# Setup and Validation

Use [`01-install-local.md`](./01-install-local.md) as the canonical install and config source.

This page is intentionally brief to avoid config drift.

## Quick flow

1. Follow `install-local.md` for:
   - package build/install
   - plugin config
   - merge-safe `plugins.allow` update
   - additive tool policy via `tools.alsoAllow`
   - gateway restart
2. Then run the full checklist in [`04-validation-checklist.md`](./04-validation-checklist.md).

## Notes

- Validate in a **fresh session** after restart.
- This plugin is intended to load as `kind: "memory"`, not just a generic tool plugin.
- If tools are missing, re-check `tools.alsoAllow`, memory slot selection, and plugin load state.
- Avoid hard per-agent `tools.allow` for plugin tools when profiles are active; prefer additive `alsoAllow`.
