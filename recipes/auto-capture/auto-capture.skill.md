---
name: auto-capture
description: Automatically capture evaluated ideas and session summaries to Open Brain at session close. Fires when a brainstorming or work session ends. Uses capture_thought to store ACT NOW items and a session summary so future sessions can find them via search_thoughts. No toggle, no manual step.
---

# Auto-Capture Protocol

## Overview

When a work session ends, automatically capture its most valuable outputs to Open Brain via `capture_thought`. No manual step. No "remember to save this." The system closes its own loop.

**Core principle:** If capturing a thought requires a decision, it won't happen. This protocol removes the decision. Session ends, captures fire, knowledge persists.

## When It Fires

Auto-capture runs when the session is ending:
- User says goodnight, "wrap up," "stop," or "park this"
- Context window is approaching capacity
- Natural end of a brainstorming or work session
- After Panning for Gold (companion recipe) produces a gold-found file

## What Gets Captured

### 1. Each ACT NOW item (one capture per item)

For each idea evaluated as "act on this now," call `capture_thought`:

```
capture_thought({
  "content": "ACT NOW: Queue-based rate limiting for webhook pipeline. Handles burst traffic without dropping events, simpler than token bucket for our async use case. Next actions: (1) Prototype with Bull queue, (2) Benchmark against current approach, (3) Test with 10x traffic spike. Origin: docs/brainstorming/2026-03-14-api-redesign-gold-found.md > Thread #7"
})
```

The `content` field combines everything into one self-contained string:
- **What:** One-line summary of the idea in its strongest form
- **Why it matters:** The evaluation reasoning (1-2 sentences)
- **Next actions:** Concrete steps, not "think about it more"
- **Origin:** File path and thread number so future-you can trace back to the full context

### 2. Session summary (one capture)

One `capture_thought` call summarizing the entire session:

```
capture_thought({
  "content": "Work session: API redesign brainstorm, 24 threads extracted, 3 ACT NOW, 5 research, 16 parked. Key threads: queue-based rate limiting (#7), webhook retry backoff (#12), client SDK versioning (#19). Gold-found: docs/brainstorming/2026-03-14-api-redesign-gold-found.md"
})
```

This gives future `search_thoughts` queries a summary to match against, plus a pointer to the detailed file.

## What Does NOT Get Captured

- **Raw brainstorming text.** That stays in session files, not Open Brain. Capturing everything pollutes the search index.
- **PARKED or KILLED items.** Low-value thoughts dilute search results. If something gets promoted later, it gets captured then.
- **Duplicate captures.** If Panning for Gold already captured an item from this session, do not capture it again. Check by searching for a few keywords from the item before capturing.

## Capture Quality Checklist

Before each `capture_thought` call, verify:
- [ ] The content is self-contained (someone searching for it in 3 months can understand it without the original session)
- [ ] Date and source file are included
- [ ] If this builds on a prior Open Brain thought, the connection is noted
- [ ] Next actions are concrete, not vague

## How This Composes with Panning for Gold

| | Panning for Gold | Auto-Capture (this recipe) |
|---|---|---|
| **When** | Post-hoc, on finished transcripts | At session close, on evaluated results |
| **Input** | Saved files, transcripts, exports | ACT NOW items and session summary |
| **Output** | Gold-found file with verdicts | Open Brain thoughts |
| **User involvement** | Reviews inventory, confirms evaluation | Zero. Fires automatically. |

A typical workflow using both:
1. Tuesday meeting transcript exported
2. **Panning for Gold** processes it, produces gold-found file with 4 ACT NOW items
3. **Auto-Capture** fires at session close, stores each ACT NOW item and a session summary to Open Brain
4. Thursday, a new session starts and searches Open Brain for context on today's work
5. Tuesday's ACT NOW items surface when a related topic comes up

Each pass through the loop makes the next pass richer.

## Troubleshooting

**Issue:** Captures are not appearing in Open Brain after session close.
**Solution:** Verify your Open Brain MCP connection is active. Run `thought_stats` to confirm the connection works. If the MCP server is unreachable, captures fail silently. Restart your AI tool and verify the MCP server is listed.

**Issue:** Duplicate thoughts appearing in Open Brain.
**Solution:** If both this recipe and Panning for Gold captured the same idea, you have duplicates. Before capturing, search Open Brain for a few keywords from the item. If a match exists with relevance > 0.7, skip the capture. Future versions of Open Brain may add content-hash deduplication at the database level.

**Issue:** Captures are too vague to be useful when searched later.
**Solution:** Check the quality checklist above. The most common mistake is capturing "Discussed API changes" instead of "ACT NOW: Switch webhook pipeline from token bucket to queue-based rate limiting. Handles burst traffic without dropping events." Specificity is what makes search work.

**Issue:** Too many captures per session, cluttering Open Brain.
**Solution:** Only capture ACT NOW items and one session summary. If you have more than 5 ACT NOW items in a single session, you likely miscategorized some as ACT NOW that should be RESEARCH or PARKED. Re-triage before capturing.

**Issue:** I want to use this without Claude Code.
**Solution:** The protocol works with any AI tool that has access to `capture_thought` via MCP. Copy the content of this file into your tool's system prompt or custom instructions. Adapt the file paths to your project structure.
