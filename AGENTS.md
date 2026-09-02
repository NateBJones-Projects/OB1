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

## Tracker and repository hygiene

Standing practice (Jonathan, 2026-08-30; hardened 2026-09-02): the ticket board and the branch list must describe reality, and no issue lives forever as open.

- Every issue you open has an assignee and a due date no more than 30 days out. The due date is the review-by date, not a delivery promise.
- An issue with no activity (state change, informative comment, or linked PR) for 14 days gets a triage comment from whoever opened or last touched it: still intended, what blocks it, new review-by date. At 30 days the opener resolves it: `Done` with one-line evidence, `Canceled` naming the superseding decision, or reassigned with a comment naming the new owner and why. "Parked" is not a state.
- At the end of every substantial working session, and always before marking a carrier issue `Done`, audit the project's open Linear issues against what actually shipped. Close as `Done` with the merged pull request or artifact named; cancel with the decision named; when a parent's children split between delivered and superseded, say which went where in one parent comment.
- An issue that is merely old is not stale; an issue that no longer describes work anyone intends is. Issues assigned to Jonathan: agents move them to `Done` only with shipped evidence and never cancel them — flag them instead. Issues in state `Standing` are versioned standing instructions: exempt from the clock, re-verified when their version changes. When ownership of a lane is unclear, leave the lane and flag it to its owner.
- Log every Linear create, update, comment, or close you make as one row in the fleet `linear_ticket_log` table.
- Delete merged branches, local and remote, after every merge (`git push origin --delete BRANCH`, then `git remote prune origin`). Close superseded pull requests with a comment saying what replaced them.
- Keep large binaries out of git history: recordings, exports, and other heavy artifacts go to Agent Drop (or another owned store) with the link committed in their place.
