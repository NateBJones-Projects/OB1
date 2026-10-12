# Optional Hook — Hard Enforcement

The always-loaded rule file (see the README) loads once at session start. It's a
strong nudge, but it can fade as context gets summarized. For a **guarantee that
survives compaction**, add a prompt-submit hook that re-injects the reminder on
**every** turn.

Enforcement level, from soft to hard:

1. **Rule file** (README) — loaded once per session. Portable, works in any client.
2. **Prompt-submit hook** (this file) — re-injected every turn. Hard enforcement
   where the client supports injecting hook output into context.

Install the rule everywhere; add the hook where you want the guarantee.

The reminder text the hook injects:

> Before asking the user a factual, contextual, or status question, first search
> Open Brain (the `search_thoughts` / `search` tools) and answer from it when you
> can. Attribute the source. Ask the user only if the brain comes up empty or
> ambiguous.

---

## Claude Code — `UserPromptSubmit` (reliable)

Claude Code fires `UserPromptSubmit` when you submit a prompt, and **adds the
hook's stdout to the model's context** for that turn. That makes it a reliable
hard-enforcement point.

Add to `~/.claude/settings.json` (global) or `.claude/settings.json` (project):

```json
{
  "hooks": {
    "UserPromptSubmit": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "printf '%s' 'Reminder: before asking the user a factual, contextual, or status question, first search Open Brain (search_thoughts/search) and answer from it when you can. Attribute the source. Ask only if the brain comes up empty or ambiguous.'"
          }
        ]
      }
    ]
  }
}
```

`UserPromptSubmit` takes no `matcher`. Restart Claude Code to load the hook. Every
prompt now carries the reminder into context.

## Grok — `UserPromptSubmit` (experimental)

Grok exposes a `UserPromptSubmit` event (see `~/.grok/docs/user-guide/10-hooks.md`),
but its docs only document stdout-injection for `PreToolUse` — whether
`UserPromptSubmit` stdout reaches the model context is not guaranteed. So on Grok,
**prefer the always-loaded `~/.grok/AGENTS.md` rule** as your enforcement, and
treat a `UserPromptSubmit` hook as experimental.

If you try it, add a global hook `.json` under `~/.grok/hooks/` keyed on
`UserPromptSubmit` with a `type: "command"` that prints the reminder, then confirm
in a session that the reminder actually lands in context before relying on it.
Global hooks in `~/.grok/hooks/` are always trusted.

## Codex — use the rule file

Codex's hook system is oriented around session/stop lifecycle events, not a
context-injecting prompt-submit event. On Codex, the always-loaded
`~/.codex/AGENTS.md` rule is the recommended enforcement. Consult the current
Codex hooks documentation if a prompt-level injection event becomes available.

## Any other client

If the client has a prompt-submit (or "before-message") hook whose output is
injected into context, wire the same reminder there. Otherwise rely on the
client's always-loaded instruction file (its global `AGENTS.md` / `CLAUDE.md` or
memory system).

---

## Notes

- The reminder is **static text**, so a one-line `printf` is enough — no script to
  maintain. Adapt the wording to your client's search-tool names if they differ.
- Keep hook config in **user-level** settings, not a committed repo file.
- The hook complements the rule; it does not replace it. Belt and suspenders: the
  rule sets the default disposition, the hook guarantees the per-turn reminder.
