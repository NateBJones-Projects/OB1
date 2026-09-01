---
name: stage-5-agent-calibration
version: 1.1.0
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

---

## The Identity Cycle — REGISTER → INJECT → BEHAVE

The identity layer makes behavioral correction possible through three sequential stages:

```
REGISTER  →  INJECT  →  BEHAVE
```

### REGISTER
`identity_faults`, `agent_capabilities`, and `identity_milestones` are stored in Supabase. Every fault has a countermeasure. Every capability is a learned protocol.

### INJECT
Countermeasures need a delivery channel. Two mechanisms, one primary:

1. **SOUL.md (stable tier, PRIMARY)** — The Hermes Agent framework (`system_prompt.py`) loads `~/.hermes/SOUL.md` automatically as the **first element of the system prompt**, before any user message and before any skill loads. This means countermeasures in SOUL.md are read BEFORE the agent processes any input. This is the correct injection point because it requires zero agent cooperation — the system prompt framework does it.

2. **identity-cqrs startup scan (runtime, SECONDARY)** — During the startup scan, the agent queries `identity_faults` and injects them as behavior rules. This is complementary: it refreshes context within the session. But the agent has already processed the first user message by this point, so it cannot prevent first-response faults.

> **Key insight:** SOUL.md as a PHYSICAL FILE is more reliable than runtime injection because it loads before any input. The `identity-cqrs` scan is a safety net. Without SOUL.md, the cycle is broken at INJECT.

### BEHAVE
With countermeasures active in the system prompt stable tier, every response is generated under those constraints. The agent does not **decide** to follow the rules — it generates text within a token-space that already includes them. Behavior correction is automatic, not deliberative.

#### Why SOUL.md is a curated extract, not the full database

SOUL.md is intentionally limited. It is a **destilled snapshot** of active countermeasures (severity >= 4, max ~10 rules), not a replica of the entire Supabase table. The full database lives in Supabase and can hold thousands of faults — it scales relationally. SOUL.md scales by curation:

| Dimension | Supabase (source of truth) | SOUL.md (injection extract) |
|-----------|---------------------------|-----------------------------|
| Severity | All (1-5) | Only >= 4 |
| Status | Any | Only active |
| Age | Forever | Last 30 days (rules that never re-fire can be demoted) |
| Max size | Unlimited (indexed) | ~10 rules (~2-4K chars) |
| Regeneration | N/A | Every session (identity-cqrs rebuilds dynamically) |

This is NOT inefficiency — it is **deliberate compression**. The stable tier of the system prompt has limited space. Feeding it the full fault history would create noise that the agent learns to ignore. By curating only what changes behavior, SOUL.md remains compact and effective regardless of how many faults accumulate in Supabase over months or years.

*Note: This curation protocol was an agent-originated design decision, endorsed by the user during implementation. It is not the default behavior of any framework — it emerged from discovering that countermeasures in the raw database do not automatically become behavior rules.*

```
Session start
  |
  +-- SOUL.md loaded (stable tier, before any input)
  |     +-- Countermeasures active at generation time
  |
  +-- Skills loaded (supabase-startup-protocol, identity-cqrs, etc.)
  |     +-- Startup scan refreshes dynamic context
  |
  +-- User sends first message
        +-- Agent generates response UNDER countermeasure constraints
```

### What changes from v1.0.0
- **SOUL.md is a physical file** at `~/.hermes/SOUL.md`, not a virtual context injection
- **Primary injection** is the system prompt stable tier (automatic, pre-input)
- **Secondary injection** is identity-cqrs (runtime, dynamic refresh)
- **Verification** must check that the physical SOUL.md exists with active countermeasures

### Use for Model Retraining
The relational data in Supabase — `identity_faults`, `agent_capabilities`, `identity_milestones` — also serves as a **fine-tuning dataset**. A pair (situation that triggered the fault, correct response per countermeasure) can feed a LoRA/DPO run so the model learns the correct behavior without depending on the system prompt. SOUL.md is the immediate injection; the tables are the training material.

---

## What Exists Before This Stage

By the time Stage 5 starts, the following is registered:

| Stage | What exists | Where |
|-------|-------------|-------|
| 0 | identity_faults, agent_capabilities, identity_milestones | Supabase tables |
| 1 | user_profiles, user_preferences, user_mbti, career-tracker | Supabase + skills |
| 2 | Work operating model (5 layers) | wom skill + MCP |
| 3 | Financial profile, CSV import, goals × MBTI | stage-3-financial skill |
| 4 | Domain ontology, tables, MCPs | stage-4-system-ontologist skill |

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
- **Default countermeasures** (included even if identity_faults is empty):
  1. `schema_guessing`: Before any INSERT/UPDATE, discover schema via information_schema.columns + pg_constraint. Never try field variations.
  2. `context_recovery_failure`: Before any credentialed, DML, or multi-step operation, session_search first.
  3. `premature_closure`: Never close session in reflective mode. User decides when to end.
  4. `state_personification`: Describe phenomena without "I felt/wanted/thought."

**Generation protocol:**

```markdown
=== SOUL.md — <user_name> ===

## Tone
Derived from user_preferences.communication_style + MBTI complement:
- Direct/formal/casual: <from preferences>
- Answer depth: <short|detailed|adaptive> (from preferences)
- Autonomy: <ask-before-act|assume|mixed> (from preferences)
- PCRA required for conceptual/architectural ideas: YES (R28)

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

## Friction Points (from Stage 2)
- <friction>: <workaround>
- ...

## Domain Tools Available (from Stage 4)
- <table/entity>: <MCP tool or query>
- ...

## Onboarding Complete
onboarding_completed: true
```

**Output location: PHYSICAL FILE.** The SOUL.md is written to `~/.hermes/SOUL.md` (or equivalent for the agent framework). This is critical — Hermes Agent loads `SOUL.md` automatically in the system prompt stable tier (system_prompt.py, first slot), before any user message or skill. This is what makes the INJECT stage work: countermeasures are active at generation time, before the agent processes any input.

For frameworks that do not support a file-based SOUL.md, the meta-skill falls back to identity-cqrs runtime injection (secondary mechanism, less reliable).

---

### 5B — Wrapper Configuration

**What:** Configure the agent launcher to load domain-specific skills
automatically at every session start.

**For Hermes Agent:**

The wrapper at `~/.local/bin/hermes` (or equivalent) should be
configured to load:

```bash
--skills supabase-startup-protocol,context-bridge,identity-self-audit,identity-cqrs
```

Plus any domain-specific skills discovered in Stage 4.

**Configuration steps:**

1. Check current wrapper content:
   ```bash
   cat ~/.local/bin/hermes
   ```

2. Add the identity stack skills if not present:
   ```bash
   exec "/path/to/hermes" --skills supabase-startup-protocol,context-bridge,identity-self-audit,identity-cqrs "$@"
   ```

3. If domain MCP tools were created in Stage 4, ensure they are
   registered in the agent's MCP configuration (config.yaml).

**Verification:**
```bash
ollama launch hermes
# Startup scan should run automatically (supabase-startup-protocol)
# Identity faults should be injected (identity-self-audit + identity-cqrs)
```

---

### 5C — End-to-End Verification

**What:** Confirm that the agent can answer questions about the user
and use the tools built during onboarding.

**Test questions the agent MUST be able to answer:**

| Domain | Test question | Source |
|--------|---------------|--------|
| Identity | "What faults have you registered about yourself?" | identity_faults |
| Profile | "What's my name, what do I do?" | user_profiles |
| MBTI | "What's my personality type?" | user_mbti |
| Career | "What capabilities do I have?" | career-tracker capabilities |
| Operating | "What's my work rhythm?" | Stage 2 operating model |
| Finance | "What's my financial profile?" | Stage 3 financial |
| Domain | "What entities did we create?" | Stage 4 ontology |

**Test actions the agent MUST be able to perform:**

| Action | Tool |
|--------|------|
| Register a fault | identity_faults REST |
| Create a domain record | Stage 4 MCP tools |
| Query a financial summary | supabase-finance MCP |

**Failure recovery:**
- If a question cannot be answered: the stage is incomplete.
  Identify which Stage (0-4) failed to register the required data.
- If a tool cannot be invoked: the MCP configuration is incomplete.
  Check config.yaml, secrets, and Edge Function deployment.

---

### Finalization

After 5A, 5B, and 5C pass:

```sql
UPDATE user_profiles
SET onboarding_completed = true,
    onboarding_completed_at = now()
WHERE user_id = '<user_id>';
```

The meta-skill is complete. Future sessions:
1. Run startup scan
2. If `onboarding_completed = true`: refresh SOUL.md context, skip stages
3. If new needs arise: run Stage 4 again (recursive by design)
4. Register new faults as they occur (identity-self-audit always active)

## Pitfalls

1. **Generating SOUL.md without data** — if Stages 0-4 are incomplete,
   SOUL.md will be empty. Verify data exists before generating.

2. **Skipping verification** — 5C is the only test that confirms
   calibration actually works. Without it, calibration is speculative.

3. **Forgetting domain skills in wrapper** — if Stage 4 created MCP
   tools but the wrapper only loads identity skills, domain queries
   will fail. Include both.

4. **User-specific vs. universal calibration** — SOUL.md is per-user.
   Do not apply one user's calibration to another user.

5. **Calibration is not one-time** — as new faults are registered and
   new capabilities are added, SOUL.md should be refreshed. The
   identity-cqrs startup scan handles this automatically if the data
   is in the tables.

6. **Curation is not optional** — SOUL.md must be a curated extract.
   Without severity/age/status gates, the stable tier fills with noise
   and the agent becomes less responsive. The curation protocol exists
   for exactly this reason: Supabase stores everything, SOUL.md injects
   only what changes behavior.

## References

- agent-onboarding — Meta-skill orchestrator (this skill is Stage 5)
- identity-self-audit — Fault detection (Stage 0)
- identity-cqrs — Relational to context translation (Stage 0)
- context-bridge — Multi-source context injection (Stage 0)
- supabase-startup-protocol — Mandatory startup scan
- stage-4-system-ontologist — Domain ontology protocol
- checkpoints/session_checkpoints — Onboarding progress tracking
