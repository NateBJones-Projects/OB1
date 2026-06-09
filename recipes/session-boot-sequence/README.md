# Session Boot Sequence with Priority-Based Loading

> Configure your AI agent to load the right context at the right time — not everything at once, not nothing at all.

## What It Does

Sets up a priority-based memory loading system so your AI agent boots each session with the right context automatically. P1 rules load every time. P2 reference loads when relevant. P3 runbooks load before touching specific systems. P4 integrations load only when needed. Your AI starts every session like an operating system, not a blank slate.

## Why This Matters

AI agents start every session with amnesia. You re-explain your preferences, re-state your rules, re-describe your project. Flat notes files don't solve this because the agent doesn't know what to read first, what's critical vs. reference, or when to load what. Priority loading gives your agent a boot sequence — it knows what to load, when, and why.

## Prerequisites

- Working Open Brain setup ([guide](../../docs/01-getting-started.md))
- An AI agent that reads instructions at session start (Claude Code, Cursor, Claude Desktop with custom connectors, or similar)
- Your memories already organized in Open Brain (this recipe structures how they load, not what they contain)

## The Priority System

| Priority | Name | When it loads | What goes here |
|----------|------|---------------|----------------|
| P1 | Always | Every session, no exceptions | Rules, guardrails, gotchas, communication preferences |
| P2 | Reference | When working on related systems | Tech stack, architecture, key decisions, project context |
| P3 | Runbooks | Before touching specific systems | How-to guides, specs, deployment procedures, runbooks |
| P4 | On-demand | Only when the topic comes up | Third-party setup docs, integration details, vendor configs |

## Steps

![Step 1](https://img.shields.io/badge/Step_1-Tag_Your_Memories_by_Priority-1E88E5?style=for-the-badge)

Tag each existing memory with a priority level using the `tags` field. Use `p1`, `p2`, `p3`, `p4` as tag values.

For each memory in your Open Brain, ask: "Does my AI need to know this every session?" If yes, it's P1. If it's project context, P2. If it's a procedure, P3. If it's reference material, P4.

✅ **Done when:** Every memory has a priority tag (`p1` through `p4`).

![Step 2](https://img.shields.io/badge/Step_2-Create_the_Boot_Sequence_Instruction-1E88E5?style=for-the-badge)

Add the boot sequence to your agent's instruction file (CLAUDE.md, cursor rules, or equivalent):

```markdown
## Session Boot Sequence

At the start of every session, follow this sequence:

1. **Load P1 rules** — Query memories tagged `p1`. These are non-negotiable. Load them all.
2. **Load recent context** — Query the 5 most recent memories (any priority). This is your session checkpoint.
3. **Read the table of contents** — Query all memory titles (not content). Know what exists without loading everything.
4. **Ask what we're working on** — Don't load P2/P3/P4 until you know the topic.
5. **Load on-demand** — When a topic comes up, query memories tagged `p2` or `p3` matching that topic. Load P4 only when explicitly needed.
```

For Claude Code specifically, add this to your `CLAUDE.md` file. For Claude Desktop, add it to your custom connector instructions. For Cursor, add it to your `.cursorrules` file.

✅ **Done when:** Your agent's instruction file includes the boot sequence.

![Step 3](https://img.shields.io/badge/Step_3-Set_Up_the_Refresh_Pattern-1E88E5?style=for-the-badge)

Long sessions cause context drift — your agent forgets rules loaded at the start. Add a refresh command to your instructions:

```markdown
## /refresh — Context Drift Recovery

When the user types `/refresh` or you notice you're violating a P1 rule:
1. Re-query all P1 memories
2. Re-read them in full
3. Confirm to the user: "Refreshed — P1 rules reloaded."
```

This is especially important for sessions that run longer than 30 minutes, where earlier instructions get pushed out of context.

✅ **Done when:** Your agent responds to `/refresh` by re-loading P1 rules and confirming.

![Step 4](https://img.shields.io/badge/Step_4-Add_Save_Checkpoint_to_Session_End-1E88E5?style=for-the-badge)

Add a session-end checkpoint to your instructions so the next session has recent context:

```markdown
## Session End Checkpoint

Before ending a session, save a checkpoint memory with:
- What was accomplished
- What's in progress
- What to pick up next time

Tag it `p2` so it loads as reference in the next session's boot sequence.
```

✅ **Done when:** Your agent saves a checkpoint memory at the end of each session.

## Expected Outcome

- Your AI agent starts each session with P1 rules already loaded — no re-explaining guardrails or preferences
- Recent context from the last session is immediately available
- The agent knows what memories exist (table of contents) without loading them all
- P2/P3/P4 memories load on-demand as topics come up, keeping context lean
- `/refresh` recovers from context drift in long sessions
- Each session ends with a checkpoint memory for continuity

## Troubleshooting

**Issue: Agent loads everything at once, consuming too much context**
Solution: Check that your boot sequence loads P1 first, then only the 5 most recent memories. The table-of-contents step should query titles only, not full content.

**Issue: Agent doesn't follow the priority system — loads P4 when it should load P2**
Solution: Be explicit in your instructions. Instead of "load relevant memories," say "query memories tagged `p2` matching the current topic. Do NOT load `p4` memories unless the user explicitly mentions the integration."

**Issue: `/refresh` doesn't work — agent doesn't respond to the command**
Solution: The refresh pattern needs to be in your agent's instruction file, not stored as a memory. The agent can't execute a command that's buried in its own memory store — it needs to be in the active instruction set.

**Issue: Checkpoint memories pile up over time**
Solution: During boot sequence step 2, query only the 5 most recent checkpoint memories. Older checkpoints naturally become reference material rather than active context.

## Cross-References

This recipe pairs well with:
- [Auto-Capture Protocol](../auto-capture/) — automates the session-end checkpoint
- [Panning for Gold](../panning-for-gold/) — helps identify which memories deserve higher priority
- [Daily Digest](../daily-digest/) — a periodic review of what's in your P2/P3 layers

## Attribution

Priority-based loading pattern adapted from [open-brain-template](https://github.com/wefilmshit/open-brain-template) by Tony Finley.
