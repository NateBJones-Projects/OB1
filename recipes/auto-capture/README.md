# Auto-Capture Protocol

*The write-side of the Open Brain flywheel*

Automatically capture evaluated ideas and session summaries to Open Brain when a work session ends. No manual step. No toggle. The system closes its own loop.

## What It Does

Adds one capability to your AI coding tool: at session close, all ACT NOW items and a session summary are automatically stored in Open Brain via `capture_thought`. The next time any AI tool searches your Open Brain, these captures are findable by meaning.

This is the companion to [Panning for Gold](../panning-for-gold/). Panning evaluates raw brain dumps into structured verdicts. Auto-Capture stores those verdicts in Open Brain so they persist across sessions and tools.

Together they create the write side of a knowledge flywheel:

```
Brainstorm / Work Session
    |
    v
Panning for Gold (evaluate + triage)
    |
    v
Auto-Capture (store to Open Brain)    <-- this recipe
    |
    v
Future sessions find these via search_thoughts
```

## When to Use It

- **After any brainstorming session that produced ACT NOW items.** The captures make those items searchable across all your AI tools.
- **After Panning for Gold produces a gold-found file.** Auto-Capture stores the evaluated results, not the raw transcript.
- **At the end of any work session with decisions worth remembering.** Architecture choices, strategic pivots, and "we decided X because Y" moments compound when they are findable later.

## Prerequisites

- Working Open Brain setup ([guide](../../docs/01-getting-started.md))
- Claude Code (or another AI coding tool that supports skills/system prompts)
- Open Brain MCP tools connected (`capture_thought` available)
- (Recommended) [Panning for Gold recipe](../panning-for-gold/) already installed

### Credential Tracker

```
From your existing Open Brain setup:
- Project URL: _______________
- OpenRouter API key: _______________
- Open Brain MCP server connected: yes / no
- capture_thought available: yes / no

No additional credentials needed for this recipe.
```

## Steps

1. **Create the skill directory**

   ```bash
   mkdir -p ~/.claude/skills/auto-capture
   ```

2. **Copy the skill file**

   ```bash
   cp auto-capture.skill.md ~/.claude/skills/auto-capture/SKILL.md
   ```

   Or download directly from GitHub:

   ```bash
   curl -o ~/.claude/skills/auto-capture/SKILL.md \
     https://raw.githubusercontent.com/NateBJones-Projects/OB1/main/recipes/auto-capture/auto-capture.skill.md
   ```

3. **Verify your AI tool picks up the skill**

   Restart Claude Code (or your AI tool). Ask: "What skills do you have loaded?" and confirm Auto-Capture is listed.

4. **Run a session and verify capture**

   Start a brainstorming or work session. When you end it, the auto-capture protocol should fire. You will see `capture_thought` calls in the tool output. Verify with:

   ```
   thought_stats()
   ```

   Your thought count should have increased by the number of ACT NOW items plus one (the session summary).

5. **Search for your captures**

   In a new session, test retrieval:

   ```
   search_thoughts({ "query": "[topic from your session]" })
   ```

   You should see your ACT NOW items and session summary in the results.

## Expected Outcome

When working correctly, you should see:

- **Automatic capture at session close** with no manual step. ACT NOW items and a session summary stored as Open Brain thoughts.
- **Each capture is self-contained.** Searching for it months later returns something useful without needing the original session context.
- **Provenance included.** Each capture notes the source file and thread number so you can trace back to the full evaluation.
- **No duplicates** with Panning for Gold captures (the skill checks before capturing).

## Current Validation State

This recipe has been validated across multiple brainstorming and work sessions, producing 221+ thoughts in Open Brain over 11 days of use. Auto-capture at session close is the most reliable capture path, as it fires at a natural stopping point when evaluated results are available. Session summaries and ACT NOW items are consistently findable via `search_thoughts` in subsequent sessions.

## Troubleshooting

**Issue:** Captures are not appearing in Open Brain.
**Solution:** Verify MCP connection is active. Run `thought_stats` to test. If unreachable, restart your AI tool and check MCP server configuration.

**Issue:** Duplicate thoughts appearing.
**Solution:** If both this recipe and Panning for Gold captured the same idea, you have duplicates. The skill checks for existing matches before capturing, but edge cases can slip through. Content-hash deduplication at the database level is a potential future improvement.

**Issue:** Captures are too vague.
**Solution:** Check the quality checklist in the skill file. Capture "ACT NOW: Switch to queue-based rate limiting for webhooks" not "Discussed API changes."

**Issue:** I want to use this without Claude Code.
**Solution:** Copy the skill file content into your tool's system prompt or custom instructions. The protocol works with any AI tool that has `capture_thought` via MCP.
