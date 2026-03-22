# Fix for plugin provenance warning

Observed warning:

`openbrain-native: loaded without install/load-path provenance; treat as untracked local code and pin trust via plugins.allow or install records`

## Resolution

1. Ensure plugin is installed via `openclaw plugins install` (not only copied manually).
2. Set explicit allowlist:

```json
{
  "plugins": {
    "allow": ["openbrain-native", "telegram"]
  }
}
```

3. Keep plugin entry configured in `plugins.entries.openbrain-native`.
4. Restart gateway.

## Notes

- This warning is informational hardening output.
- If plugin remains under `~/.openclaw/extensions` and not trust-pinned, warning can continue to appear.
- Use explicit trust pins for all non-bundled plugins.
