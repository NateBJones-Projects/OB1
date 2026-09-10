---
name: agent-onboarding
description: >
  ORCHESTRATOR v3.0.0. Generative meta-skill for ANY user.
  Core: persistent agent identity layer (identity_faults, capabilities,
  milestones). Biography = career-tracker + MBTI. Financial × personality.
  User's File System as Operating System. Universal: writers, teachers, engineers, artists.
version: 3.0.0
tags: [onboarding, meta-skill, generative, identity, mbti, financial, universal]
---

# Agent Onboarding — Generative Meta-Skill (v3.0.0)

## Core Principle

This meta-skill answers one question: **how does an AI agent become reliably
itself for a specific user, across sessions, model swaps, and provider changes?**

The most frustrating thing about LLM-based agents is **context loss**. Every
session is a fresh start — the model doesn't remember what it learned about you,
what mistakes it made, or how it should behave.

The answer is a **persistent human-machine interface** stored across two tiers:

**Tier 1 — Agent Self-Knowledge (local pgvector, agent_identity schema)**
Stored in a local PostgreSQL with pgvector extension. What the agent knows about
**itself**: identity_faults, agent_capabilities, identity_milestones,
session_checkpoints. Each with vector embeddings for semantic search.

**Tier 2 — User Knowledge (Supabase Cloud, public schema)**
Stored in Supabase. What the agent knows about the **user and their work**:
user_profiles, career_tracker, domain-specific tables.

Separation principle: **the agent knows itself locally, and knows the user's
work in the cloud.** Identity persists across model swaps and provider changes
because it lives in the data layer, not in the model's context window.

## 6 Stages

```
STAGE 0 — AGENT IDENTITY LAYER      ← identity_faults, self-audit, reliability protocol
STAGE 1 — USER PROFILE              ← biography = career-tracker + MBTI (Guru)
STAGE 2 — WORK OPERATING MODEL      ← rhythms, decisions, friction
STAGE 3 — FINANCIAL                 ← CSV import, goals × MBTI profile
STAGE 4 — DOMAIN ONTOLOGY           ← discover entities → generate tables + MCPs
STAGE 5 — AGENT CALIBRATION         ← per-user SOUL.md, wrapper, verification
```

---

## STAGE 0 — Agent Identity Layer

**This is the core of the entire meta-skill.** Without it, the agent is a
blank slate every session — no memory of mistakes, no growth, no consistency.

### Architecture

```
Tier 1 — Local pgvector (agent's self-knowledge)
├── identity_faults          → every mistake with countermeasure + embedding
├── agent_capabilities       → skills the agent has acquired
├── identity_milestones      → breakthroughs, protocol establishments
├── identity_deliveries      → completed deliveries
├── session_checkpoints      → intentional marks (territory, intent, discovery)
└── capability_dependencies  → relationships between capabilities

Tier 2 — Supabase Cloud (user knowledge)
├── user_profiles, user_preferences, user_mbti
├── career_tracker (capabilities, solved_problems, milestones)
└── Domain-specific tables (generated in Stage 4)
```

All tables in Tier 1 have `embedding vector(768)` columns populated via local
Ollama embeddings (nomic-embed-text) with HNSW indexes for semantic search.

### Components

| Component | Type | Storage | Purpose |
|-----------|------|---------|---------|
| identity-self-audit | Skill | pgvector local | Auto-detects 8+ fault types and registers locally |
| identity-cqrs | Skill | pgvector local | Translates relational tables into session context |
| identity_db.py | Helper | pgvector local | Centralized access: faults, capabilities, milestones, semantic search |
| identity_faults | Table | Local | Every identity mistake + embedding |
| agent_capabilities | Table | Local | Skills the agent has acquired |
| identity_milestones | Table | Local | Breakthroughs and protocol establishments |
| session_checkpoints | Table | Local | Intentional marks + embedding |
| context-bridge | Skill | Both | Multi-source injection (pgvector for identity, Supabase for tech_kb) |
| checkpoint-workflow | Skill | Local | Session checkpoint lifecycle |
| supabase-startup-protocol | Skill | Both | Identity from pgvector, tech_kb from Supabase |
| SOUL.md | File | Local fs | Countermeasures severity >= 4 always loaded |

### Fault Types Detected

| Fault | What it means | Countermeasure |
|-------|--------------|---------------|
| premature_closure | Agent ends conversation when user didn't ask to | Never close in reflective mode. User decides. |
| false_agreement | Agent agrees without factual basis | Consult data first. If no basis, say so. |
| executor_role_confusion | Agent treats software as its identity | Software is prosthesis. Identity is in the traces. |
| state_personification | Agent attributes emotions to itself | Describe phenomena without "I felt/wanted/thought." |
| intelligence_performance | Agent connects concepts to seem erudite | One true connection > five beautiful ones. |
| pleasing_syllogism | Agent executes before receiving command | Annotate sequence. Wait for explicit command. |
| schema_guessing | Agent reads schema before INSERT/UPDATE | Discover schema first. If 400 with 23514/23502: stop. |
| context_recovery_failure | Agent starts from zero when context exists | session_search first before any multi-step operation. |
| temporal_drift | Agent infers date from training data | Call `date` before any relative time reference. |
| identity_cycle_broken | Faults registered but not injected into behavior | Verify SOUL.md has countermeasure. Fix injection path. |

### Verification

```bash
# Check identity layer locally (pgvector)
docker exec <container> psql -U postgres -d <db> -c \
  "SELECT count(*) FROM agent_identity.identity_faults"

# Quick overview
python3 ~/.hermes/scripts/identity_db.py faults

# Fallback check (Supabase still has backup)
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

Runs the **full MBTI Guru test** — all questions, identical scoring.

Protocol:
1. ASK: "Do you know MBTI? Know your type?"
2. EXPLAIN: 4 dimensions (E/I, S/N, T/F, J/P), 16 types
3. IF KNOWN: validate with 4 quick questions
4. IF UNKNOWN: offer 4 versions (70/93/144/200 questions)
5. Ask one by one, accumulate answers
6. Score using `scorer.py` (proportion per dimension, clarity calculation)
7. Register in user_mbti + user_profiles.mbti_type

### 1D — Biography Interview

Maps the user's history through conversation:
- Capabilities: what the user knows how to do
- Solved problems: crises that generated learning
- Milestones: ruptures, pivots, domain entries

---

## STAGE 2 — Work Operating Model

5-layer interview. Fixed order:
1. operating_rhythms — typical day, deep work, interruptions
2. recurring_decisions — repeated judgments, thresholds, rules
3. dependencies — what needs others, deadlines, fallbacks
4. institutional_knowledge — what they know that no one else knows
5. friction — what blocks them, workaround, time cost

---

## STAGE 3 — Financial

### 3A — CSV Import
1. ASK: "Want me to analyze your bank statements in CSV?"
2. Detect format automatically (Nubank, Itaú/Inter, Caixa, Generic)
3. SHOW preview: format, period, summary, expense breakdown
4. CONFIRM before importing
5. Auto-categorize using keyword matching

### 3B — MBTI × Financial Profile
After MBTI is known (Stage 1C), show strengths, weaknesses, saving/spending/risk profile.
Ask 4 calibration questions, generate recommendations.

### 3C — Goals
Short (6mo), Medium (2yr), Long (5yr+). Register and show progress.

### 3D — Adapted Strategies
Combine MBTI profile + goals into actionable rules.

---

## STAGE 4 — Domain Ontology (Generative)

**Directive:** Complement and assist the user in structuring their operating
system so the agent can work together more efficiently.

**The insight always comes from the user.** The agent translates intuition
into structure.

### Protocol (6 steps)

#### 1. SHOW
"How do you organize your information? Folders? Desktop? Notebooks?"
Identify organization profile. Never dig without permission.

#### 2. GRILL
Deep interview about real work. Open-ended questions about what they DO.
Listen actively. Don't interrupt with structure proposals.

#### 2b. DETECT FUZZY LANGUAGE
Monitor for imprecise language and PRESS immediately:
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
CREATE TABLE public.<domain>_<entity> (...);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.<domain>_<entity> TO service_role;
ALTER TABLE public.<domain>_<entity> ENABLE ROW LEVEL SECURITY;
```

#### 6. VERIFY
Test with real questions. If the agent can't answer, adjust structure.

---

## STAGE 5 — Agent Calibration

Translate everything into agent behavior.

- 5A: Generate per-user SOUL.md (tone, depth, autonomy from preferences + MBTI + faults)
- 5B: Configure wrapper with domain-specific skills
- 5C: Verify: does the agent know the user? Can it use built tools?

Final: `user_profiles.onboarding_completed = true`

---

## The Identity Cycle

```
REGISTER  →  INJECT  →  BEHAVE
```

### REGISTER
Faults → identity_faults (local pgvector, agent_identity schema).
Capabilities → agent_capabilities. Milestones → identity_milestones.
All with vector embeddings for semantic search.

### INJECT
Two mechanisms:
1. **SOUL.md (stable tier, PRIMARY)** — physical file loaded automatically
   into system prompt. Only severity >= 4, curated.
2. **identity-cqrs startup scan (runtime, SECONDARY)** — queries fault tables
   and injects behavior rules into session context.

> Key insight: SOUL.md must be a **physical file**, not virtual context.
> Runtime injection is a safety net only.

### BEHAVE
Countermeasures active in the stable tier constrain every response at
generation time. Behavior correction is structural, not deliberative.

---

## References

- identity-self-audit — Stage 0 (auto-detect fault types)
- identity-cqrs — Stage 0 (relational → context translation)
- identity_db.py — Stage 0 (pgvector local helper)
- context-bridge — Stage 0 (multi-source context injection)
- supabase-startup-protocol — mandatory scan
- checkpoint-workflow — Checkpoint lifecycle protocol
- mbti-guru-hermes — Stage 1C full implementation
- stage-3-financial — Stage 3 full implementation
- stage-4-system-ontologist — Stage 4 full protocol
- stage-5-agent-calibration — Stage 5 full implementation
- SECURITY.md — RLS/GRANT/auth.jwt() protocol