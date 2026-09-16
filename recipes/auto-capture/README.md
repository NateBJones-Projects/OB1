# Auto-Capture Protocol

*The write side of the Open Brain flywheel*

Automatically capture evaluated ideas and session summaries to Open Brain when a work session ends. No manual step. No toggle. The system closes its own loop.

## What It Does

This recipe teaches you how to use the reusable [Auto-Capture skill](../../skills/auto-capture/) as part of an Open Brain workflow. The skill handles the behavior at session close; this recipe defines what should get captured, what should not, and how the captures compose with [Panning for Gold](../panning-for-gold/).

> [!NOTE]
> This is a behavioral workflow, not a background service, hook, or daemon. Your AI client follows the protocol when session-end conditions are met.

Together with [Panning for Gold](../panning-for-gold/), Auto-Capture creates the write side of a knowledge flywheel:

```text
Brainstorm / Work Session
    |
    v
Panning for Gold (evaluate + triage)
    |
    v
Auto-Capture (store to Open Brain)
    |
    v
Future sessions find these via search_thoughts
```

## Prerequisites

- Working Open Brain setup ([guide](../../docs/01-getting-started.md))
- Claude Code or another AI coding tool that supports reusable skills/system prompts
- The canonical [Auto-Capture skill pack](../../skills/auto-capture/)
- Open Brain MCP tools connected so capture is available
- Recommended: [Panning for Gold](../panning-for-gold/) for evaluating raw input before capture

### Credential Tracker

```text
From your existing Open Brain setup:
- Project URL: _______________
- Open Brain MCP server connected: yes / no
- Open Brain capture tool available: yes / no
- Open Brain search tool available: yes / no

No additional credentials needed for this recipe.
```

## Steps

1. **Install the skill dependency**

   Follow the installation steps in the [Auto-Capture skill pack](../../skills/auto-capture/). The canonical prompt lives there.

2. **Confirm your Open Brain tools are available**

   Verify your AI client can see the Open Brain capture tool. If your setup also exposes search, keep that enabled so the skill can avoid obvious duplicates.

3. **Use it at the right point in the workflow**

   Run Auto-Capture when a session is genuinely ending and you already have evaluated outputs. The best fit is:

   - after a Panning for Gold run produces ACT NOW items
   - after a work session ends with clear decisions or next actions
   - when you want the most valuable outputs stored before you lose context

4. **Verify the captures**

   End a short session with one or two clear ACT NOW items, then confirm that:

   - each ACT NOW item was captured separately
   - one session summary was captured
   - the captures are searchable in a later session

## What Gets Captured

### 1. Each ACT NOW item

Capture each high-value item as its own thought. Each one should include:

- what the idea or decision is
- why it matters
- concrete next actions
- provenance when available

Example:

```text
ACT NOW: Switch the webhook pipeline to queue-based backoff. This handles burst traffic more reliably than the current retry flow and reduces dropped events during spikes. Next actions: (1) prototype the queue worker, (2) benchmark it against the current handler, (3) test with a 10x burst replay. Origin: 2026-03-14 API redesign session, thread #7.
```

### 2. One session summary

Capture one summary that records the session's themes and the number of important items that emerged.

Example:

```text
Work session: API redesign brainstorm. 24 threads reviewed, 3 ACT NOW items, 5 research threads, 16 parked. Main themes: queue-based retries, webhook durability, client SDK versioning. Full context lives in docs/brainstorming/2026-03-14-api-redesign-gold-found.md.
```

## What Does Not Get Captured

- Raw brainstorming or transcript text
- Parked or killed items
- Obvious duplicates of thoughts that are already in Open Brain

## Capture Quality Checklist

Before a capture is considered done, make sure it is:

- self-contained enough to understand months later
- specific about the decision or next action
- explicit about why it matters
- grounded with provenance when available

## How This Composes with Panning for Gold

Panning for Gold and Auto-Capture solve different parts of the same problem:

| Workflow Piece | Role |
| --- | --- |
| [Panning for Gold](../panning-for-gold/) | Extracts and evaluates threads from messy raw input |
| [Auto-Capture skill](../../skills/auto-capture/) | Stores the highest-value outputs at session close |
| This recipe | Defines the OB1 workflow, capture rules, and expected outputs |

## Expected Outcome

When working correctly, you should see:

- one searchable Open Brain thought per ACT NOW item
- one searchable Open Brain thought for the session summary
- no raw-noise captures cluttering the database
- a clean handoff from evaluation workflows like [Panning for Gold](../panning-for-gold/) into durable Open Brain memory

## Troubleshooting

**Issue: The skill fires, but nothing appears in Open Brain**
Solution: Verify your Open Brain capture tool is connected and callable in the current client. Test it manually before relying on the recipe.

**Issue: Captures are too generic to be useful later**
Solution: Tighten the capture content. Preserve the decision, the reason it matters, and concrete next actions. Generic wrap-ups do not search well.

**Issue: Duplicate thoughts appear after using this with Panning for Gold**
Solution: Keep the workflow boundary clean. Panning for Gold should evaluate; Auto-Capture should persist the final high-value outputs. If both are storing the same payload, make the capture step the single source of persistence.
