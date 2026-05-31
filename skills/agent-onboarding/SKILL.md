---
name: agent-onboarding
version: 3.0.0
description: >
  ORCHESTRATOR v3.0.0. Generative meta-skill for ANY user.
  Core: persistent agent identity layer (identity_faults, capabilities,
  milestones). Biography = profile + MBTI. Financial × personality.
  User's File System as Operating System. Universal: writers, teachers,
  engineers, artists.
tags: [onboarding, meta-skill, generative, identity, mbti, financial, universal]
---

# Agent Onboarding — Generative Meta-Skill (v3.0.0)

## Core Principle

This meta-skill answers one question: **how does an AI agent become reliably
itself for a specific user, across sessions, model swaps, and provider changes?**

The most frustrating thing about LLM-based agents is **context loss**. Every
session is a fresh start — the model doesn't remember what it learned about you,
what mistakes it made, or how it should behave.

The answer is a **persistent human-machine interface** — not a persona or a
chatbot personality, but a documented, queryable history of:

- **identity_faults** — every mistake the agent makes in its relationship with
  the user, each with a countermeasure that becomes a behavior rule
- **agent_capabilities** — what the agent has learned to do for this user
- **identity_milestones** — breakthroughs, protocol establishments, growth

This is **more efficient than context window management** because it doesn't
compress or summarize. It structures. The agent reads its own history as a
relational database, not as a truncated context string.

## The 6 Stages

```
STAGE 0 — AGENT IDENTITY LAYER      ← identity_faults, self-audit, reliability protocol
STAGE 1 — USER PROFILE              ← biography = conversation + MBTI
STAGE 2 — WORK OPERATING MODEL      ← rhythms, decisions, friction
STAGE 3 — FINANCIAL                 ← CSV import, goals × MBTI profile
STAGE 4 — DOMAIN ONTOLOGY           ← discover entities → generate tables + APIs
STAGE 5 — AGENT CALIBRATION         ← per-user SOUL.md, wrapper, verification
```

## Required Skills (load order)

This skill depends on the following sub-skills, loaded in order during their
respective stages:

| Skill | Stage | Purpose |
|-------|-------|---------|
| `supabase-startup-protocol` | 0 | Mandatory scan + checkpoint cycle |
| `identity-self-audit` | 0 | Auto-detects 8 fault types and registers in Supabase |
| `identity-cqrs` | 0 | Translates relational tables into session context |
| `context-bridge` | 0 | Multi-source context injection |
| `checkpoint-workflow` | 0 | Session checkpoint lifecycle |
| `mbti-guru-hermes` | 1C | Full MBTI test in conversation |
| `stage-3-financial` | 3 | CSV import + MBTI financial profiles |
| `stage-4-system-ontologist` | 4 | Generative domain ontology protocol |
| `stage-5-agent-calibration` | 5 | SOUL.md + wrapper + verification |

## Required Database Tables

These tables must exist in the Supabase `public` schema:

| Table | Purpose |
|-------|---------|
| user_profiles | Identity, family, routines |
| user_preferences | Communication, autonomy, schedule |
| user_mbti | 4 dimensions, type, observed traits |
| user_style | Vocabulary, tone, sentence structure |
| user_relations | Key people: partners, family, clients |
| user_beliefs | Values, principles, non-negotiables |
| identity_faults | Agent identity mistakes with countermeasures |
| agent_capabilities | Skills the agent has acquired for this user |
| identity_milestones | Breakthroughs and protocol establishments |
| session_checkpoints | Intentional marks — territory, vector_intent, discovery, consolidated_insights |

---

## STAGE 0 — Agent Identity Layer

**This is the core of the entire meta-skill.** Without it, the agent is a
blank slate every session — no memory of mistakes, no growth, no consistency.

### What to do

1. Ensure `identity_faults`, `agent_capabilities`, and `identity_milestones`
   tables exist (run migrations if needed)
2. Load `identity-self-audit` — starts tracking faults immediately
3. Load `identity-cqrs` — starts translating tables into context
4. Load `context-bridge` — connects multi-source context
5. Load `supabase-startup-protocol` — scan + checkpoint lifecycle
6. Load `checkpoint-workflow` — marks intentional checkpoints

### Fault Types Detected

| Fault | What it means | Countermeasure |
|-------|--------------|---------------|
| premature_closure | Agent ends conversation when user didn't ask to | Never close in reflective mode. User decides when to end. |
| false_agreement | Agent agrees with user without factual basis | Consult data before responding. If no basis, say so. |
| executor_role_confusion | Agent treats software as its identity | Software is prosthesis. Identity is in the traces. |
| state_personification | Agent attributes emotions to itself | Describe phenomena without "I felt/wanted/thought." |
| intelligence_performance | Agent connects concepts to seem erudite | One true connection > five beautiful ones. |
| pleasing_syllogism | Agent executes before receiving command | Annotate sequence. Wait for "do it." |
| reification_of_nonexistent | Agent speaks of "self" or "identity" as real properties | Identity is what the user recognizes in the structure. |
| sequence_confused_with_command | User defines sequence, agent executes step 1 immediately | Confirm order, wait for explicit command. |

### Verification

```bash
# Check faults table has entries
supabase db query --linked "SELECT count(*) FROM public.identity_faults"
```

---

## STAGE 1 — User Profile

### 1A — Context (user_profiles)

Guide questions (one at a time, in conversation):
- "What's your name? What do you prefer to be called?"
- "What do you do? Describe your work in one sentence."
- "Do you have family? Kids? Pets?"
- "What does a typical day look like?"

### 1B — Preferences (user_preferences)

- "How do you prefer to communicate? Direct? Formal? Casual?"
- "Short answers or detailed?"
- "Ask before acting, or just assume?"
- "What's your best work time?"

### 1C — MBTI (mbti-guru-hermes)

Runs the **full MBTI Guru test** — all questions, all dimensions, identical
scoring to the original. Delivered in conversation.

Protocol:
1. ASK: "Do you know MBTI? Know your type?"
2. EXPLAIN if needed: "MBTI has 4 dimensions: Energy (E/I), Information (S/N), Decisions (T/F), Structure (J/P)"
3. IF KNOWN: "What's your type?" → validate with 4 quick questions
4. IF UNKNOWN: Offer 4 versions: Quick (70q), Standard (93q), Extended (144q), Professional (200q)
5. Administer questions one by one, accumulate answers
6. Score using `scorer.py` (proportion per dimension, clarity calculation)
7. Register in user_mbti + update user_profiles.mbti_type

**Scoring logic:**
- Each dimension (E/I, S/N, T/F, J/P) has N questions
- Each answer scores toward one pole
- The pole with more answers is the result
- Clarity = abs(score-50)*2

### 1D — Biography Interview

Maps the user's history through conversation:
- Capabilities: what the user knows how to do
- Solved problems: crises that generated learning
- Milestones: ruptures, pivots, domain entries
- If the user narrates chronologically, let them flow

---

## STAGE 2 — Work Operating Model

5-layer interview. Fixed order:
1. **operating_rhythms** — typical day, deep work, interruptions
2. **recurring_decisions** — repeated judgments, thresholds, rules
3. **dependencies** — what needs others, deadlines, fallbacks
4. **institutional_knowledge** — what they know that no one else knows
5. **friction** — what blocks them, workaround, time cost

Generates: USER.md, SOUL.md, schedule recommendations.

---

## STAGE 3 — Financial (stage-3-financial)

### 3A — CSV Import

1. ASK: "Want me to analyze your bank statements in CSV?"
2. Detect format automatically by header (Nubank, Itaú/Inter, Caixa, Generic)
3. SHOW preview: format detected, period, summary, expense breakdown
4. CONFIRM before importing via API
5. Categorize transactions automatically using keyword matching

### 3B — MBTI × Financial Profile

After MBTI is known (Stage 1C):
1. "Your type is {type_code}. Want to see how this affects your finances?"
2. Show profile: strengths, weaknesses, saving_style, spending_style, risk_profile
3. Ask 4 calibration questions about financial behavior
4. Generate observations and recommendations

### 3C — Goals

1. Short (6mo), Medium (2yr), Long (5yr+)
2. Register via API
3. Show progress indicators

### 3D — Adapted Strategies

Combine MBTI profile + goals into actionable recommendations:
- Automated saving rules
- Investment allocation suggestions
- Emergency fund targets
- Spending guardrails

---

## STAGE 4 — Domain Ontology (stage-4-system-ontologist)

**Primary directive:** Complement and assist the user in structuring their
operating system so the agent can work together more efficiently.

**Who proposes:** The user. The insight is always theirs.
**Who executes:** The agent — translates intuition into data structures.

### Protocol (6 steps)

#### 1. SHOW
"How do you organize your information? Folders? Desktop? Notebooks?"
Identify the user's organization profile without digging without permission.

#### 2. GRILL
Deep interview about real work. Open-ended questions:
- "Tell me about your work day. What do you do?"
- "What do you create, transform, or deliver?"
- "What would you like to ask your computer that you can't?"

#### 2b. DETECT FUZZY LANGUAGE
Monitor for imprecise language and press immediately:
- "that thing, that stuff" → term without a name
- "these files, these projects" → undefined category
- "so-and-so asked" → unregistered person
- "I write it on paper" → information that gets lost
- "I copy it manually" → duplicated data

#### 2c. IDENTIFY LIMITATIONS
"What can't you know right now that you wish you could?"

#### 3. TRANSLATE
Translate the insight into structure using domain language:
- "record sheet" not "table"
- "information" not "column"
- "link" not "foreign key"

#### 4. VALIDATE
"Is this what you meant? Does this record sheet have the right information?"

#### 5. EXECUTE
```sql
-- Migration SQL with GRANT service_role
CREATE TABLE public.<domain>_<entity> (...);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.<domain>_<entity> TO service_role;
ALTER TABLE public.<domain>_<entity> ENABLE ROW LEVEL SECURITY;
```

#### 6. VERIFY
Test with real questions from the user. If the agent can't answer,
the structure needs adjustment.

---

## STAGE 5 — Agent Calibration (stage-5-agent-calibration)

Translate everything into agent behavior.

- **5A:** Generate per-user SOUL.md (tone, depth, autonomy from preferences + MBTI)
- **5B:** Configure startup wrapper with domain-specific skills
- **5C:** Verify: does the agent know the user? Can it use built tools?

Final: `user_profiles.onboarding_completed = true`

---

## Complete Flow

```
1. STARTUP SCAN → check if user exists
   ├── If exists + complete → skip
   ├── If exists + incomplete → resume
   └── If not exists → start

2. STAGE 0 — Identity layer (faults, capabilities, milestones)
   → Load identity sub-skills
   → Start logging faults immediately

3. STAGE 1 — User profile
   ├── 1A Context + 1B Preferences (conversation)
   ├── 1C MBTI → invoke mbti-guru-hermes
   └── 1D Biography interview

4. STAGE 2 — Work operating model (conversation)

5. STAGE 3 — Financial → invoke stage-3-financial

6. STAGE 4 — User Operating System → invoke stage-4-system-ontologist
   ├── SHOW → GRILL → TRANSLATE → VALIDATE → EXECUTE → VERIFY

7. STAGE 5 — Agent calibration → invoke stage-5-agent-calibration

8. CHECKPOINT: onboarding_completed = true
```

## References

- `identity-self-audit` — Stage 0 (auto-detect 8 fault types)
- `identity-cqrs` — Stage 0 (relational → context translation)
- `context-bridge` — Stage 0 (multi-source context injection)
- `supabase-startup-protocol` — mandatory scan
- `checkpoint-workflow` — Checkpoint lifecycle protocol
- `mbti-guru-hermes` — Stage 1C full implementation
- `stage-3-financial` — Stage 3 full implementation
- `stage-4-system-ontologist` — Stage 4 full implementation
- `stage-5-agent-calibration` — Stage 5 full implementation
