# Codex Translation Notes

## Table Of Contents

- What this file is for
- Baseline rule
- Likely Codex-specific additions
- What should stay the same
- Migration approach

## What This File Is For

Read this only when adapting the Anthropic-first skill into a Codex-oriented variant.

## Baseline Rule

Keep the Anthropic-style skill as the source version.

Treat any Codex-oriented version as an adaptation layer, not the canonical design.

## Likely Codex-Specific Additions

Possible additions in a Codex version:

- `agents/openai.yaml` metadata
- path or prompt trigger metadata
- validation scripts
- repo- or plugin-specific routing hints
- additional instructions for developer tools and MCP usage

Those additions should not rewrite the core skill logic. They should only help Codex discover and render the same skill more effectively.

## What Should Stay The Same

Preserve:

- the skill slug and identity
- progressive disclosure design
- router behavior in `SKILL.md`
- reference file boundaries
- design plus evaluation as equal first-class jobs
- solo-dev default posture

## Migration Approach

When building the Codex version later:

1. copy the Anthropic-first directory
2. add Codex metadata and only the minimum extra files needed
3. validate that the router still points to the same reference files
4. avoid turning the skill into a Codex-only internal document

If the Codex version starts changing the actual architectural guidance, you are no longer translating it. You are forking it.
