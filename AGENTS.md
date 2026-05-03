# OB1 Agent Instructions

## Required Step: Update Linear

- For feature work tied to a Linear issue, update Linear at the start of the work, at meaningful checkpoints, and before handing back to the user.
- Use the parent issue as the living implementation log and keep child issues aligned with the files and behavior being changed.
- For the OB1 Agent Memory / OpenClaw launch work, the parent issue is `NAT-833`. Record architecture notes, implementation milestones, blockers, and verification results there.
- Do not wait until the end to document decisions. If a decision changes schema, API contract, trust policy, user-facing workflow, or publishing path, capture it in Linear while it is still fresh.

## Agent Memory Product Guardrails

- Keep `OB1 Agent Memory` runtime-neutral. OpenClaw is the flagship launch runtime, not the product boundary.
- Treat inferred or generated memory as evidence by default. Instruction-grade memory requires human confirmation or trusted import.
- Avoid raw transcript, model reasoning trace, secret, and large-code-block storage by default.
- Prefer diagram-first documentation for this work: diagram, short explanation, copy-paste setup, then deeper reference.
