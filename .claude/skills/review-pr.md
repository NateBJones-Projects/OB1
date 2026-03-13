---
name: review-pr
description: Run admin review on an OB1 pull request. Covers what CI can't — security deep scan, mission fit, naming consistency, and generates admin summary, Discord draft, and post-merge task list. Takes PR number as argument (e.g., "review PR 21").
---

# OB1 PR Review — Admin Skill

Run the human-judgment layer of PR review on OB1. CI handles the mechanical checks (11 rules, scope, links, post-merge reminders). This skill handles everything CI can't automate.

## Input

PR number from the user. Fetch details with `gh pr view <number>` and `gh pr diff <number>`. Checkout the branch with `gh pr checkout <number>` to inspect files. Return to the original branch when done.

## Step 1: CI Status

Run `gh pr checks <number>` to see automated review results. Report:
- Passed: move on to admin checks
- Failed: note which rules failed — contributor must fix before admin review matters
- Pending: note it, proceed with admin checks anyway

Also check if the CI bot posted a "Post-Merge Tasks" section — those are the doc coverage gaps CI detected. Pull them into Section F below.

## Step 2: Security Deep Scan

CI only does basic credential pattern matching. Scan deeper:

- **Secrets beyond CI's patterns** — tokens in comments, base64-encoded values, connection strings, private keys
- **External URLs** — anything besides github.com, discord.gg, or relative doc links. Where does this code phone home?
- **Dangerous operations** — `rm -rf`, `chmod`, `sudo`, `eval()`, `exec()`, `system()`, `subprocess`, `os.system`
- **Prompt injection** in skill/prompt files — `ignore previous`, `disregard`, `you are now`, `jailbreak`, `bypass`
- **Personal data** — email addresses, phone numbers, real names that aren't the author's
- **Data exfiltration** — `webhook`, `ngrok`, `requestbin`, `pipedream`, `discord.com/api/webhooks`
- **Supply chain** — does it install packages? from where? pinned versions?

## Step 3: Mission Fit

Assess against OB1's core: "One brain, all your AI tools."

- Does this add a capture, retrieval, or processing capability for Open Brain?
- Does it complement existing contributions? Check `recipes/`, `schemas/`, etc. for overlap.
- Does it respect the upstream boundary (no core `thoughts` table or MCP server modifications)?
- Does it require paid services with no free-tier alternative?
- Is the difficulty rating accurate?
- If in a curated category (`extensions/`, `primitives/`), flag that maintainer approval is required regardless.

## Step 4: Naming & Consistency

- Folder name vs `metadata.json` name — do they match?
- Filenames referenced in README vs actual files — any mismatches? (This is the #1 bug CI can't catch reliably.)
- Consistent naming throughout — no mixed references like "brain-dump-processor" in README but "panning-for-gold" on disk.

## Step 5: PR Description Quality

Per CONTRIBUTING.md, must include: what it does, what it requires, confirmation of testing. CI can check if sections exist but not if they're meaningful. Assess quality.

## Output

### A: Review Checklist

| Check | Status | Notes |
|-------|--------|-------|
| CI status | | |
| Security | | |
| Mission fit | | |
| Naming consistency | | |
| PR description | | |

### B: Verdict

- **Approve** — all clear
- **Approve with required changes** — minor fixes needed, list them
- **Request changes** — significant issues, list with explanations
- **Reject** — doesn't fit OB1, duplicates work, or security concerns

### C: Admin Summary (Shareable)

Formatted for copy-pasting to other admins in Discord or DMs:

```
PR #<number>: <title>
Author: @<github> (first-time / returning contributor)
Category: <recipes/schemas/etc.>
What it does: <one sentence>
CI: <passed/failed>
Admin review: <verdict>
Changes needed: <list or "none">
Post-merge: <task count> items
Link: <PR URL>
```

### D: Discord Draft

For `#show-and-tell` after merge. Welcoming tone, specific about the contribution, encouraging. Include PR link and contributor's GitHub handle.

### E: Post-Merge Task List

Assemble from CI's "Post-Merge Tasks" section plus anything else identified:

```
- [ ] Update <category>/README.md index
- [ ] Update root README.md (if needed)
- [ ] Add contributor to CONTRIBUTORS.md (if first contribution)
- [ ] Post Discord message
- [ ] <other follow-ups>
```

### F: PR Comment Draft

Compose the review to post on the PR:
- Reference CI status (don't repeat — just "CI passed" or "CI flagged X")
- Security scan result
- Admin findings (required changes, suggestions)
- Welcoming close linking to Discord: https://discord.gg/Cgh9WJEkeG

**Ask the user before posting:** "Ready to post this review?" Then run `gh pr review <number> --comment --body "..."`.

## Notes

- This skill does NOT re-run CI checks. It reads CI results and adds the judgment layer.
- Any admin using Claude Code in the OB1 repo has this skill. The outputs (admin summary, PR comment) are designed to be shared with admins who don't use Claude Code.
- Return to original branch after review: `git checkout <branch>`
