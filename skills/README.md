# Skills

Reusable AI client skills and prompt packs for Open Brain workflows. These are the canonical home for reusable agent behavior: install the file, reload your client, and reuse the behavior across projects or other contributions.

| Skill | What It Does | Contributor |
| ----- | ------------ | ----------- |
| [Auto-Capture Skill Pack](auto-capture/) | Captures ACT NOW items and session summaries to Open Brain when a session ends | [@jaredirish](https://github.com/jaredirish) |
| [Panning for Gold Skill Pack](panning-for-gold/) | Turns brain dumps and transcripts into evaluated idea inventories | [@jaredirish](https://github.com/jaredirish) |
| [Claudeception Skill Pack](claudeception/) | Extracts reusable lessons from work sessions into new skills | [@jaredirish](https://github.com/jaredirish) |

## How Skills Differ From Recipes

- **Skills** are installable behaviors: prompt packs, system prompts, reusable operating procedures, and triggerable workflows.
- **Recipes** are fuller builds: setup guides, schema changes, automation wiring, and end-to-end implementations.
- **Recipes can depend on skills** via `requires_skills` when they build on reusable prompt behavior that lives here.
- If you just want the reusable agent behavior, start in `skills/`.
- If you need the full surrounding workflow, data model, or automation, start in `recipes/`.

## Contributing

Skills are open for community contributions. Keep them plain-text and reviewable: submit `SKILL.md`, `*.skill.md`, or `*-skill.md` files, not zipped exports. See [CONTRIBUTING.md](../CONTRIBUTING.md) for the full requirements.
