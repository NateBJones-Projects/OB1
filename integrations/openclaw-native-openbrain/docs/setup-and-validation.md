# Setup and Validation

Use [`docs/install-local.md`](./install-local.md) as the canonical install and config source.

This page is intentionally brief to avoid config drift.

## Quick flow

1. Follow `install-local.md` for:
   - package build/install
   - plugin config
   - merge-safe `plugins.allow` update
   - additive tool policy via `tools.alsoAllow`
   - gateway restart
2. Then run the full checklist in [`docs/validation-checklist.md`](./validation-checklist.md).

## Notes

- Validate in a **fresh session** after restart.
- If tools are missing, re-check `tools.alsoAllow` and plugin load state.
- Avoid hard per-agent `tools.allow` for plugin tools when profiles are active; prefer additive `alsoAllow`.
