# Working with Claude Code on BigOleBrain

## Session workflow

1. **Read `CLAUDE.md`** — guard rails and repo conventions.
2. **Read the spec file** for the feature you're building: `docs/specs/<feature>.md`.
3. **Do NOT read `docs/ROADMAP.md`** during a build session — it's a planning index, not a build doc.
4. **Each session = one spec file = one deliverable.** Stop when it works.
5. **Verify before ending:** run the test prompts listed in the spec's "Done when" section.

## How to start a session

```bash
claude "Build docs/specs/1.1a-uuid-exposure.md. Follow guard rails in CLAUDE.md."
```

For dashboard features that build on a previous session:

```bash
claude "Build docs/specs/1.2b-today-view.md. The scaffold from 1.2a is already in dashboards/command-center/. Follow guard rails in CLAUDE.md."
```

## Rules of thumb

- **One spec per session.** If a spec feels too big, split it before starting.
- **Don't reference other spec files** unless the current spec says "depends on X" — and even then, only read that spec if you need to understand an interface, not to build it.
- **Existing patterns beat new patterns.** Before creating a new utility or component, check if the existing codebase already has one.
- **Commit at the end.** Each session should produce one atomic, deployable commit.

## If you hit a blocker

- Missing dependency from another feature → stop, note it, move on.
- Ambiguous decision → pick the simpler option and leave a `// TODO:` comment.
- Spec says "BLOCKED" → skip it, pick the next unblocked spec.

## Spec file format

Every spec follows this structure:

```
# Feature name
## Done when (acceptance criteria — read these first)
## Context (what this feature is and why)
## What to build (the actual implementation details)
## Dependencies (what must exist before this can be built)
```

Claude Code should read "Done when" first to understand the target, then work through "What to build."
