---
name: auto-capture
description: |
  Automatically capture ACT NOW items and a session summary to Open Brain
  when a work session is ending. Use when wrapping a brainstorm, parking
  a project, finishing a Panning for Gold run, or otherwise closing a
  session with decisions worth remembering. Use the Open Brain capture tool
  available in the current client (often named `capture_thought`; prefixes
  vary by connector). This is a behavioral protocol, not a background hook.
author: Jared Irish
version: 1.0.0
---

# Auto-Capture

## Problem

High-value decisions and next actions are easy to lose at the end of a session.
If capturing them requires a separate decision, they often never make it into
Open Brain.

## Trigger Conditions

- The user is clearly ending a session: "wrap up", "park this", "goodnight", "let's stop here"
- A brainstorm or work session produced ACT NOW items worth preserving
- A Panning for Gold run finished and produced evaluated outputs
- The conversation is about to end and there is clear value in preserving the results

## Process

1. Detect that the session is ending. Treat this as a behavioral cue, not a timer, daemon, hook, or background service.
2. Identify the highest-value outputs from the session:
   - each ACT NOW item
   - one concise session summary
3. Before capturing an ACT NOW item, check for an obvious existing match in Open Brain using the available search tool if the client exposes one (often `search_thoughts`; prefixes vary by connector).
4. Capture each ACT NOW item as its own self-contained thought using the available Open Brain capture tool.
   - Include the idea in its strongest form
   - Include why it matters
   - Include 2-3 concrete next actions
   - Include provenance when available (date, source file, thread number, or session context)
5. Capture one session summary that records:
   - what the session was about
   - how many important items emerged
   - the main themes or threads
   - where the fuller context lives, if there is a file or document
6. Do not capture low-value noise. Skip:
   - raw transcript text
   - parked or killed items
   - obvious duplicates

## Output

When this skill runs correctly, the session ends with:

- one Open Brain capture per ACT NOW item
- one Open Brain capture for the session summary
- captures that are specific enough to be useful months later without reopening the original session

## Notes

- Prefer specificity over vague summaries. "ACT NOW: switch webhook retries to queue-based backoff" is useful; "discussed API changes" is not.
- If the capture tool fails, do not invent success. Tell the user the local wrap-up succeeded but the Open Brain capture did not.
- Tool names vary by client and connector. Use the Open Brain search/capture tools available in the current environment rather than assuming a fixed prefix.
- This skill is intentionally reusable. For the OB1-specific workflow and composition guidance, see [the Auto-Capture recipe](../../recipes/auto-capture/).
