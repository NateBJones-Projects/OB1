# Recall Before Asking

**Created by [@eazene](https://github.com/eazene)**

> Behavioral protocol that makes an AI client search Open Brain *before* asking you a factual, contextual, or status question. The read-path complement to [auto-capture](../auto-capture/).

## Relationship to Auto-Capture

Open Brain's write path is well covered: the [auto-capture skill](../auto-capture/) and its [Claude Code adapter](../auto-capture-claude-code/) push sessions into the brain automatically. But nothing makes an agent read the brain back out — so agents keep asking you for things you already captured. This skill closes that gap. It is the **read-path complement**: auto-capture writes sessions *in*; recall-before-asking reads them *back out* before the agent bothers you. The two pair naturally — install both for a complete loop — but this skill works on its own and does not depend on auto-capture being installed.

## What It Does

Before an agent asks you a clarifying, factual, or status question ("what did we decide", "where did we leave X", "is Y deployed"), the protocol has it search Open Brain first and answer from the brain when it can — asking you only as a last resort, and attributing the source when it does recall something.

Because "search before asking" must hold on *every* turn (unlike auto-capture, which fires once at session end), the real mechanism is an **always-loaded rule**, not a triggered skill. This folder provides that rule for each client, plus an optional **prompt-submit hook** for hard per-turn enforcement.

## Prerequisites

- Working Open Brain setup ([guide](../../docs/01-getting-started.md)) with the search tools reachable from your client (`search_thoughts` / `search`; prefixes vary by connector).
- One or more AI clients that read persistent instructions: Claude Code, Codex, Grok, or any client that supports an always-loaded rule file or a prompt-submit hook.

## Install

Pick the enforcement level you want. The **rule file** is the portable soft version (a nudge that loads every session). The **hook** is the hard version (re-injected on every prompt). They compose — install the rule everywhere, add the hook where you want a guarantee.

The rule text to install, in all cases, is:

> **Before asking me a factual, contextual, or status question, first search Open Brain (OB1) using the available search tools. Only ask me if the search comes up empty or ambiguous. When an answer came from Open Brain, say so briefly.**

### Rule file — per client

Each client loads persistent instructions from a different place. Use the one(s) you run. All of these are **user-level and personal** — do not commit them to a shared repo.

- **Claude Code** — add one line to your auto-memory index and a small memory file. Append to `~/.claude/projects/<project-slug>/memory/MEMORY.md`:

  ```markdown
  - [Search OB1 before asking](search-ob1-before-asking.md) — query Open Brain before asking any factual/status question; ask only if the brain comes up empty
  ```

  and drop the rule text (above) into `~/.claude/projects/<project-slug>/memory/search-ob1-before-asking.md` as a `feedback`-type memory. It loads into context at session start.

- **Codex** — add the rule to global guidance at `~/.codex/AGENTS.md`. Codex merges it into every session.

- **Grok** — add the rule to a global rule file at `~/.grok/AGENTS.md`. Grok discovers `~/.grok/` as global rules that "apply to all projects" and loads them at session start. Confirm with `grok inspect` (look for the file listed as **global**).

- **Any other client** — put the rule in whatever file that client loads on every session (a global `AGENTS.md` / `CLAUDE.md`, a system-prompt append, or its memory system).

> These load at **session start**. Restart the client (or `/new`) after installing.

### Optional hook — hard enforcement

For a guarantee that survives context summarization, add a prompt-submit hook that re-injects the rule on every turn. See [`recall-before-asking.hook.md`](./recall-before-asking.hook.md) for the exact per-client config (Claude Code `UserPromptSubmit`, plus notes for Codex and Grok hooks).

## Verify

1. Start a fresh session in the client you installed to.
2. Ask something the brain should already know (e.g. "what did we decide about <a captured topic>?").
3. Confirm the agent **searches Open Brain first** and answers from it — attributing the source — rather than asking you to restate it.

For Grok specifically, `grok inspect` should list your `~/.grok/AGENTS.md` as a loaded **global** instruction.

## Expected Outcome

- Clarifying/factual/status questions the brain can answer are replaced by a brain lookup.
- Remaining questions are sharper, informed by recalled context.
- Brain-sourced answers are attributed so you can trust-but-verify.
- The read path matches the write path across every client you run.

## Troubleshooting

**Issue: Agent still asks instead of searching.**
The rule loads at session start — restart the session (or `/new`). If it still slips, add the optional hook for hard per-turn enforcement.

**Issue: Grok not picking up the rule.**
Run `grok inspect`; if `~/.grok/AGENTS.md` isn't listed as global, confirm the filename is a supported one (`AGENTS.md`, `CLAUDE.md`, etc.) and that it isn't gitignored.

**Issue: Agent recalls stale or wrong facts.**
Recalled memories reflect what was true when captured. The protocol requires attribution precisely so you can catch this — verify a named file/flag/status before relying on it, and correct the brain when it's wrong.

**Issue: Agent answers from a weak match instead of asking.**
That's a misapplication — a low-relevance hit should sharpen the question, not replace it. Re-read `SKILL.md`'s Notes; the rule is "recall before asking," not "never ask."

## Notes

- This is a behavioral protocol plus an install kit, not a runtime. It ships no code that runs on its own — the rule files and optional hook are what enforce it.
- Do not put these rules in a committed `AGENTS.md` / `CLAUDE.md` that ships upstream; they are personal workflow. Keep them in user-level config.
- Tool names vary by client and connector. The rule refers to "the available search tools" rather than a fixed prefix so it works regardless of which Open Brain connector is active.
- Pairs with the [auto-capture skill](../auto-capture/) for a complete write-then-read loop.
