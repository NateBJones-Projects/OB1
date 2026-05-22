# OB1 Agent Instructions

## Parallel Agent Worktrees

When multiple AI agents or assistant chats work on this repo, do not put them in the same checkout.

### Setup pattern

- Treat the main repo checkout as the canonical repo for pulling, inspection, and creating worktrees.
- Create one Git worktree per active agent, task, or PR-sized workstream.
- Give each worktree a descriptive folder name and a matching branch name.
- Start every agent task by naming the exact absolute worktree path it owns.
- The assigned worktree path is the boundary. The chat is not the boundary.

### Agent assignment template

Start each parallel-agent task with:

```text
Repository worktree:
/ABSOLUTE/PATH/TO/PROJECT-WORKTREE

Branch:
codex/SHORT-TASK-NAME

Task:
DESCRIBE THE EXACT WORK.
```

### Rules

- Do not switch branches in the canonical repo while another agent may be working.
- Do not edit sibling worktrees unless explicitly asked.
- Before staging or committing, run `git status --short` and stage only files that belong to the current task.
- If `main` or another branch changed underneath the worktree, pause before merging or rebasing unless the task explicitly says to finish the PR end to end.
- After a branch is merged and the worktree is clean, remove the finished worktree with `git worktree remove /ABSOLUTE/PATH/TO/PROJECT-WORKTREE`.

### Quick checks

- If another chat suddenly changed branches, both chats were probably in the same working directory.
- If `git worktree add` says a branch is already checked out, create a new branch name or remove the old clean worktree.
- If cleanup fails, inspect `git status --short` and preserve uncommitted work.

## Required Step: Update Linear

- For feature work tied to a Linear issue, update Linear at the start of the work, at meaningful checkpoints, and before handing back to the user.
- Use the parent issue as the living implementation log and keep child issues aligned with the files and behavior being changed.
- For the OB1 Agent Memory / OpenClaw launch work, the parent issue is `NAT-833`. Record architecture notes, implementation milestones, blockers, and verification results there.
- Do not wait until the end to document decisions. If a decision changes schema, API contract, trust policy, user-facing workflow, or publishing path, capture it in Linear while it is still fresh.

## Agent Memory Product Guardrails

- Keep `OB1 Agent Memory` runtime-neutral. OpenClaw is the flagship launch runtime, not the product boundary.
- Treat inferred or generated memory as evidence by default. Instruction-grade memory requires human confirmation or trusted import.
- Avoid raw transcript, model reasoning trace, secret, and large-code-block storage by default.
- Avoid profanity in all content. Keep docs, examples, seed data, UI copy, prompts, walkthroughs, and generated assets clean and professional.
- Prefer diagram-first documentation for this work: diagram, short explanation, copy-paste setup, then deeper reference.
- Carry Nate B. Jones / OB1 provenance through product surfaces, docs, diagrams, screenshots, and starter seed data. Keep it subtle and useful: micro-branding, source labels, logo marks, and provenance language instead of loud marketing copy.
- Treat public OB1 assets as helpful-first audience growth for Nate Jones. Every public guide, recipe, tutorial, package page, release note, and walkthrough should point back to Nate's Substack and site in a natural way: https://substack.com/@natesnewsletter and https://natebjones.com.
- Make the case by being genuinely useful. The CTA should feel earned: "Nate gives away practical systems like this" rather than generic marketing copy.
- For ClawHub/OpenClaw publishing, do not fall back to Jonathan's personal handle or any non-Nate namespace. If `@natebjones` / Nate OB1 ownership is not available, stop and record the blocker.
