# Icons

Manifest icons are intentionally not bundled in this contribution. Chrome will show the default puzzle-piece glyph until a maintainer (or you) adds branded icons here.

To add icons later, drop these files in this folder and register them in `manifest.json` under `icons` and `action.default_icon`:

- `icon16.png`
- `icon32.png`
- `icon48.png`
- `icon128.png`

All four sizes must be square PNGs on a transparent background. Keep each file well under 500KB to stay within the OB1 binary-blob policy.
