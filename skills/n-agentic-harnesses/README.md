# N Agentic Harnesses

> Reusable skill pack for designing, auditing, and improving the harness layer around agentic products.

## What It Does

N Agentic Harnesses helps an AI client reason about the parts of an agentic system that usually get hand-waved: tool boundaries, permission policy, approval flow, workflow state, durability, context assembly, memory, evals, and operator visibility.

It is a routing skill, not a framework. It helps the client choose the right harness shape, inspect the right subsystem, and return a buildable plan or a findings-first review instead of vague "agent architecture" advice.

## Supported Clients

- Codex
- Claude Code
- Claude Desktop or other Anthropic-style skill systems
- Cursor or similar AI clients that can keep a skill file next to bundled references

## Prerequisites

- Working Open Brain setup if you want to capture resulting architecture notes or evaluation findings into memory ([guide](../../docs/01-getting-started.md))
- AI client that supports reusable skill files, project rules, or custom instructions
- Ability to keep the bundled `references/` directory next to the installed skill file

## Installation

1. Copy the entire [`n-agentic-harnesses`](./) folder into a location your AI client can access. Keep `references/`, `variants/`, and `agents/` next to the active `SKILL.md`.
2. For the default portable install, use the root [`SKILL.md`](./SKILL.md).
3. If you want the Codex-tuned variant, replace the contents of the root `SKILL.md` with [`variants/codex/SKILL.md`](./variants/codex/SKILL.md) and keep the rest of the folder unchanged.
4. If you want the Anthropic-oriented variant, do the same with [`variants/anthropic/SKILL.md`](./variants/anthropic/SKILL.md).
5. Reload the client and test it with a prompt like: `Design the harness for a solo-dev coding agent and tell me what primitives I should build first.`

For Claude Code, a common install path is:

```bash
mkdir -p ~/.claude/skills/n-agentic-harnesses
cp -R skills/n-agentic-harnesses/* ~/.claude/skills/n-agentic-harnesses/
```

## Trigger Conditions

- "Design an agentic harness for this product"
- "Audit my agent architecture"
- "Help me structure tool permissions and approvals"
- "Should this be single-agent or multi-agent?"
- "How should I handle workflow state, retries, and resumability?"
- "How do I know if this harness is actually good?"
- Any request where the real issue is stale context, brittle sessions, missing approval controls, weak evals, or poor operator visibility

## Expected Outcome

When installed and invoked correctly, the skill should produce:

- a clear harness mode: design, evaluation, or both
- the recommended product shape and subsystem boundaries
- a lean MVP boundary instead of scalability theater
- a phased implementation plan or findings-first audit
- explicit acceptance checks, regression checks, or evaluation criteria

## Troubleshooting

**Issue: The output sounds abstract and never gets buildable**
Solution: Make sure the request includes the product shape, the actions the agent takes, and the main constraint. This skill is strongest when it can turn real constraints into subsystem choices.

**Issue: The client gives a generic "use multi-agent" answer**
Solution: Keep the single-agent default posture intact. This skill is designed to push back on unnecessary orchestration unless the request includes a real coordination constraint.

**Issue: The skill cannot find its reference files**
Solution: Install the whole folder, not just one prompt file. The root `SKILL.md` and the client variants expect the bundled [`references/`](./references/) directory to remain adjacent.

## Notes for Other Clients

The root [`SKILL.md`](./SKILL.md) is the canonical portable version for OB1. The two client variants are adaptation layers:

- [`variants/codex/SKILL.md`](./variants/codex/SKILL.md) adds Codex-friendly discovery metadata and routing signals
- [`variants/anthropic/SKILL.md`](./variants/anthropic/SKILL.md) stays closer to the Anthropic-style prompt shape

The shared architectural guidance lives once in [`references/`](./references/). Keep that directory with the skill no matter which variant you activate.
