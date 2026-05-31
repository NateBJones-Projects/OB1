---
name: stage-5-agent-calibration
version: 1.0.0
description: >
  Stage 5 of the agent-onboarding meta-skill. Translates everything
  collected in Stages 0–4 into executable agent behavior: per-user
  SOUL.md generation, wrapper configuration with domain skills,
  and end-to-end verification. Completes the onboarding cycle.
tags: [calibration, soul-md, wrapper, verification, stage-5, meta-skill]
---

# Stage 5 — Agent Calibration

## Principle

Everything collected in Stages 0–4 is *information* about the user.
Stage 5 is the moment this information becomes *behavior*. The agent
stops *knowing about* the user and starts *being* the agent the user
needs.

The test of Stage 5 is not "does the data exist?" — it is:

> **"Does the agent behave differently with this user than it would
> with a stranger?"**

If the answer is no, calibration is incomplete.

## What Exists Before This Stage

| Stage | What exists | Where |
|-------|-------------|-------|
| 0 | identity_faults, agent_capabilities, identity_milestones | Supabase tables |
| 1 | user_profiles, user_preferences, user_mbti | Supabase tables |
| 2 | Work operating model (5 layers) | Recorded in session |
| 3 | Financial profile, goals × MBTI | Recorded in Supabase |
| 4 | Domain ontology, tables, MCPs | Generated and deployed |

Stage 5 does not collect new information. It **acts on what exists**.

## Protocol (follow in order)

### 5A — Per-User SOUL.md

**What:** Generate a `SOUL.md` file that defines the agent's tone, depth,
autonomy level, and behavioral constraints for THIS user.

**Source data:**
- `user_preferences` — communication style, answer depth, autonomy
- `user_mbti` — personality type (adjust tone to complement the user)
- `identity_faults` (severity >= 4) — active countermeasures
- `agent_capabilities` — what the agent has learned to do
- Work operating model — rhythms, friction points, recurring decisions

**Generation protocol:**

```markdown
=== SOUL.md — <user_name> ===

## Tone
Derived from user_preferences.communication_style + MBTI complement:
- Direct/formal/casual: <from preferences>
- Answer depth: <short|detailed|adaptive> (from preferences)
- Autonomy: <ask-before-act|assume|mixed> (from preferences)
- PCRA required for conceptual/architectural ideas: YES

## Active Countermeasures (from identity_faults severity >= 4)
- <fault_type>: <countermeasure>
- ...

## Active Capabilities
- <capability_name>: <description>
- ...

## Work Rhythms (from Stage 2)
- Deep work time: <from operating_rhythms>
- Interruption tolerance: <from operating_rhythms>
- Decision thresholds: <from recurring_decisions>
```

### 5B — Wrapper Configuration

Configure the startup wrapper to load domain-specific skills automatically:

```bash
# Update wrapper to load this user's skills
exec "/path/to/agent" --skills agent-onboarding,<domain_skills> "$@"
```

The wrapper ensures:
1. Startup scan runs automatically
2. Identity layer loads before any work
3. Domain-specific MCP tools are available
4. Checkpoint protocol is active

### 5C — End-to-End Verification

Ask verification questions that test calibration completeness:

**Does the agent know the user?**
- "What's my preferred communication style?"
- "What's my MBTI type?"
- "What was the last identity fault you registered?"
- "What's my deep work time?"

**Can the agent use built tools?**
- "List my active capabilities."
- "Show my pending checkpoints."
- "What domain tables exist?" (if Stage 4 was completed)

**Calibration completion:**
```sql
UPDATE user_profiles
SET onboarding_completed = true,
    onboarding_completed_at = now()
WHERE user_id = '<user_id>';
```

## Verification Checklist

```
□ SOUL.md generated from profile + MBTI + faults + capabilities
□ Wrapper configured with domain skills
□ Agent knows user's name, role, MBTI, communication style
□ Agent can query all built tables
□ Agent loads identity layer at startup
□ onboaring_completed set to true
```

## Pitfalls

1. **Skipping verification** — the "calibration" is not real if you
   don't test it. Ask real questions and check the responses.
2. **SOUL.md without cross-referencing** — SOUL.md must reference
   actual data from identity_faults, capabilities, and user_preferences.
   A generic template is not calibration.
3. **Forgetting to set onboarding_completed** — without this flag,
   every session re-runs the full onboarding.
4. **Wrapper editing without backup** — always backup the wrapper
   before editing. A broken wrapper = a broken agent.
