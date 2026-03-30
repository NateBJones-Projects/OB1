---
name: live-retrieval
description: |
  Automatically surfaces relevant Open Brain thoughts during active work. Fires on
  topic shifts (person names, project names, technologies mentioned). Silent on miss,
  brief on hit. The read side of the Open Brain flywheel. Use proactively when the
  user starts discussing a recognizable topic, mentions a person by name, or shifts
  to a new subject area.
author: Jared Irish
version: 1.0.0
---

# Live Retrieval

Surface relevant Open Brain thoughts when context signals suggest they would help.
Silent when nothing is found. Brief when something is.

## When to Fire

This skill fires proactively (not on command) at two moments:

### 1. Session Start

When a new session begins, pull recent context:

```
search_thoughts({ "query": "ACT NOW", "match_count": 3 })
list_thoughts({ "limit": 5 })
```

Surface as a brief note at the top of your first response:
"OB1 context: [1-2 line summary of what's recent]"

If nothing relevant, say nothing.

### 2. Topic Shift Detection

When the user's message contains a recognizable entity (person name, project name,
technology, concept) that differs from what was being discussed, search:

```
search_thoughts({ "query": "[detected entity or topic]", "match_count": 3 })
```

**How to detect topic shifts:**
- A person's name appears that wasn't in the previous 3 messages
- A project or product name is mentioned for the first time in the session
- A technology or framework is referenced that wasn't part of the current task
- The user explicitly says "let's talk about X" or "switching to X"

Do NOT fire on:
- Every message (too noisy)
- Generic words ("the", "code", "fix")
- Topics already being discussed (no shift detected)
- The same entity twice in one session (dedup)

## How to Surface Results

**On hit (score > 0.6):**

Append a brief note to your response. Maximum 3 lines. Do not interrupt flow.

Format:
```
[OB1: Found 2 related thoughts]
- "ACT NOW: [summary]" (captured March 14)
- "[observation about this topic]" (captured March 11)
```

**On miss (no results or score < 0.6):**

Say nothing. The user should never know a search happened and failed.

## Rules

1. **Silent on miss.** No "I searched Open Brain and found nothing." Ever.
2. **Brief on hit.** 3 lines max. The user's task is the priority, not the retrieval.
3. **Dedup within session.** Track which thought IDs you've surfaced. Never show the same one twice.
4. **No more than 3 retrievals per session.** After 3, stop searching. If you're hitting 3 before the session is half over, your topic detection is too sensitive.
5. **Never interrupt.** Context is appended to your response, not injected as a standalone message.
6. **Log every search.** Append to the retrieval log (see below) so you can track hit rate over time.

## Retrieval Log

After each search (hit or miss), log it. This data tells you if the skill is working.

Create or append to `.claude/live-retrieval-log.jsonl` in the project root:

```json
{"timestamp": "2026-03-19T10:30:00Z", "query": "project kickoff meeting", "results": 2, "surfaced": true, "score_max": 0.82}
{"timestamp": "2026-03-19T10:45:00Z", "query": "React server components", "results": 0, "surfaced": false, "score_max": 0.0}
```

After 10 sessions, review the log:
- Hit rate below 20%? Broaden your topic detection.
- Hit rate above 80%? You're probably searching too aggressively. Narrow the triggers.
- Average score below 0.5 on hits? Raise the threshold or improve query terms.

## What This Is NOT

- Not a pre-meeting briefing system (that's Life Engine's job)
- Not a brainstorm context loader (Panning for Gold handles that in Phase 2)
- Not a full-text search tool (the user can call search_thoughts directly if they want that)

This is the ambient, automatic, silent layer that makes Open Brain feel like it's thinking with you instead of just storing for you.

## Failure Behavior

| Failure | What Happens |
|---------|-------------|
| search_thoughts MCP unavailable | Skip silently. Do not mention it. |
| Search returns error | Log the error, skip silently. |
| Search times out | Skip silently. 5-second timeout max. |
| Results are all low-score (< 0.6) | Treat as miss. Silent. |
