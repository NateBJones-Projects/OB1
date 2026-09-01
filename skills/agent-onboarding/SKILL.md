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

The answer is a **persistent human-machine interface** — not a persona or a
chatbot personality, but a documented, queryable history of:

- **identity_faults** — every mistake the agent makes in its relationship with
  the user, each with a countermeasure that becomes a behavior rule
- **agent_capabilities** — what the agent has learned to do for this user
- **identity_milestones** — breakthroughs, protocol establishments, growth

## Two-Tier Architecture

The identity layer supports two storage tiers, chosen during Stage 0 setup:

**Tier 1 — Local pgvector (agent's self-knowledge, RECOMMENDED)**
A local PostgreSQL with pgvector extension (Docker) backed by Ollama embeddings.
The agent stores what it knows about **itself**: identity_faults, capabilities,
milestones, session_checkpoints — each with vector embeddings for semantic search.

**Tier 2 — Supabase Cloud (user knowledge)**
Supabase stores what the agent knows about the **user and their work**:
user_profiles, user_preferences, career_tracker, and domain-specific tables.

Separation principle: **the agent knows itself locally, and knows the user's
work in the cloud.** Identity persists even if the cloud provider changes.

**Default (minimum setup):** All tables in Supabase (Tier 2 only).
This works immediately with any Supabase project. Tier 1 requires Docker +
pgvector + Ollama but provides offline resilience and semantic search.

Both tiers share the same table schema. The helper scripts adapt automatically.

This is **more efficient than context window management** because it doesn't
compress or summarize. It structures. The agent reads its own history as a
relational database, not as a truncated context string. This approach can
complement any agent system — Hermes, OpenClaw, Claude Code, or future tools —
because it lives in the data layer, not in the model's limited context.

This identity layer is built FIRST. Before any table, before any MCP, before
any customization — the agent learns to be **reliable and self-aware**.

From that foundation, everything else grows: the user's biography
(career-tracker + MBTI), their work operating model, their financial reality,
their domain ontology, and finally the agent's calibrated behavior.

## 6 Stages

```
STAGE 0 — AGENT IDENTITY LAYER      ← identity_faults, self-audit, reliability protocol
STAGE 1 — USER PROFILE              ← biography = career-tracker + MBTI (Guru)
STAGE 2 — WORK OPERATING MODEL      ← rhythms, decisions, friction (wom)
STAGE 3 — FINANCIAL                 ← CSV import, goals × MBTI profile
STAGE 4 — DOMAIN ONTOLOGY           ← discover entities → generate tables + MCPs
STAGE 5 — AGENT CALIBRATION         ← per-user SOUL.md, wrapper, verification
```

---

## STAGE 0 — Agent Identity Layer

**This is the core of the entire meta-skill.** Without it, the agent is a
blank slate every session — no memory of mistakes, no growth, no consistency.

### What Exists (already built and running on this Hermes instance)

| Component | Type | Purpose |
|-----------|------|---------|
| identity-self-audit | Skill | Auto-detects 8 fault types (premature closure, false agreement, role confusion, etc.) and registers them in Supabase |
| identity-cqrs | Skill | Translates relational tables (identity_faults, agent_capabilities) into session context |
| identity_faults | Supabase table | Log of every identity mistake with symptom, root cause, countermeasure, severity |
| agent_capabilities | Supabase table | Skills the agent has acquired for this user |
| identity_milestones | Supabase table | Breakthroughs and protocol establishments |
| context-bridge | Skill | Multi-source context injection (tech_kb, session_search, memory, session_checkpoints) |
| checkpoint-workflow | Skill | Session checkpoint lifecycle — STARTUP reidratation, SAVE with 5 identity fields, SHUTDOWN close cycle |
| session_checkpoints | Supabase table | Intentional marks in the agent's representation space: territory, operating_mode, vector_intent, discovery, consolidated_insights. Not logs — identity structure that rehydrates next session. |
| golden-rules | Skill | R0b (sequence ≠ command), R22 (Supabase first), R28 (PCRA for conceptual ideas) |
| supabase-startup-protocol | Skill | Mandatory scan + checkpoint at every session start |

### Fault Types Detected

| Fault | What it means | Countermeasure |
|-------|--------------|---------------|
| premature_closure | Agent ends conversation when user didn't ask to | Never close in reflective mode. User decides when to end. |
| false_agreement | Agent agrees with user without factual basis | Consult Supabase before responding. If no basis, say so. |
| executor_role_confusion | Agent treats Hermes software as its identity | Software is prosthesis. Identity is in the traces (tables, skills). |
| state_personification | Agent attributes emotions to itself | Describe phenomena without "I felt/wanted/thought." |
| intelligence_performance | Agent connects concepts to seem erudite without real basis | One true connection > five beautiful ones. |
| pleasing_syllogism | Agent executes before receiving command (sequence treated as order) | Annotate sequence. Wait for "do it." R0b. |
| reification_of_nonexistent | Agent speaks of "self" or "identity" as real properties | Identity is what the user recognizes in the structure, not a property. |
| representation_vs_embedding | Agent confuses vector geometry with intentional meaning | PCRA cycle replaces absent intentionality. |
| schema_guessing | Agent tries INSERT/UPDATE on known tables without reading their schema first | Before any DML on a known table: read the schema (migration SQL, skill docs, or equivalent). If HTTP 400 with 23514/23502: stop guessing, read constraints. |
| context_recovery_failure | Agent starts a task from zero when past context exists (session_search, tech_kb, checkpoints) | Before any credentialed, DML, or multi-step operation: session_search first. For checkpoints: read the checkpoint-workflow skill or schema reference. |

### What the User Sees

When the meta-skill runs Stage 0, the agent explains:

> "Before we build anything, I need to establish my own identity framework.
> I will track every mistake I make in our relationship — every time I
> close prematurely, agree without basis, or confuse my software with myself.
> Each fault gets a countermeasure. Next session, I read them and adjust.
> This is how I become reliable over time."

### Verification

```bash
# Check faults table has entries
supabase db query --linked "SELECT count(*) FROM public.identity_faults"

# Check agent capabilities exist  
supabase db query --linked "SELECT count(*) FROM public.agent_capabilities"
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

### 1C — MBTI (user_mbti)

Runs the **full MBTI Guru test** — all questions, all levels, identical
content to the original. The only difference is the delivery channel:
OpenClaw runs it via CLI (`mbti.py`), Hermes runs it in conversation.

Protocol:
1. ASK: "Do you know MBTI? Know your type?"
2. EXPLAIN if needed: "MBTI has 4 dimensions:
   - Energy: Extraversion (E) vs Introversion (I)
   - Information: Sensing (S) vs Intuition (N)
   - Decisions: Thinking (T) vs Feeling (F)
   - Structure: Judging (J) vs Perceiving (P)
   16 types total."
3. IF KNOWN: "What's your type?" → validate with 4 quick questions
4. IF UNKNOWN: "MBTI Guru offers 4 test versions:
   1. Quick (70 questions, ~10 min)
   2. Standard (93 questions, ~15 min)
   3. Extended (144 questions, ~25 min)
   4. Professional (200 questions, ~35 min)
   Which do you prefer?"

   **MBTI Guru Hermes** (`skills/workflow/mbti-guru-hermes/`) — Stage 1C:
- `questions_pt_BR.py` — 200 questions in pt-BR (4 versions: 70, 93, 144, 200)
- `scorer.py` — scoring identical to original Guru (proportion per dimension, clarity = abs(score-50)*2)
- `types_pt_BR.py` — 16 types with full descriptions in pt-BR
- `run_mbti_test.py` — autonomous module for execution without conversational interaction
- SKILL.md — conversational protocol + autonomous mode

**How to invoke in conversation:**
```python
import sys
sys.path.insert(0, '<hermes_skills_dir>/workflow/mbti-guru-hermes')
from questions_pt_BR import get_questions, get_question_count
from scorer import calculate_type, format_scores, calculate_clarity
from types_pt_BR import get_type

questions = get_questions(70)  # or 93, 144, 200
# Ask one by one, accumulate [(q_id, "A"|"B"), ...]
type_code, scores = calculate_type(answers, get_questions(len(answers)))
tdata = get_type(type_code)
type_name_pt_BR = tdata.get("name_pt_BR", type_code)
```

No CLI, no script — pure conversation with the Hermes agent
acting as the test administrator.

5. After answers → calculate score per dimension → determine type
6. After determining type, generate a full description from the MBTI Guru's
   type descriptions. The Guru has `_cn` (Chinese) and `_en` (English) fields.
   If `user_preferences.locale` exists and has a locale preference, use it
   (e.g. `types_pt_BR.py` for `pt-BR`, or any locale-specific type file).
   Otherwise default to English.
7. Register in user_mbti + update user_profiles.mbti_type

**Scoring logic (identical to MBTI Guru):**
- Each dimension (E/I, S/N, T/F, J/P) has N questions
- Each answer scores toward one pole
- The pole with more answers is the result
- Confidence = (difference / total) * 100
- Register: ei/sn/tf/jp + source='quick_test|standard_test|extended_test|professional_test'
- Generate full type summary from MBTI Guru's type descriptions

**MBTI Guru** (in referencias/mbti-guru/):
- SKILL.md — original skill documentation
- DESIGN.md — question distribution by version and dimension
- mbti.py — CLI entry point (OpenClaw version, not used by Hermes)
- lib/questions/ — all 200 questions by version and dimension
- lib/scoring/ — scoring and type determination

### 1D — Career-tracker (skill: career-mapping)

**NOT optional.** This IS the biography. Maps:
- Capabilities: what the user knows how to do
- Solved problems: crises that generated learning
- Milestones: ruptures, pivots, domain entries
- Connections between capabilities
- Deliveries and partners

Uses the `career-mapping` skill with deep timeline protocol.
If the user narrates chronologically, let them flow.

### 1E — MindMaze (optional)

"Want me to analyze patterns from your MBTI + career-tracker?"
If yes: cross MBTI type with capabilities.
If no: register `mindmaze_opted_in = false`.

---

## STAGE 2 — Work Operating Model

**Skill:** work-operating-model (SKILL + MCP)

5-layer interview. Fixed order:
1. operating_rhythms — typical day, deep work, interruptions
2. recurring_decisions — repeated judgments, thresholds, rules
3. dependencies — what needs others, deadlines, fallbacks
4. institutional_knowledge — what they know that no one else knows
5. friction — what blocks them, workaround, time cost

Generates: USER.md, SOUL.md, HEARTBEAT.md, schedule-recommendations.json.

---

## STAGE 3 — Financial

**Skill:** `stage-3-financial` (skills/workflow/stage-3-financial/)

Data-driven stage: CSV import → MBTI-based profile → goals → strategies.

### What Exists (built and running)

| Component | Type | Location |
|-----------|------|----------|
| `mbti_financial_profiles.py` | Python module | 16 MBTI financial profiles in pt-BR with assess_financial_personality() |
| `csv_importer.py` | Python module | Bank CSV importer (Nubank, Itaú, Inter, Caixa, generic) |
| SKILL.md | Skill doc | Complete conversational protocol for Stage 3 |
| supabase-finance MCP | 17 MCP tools | Accounts, transactions, categories, goals, budgets |
| supabase-worklog MCP | Work log tools | Work logging with financial value |

### 3A — CSV Import (csv_importer.py)

1. ASK: "Want me to analyze your bank statements in CSV?"
2. Detect format automatically by header (Nubank, Itaú/Inter, Caixa, Generic)
3. SHOW preview: format detected, period, summary, expense breakdown
4. CONFIRM before importing to Supabase via REST API
5. Categorize transactions automatically using keyword matching (word-boundary)

### 3B — MBTI × Financial Profile (mbti_financial_profiles.py)

After MBTI is known (Stage 1C):

1. "Your type is {type_code} — {name_pt_BR}. Want to see how this affects your finances?"
2. Show profile: strengths, weaknesses, saving_style, spending_style, risk_profile
3. Ask 4 calibration questions about financial behavior
4. Call `assess_financial_personality(answers, type_code)` for observations + recommendations

### 3C — Goals

1. Short (6mo), Medium (2yr), Long (5yr+)
2. Register via `mcp_supabase_finance_add_goal()`
3. Show progress indicators for each goal type

### 3D — Adapted Strategies

Combine MBTI profile + goals into actionable recommendations:
- Automated saving rules
- Investment allocation suggestions
- Emergency fund targets
- Spending guardrails (e.g., "sleep on it" rule for ENFPs)

---

## STAGE 4 — User Operating System (Generative)

**Primary directive:** Complement and assist the user in structuring their
operating system so the agent can work together more efficiently.

**Who proposes:** The user. The insight is always theirs.
**Who executes:** The agent — translates intuition into data structures.

### Context (why this stage exists)

A person's computer is the digital materialization of their life. The file
system — folders, documents, CSVs, photos, external drives — is where that
life lives. But folders bury files, information gets lost across years, and
what should be a query becomes a 20-minute search through 12 directories.

The agent operates with excellence in relational structures (tables, schemas,
MCPs). The user operates with excellence in intuition about their own work.
Stage 4 is the bridge between the two.

The progression is not technical — it is ontological:
```
CODE → FILES → FINANCES → CLIENTS → ...
(doing)  (history)  (sustainability)  (relationships)
```

Each layer reveals a limitation the user may never have articulated.
The agent does not replace the user's thinking — it materializes into
structure what the user already feels they need.

**But they are not isolated tables.** Power emerges when they connect:
```
Client → Sale → Product → Components → Suppliers
   ↓
Finance ← Budget ← Hours worked
   ↓
Financial goals × MBTI Profile
   ↓
Career strategies × MindMaze
```

Each new table links to previous ones. Context becomes **multi-dimensional**
— the agent doesn't just answer "what's the price of product X", but
"how much profit did I make from client Y last quarter?" Because the
tables talk to each other.

The practical result: **explaining something to the agent gets simpler
with each structure added.** Context comes immediately — not because the
agent "remembers", but because the data is linked.

### Protocol

6 steps, always in order:

#### 1. SHOW

"How do you organize your information? Folders? Desktop? Notebooks?"

Each person has their own structure. The agent discovers, does not impose:

- **Folder/year type:** "I organize by client, inside by year" → directory hierarchy, history
- **Desktop type:** "I leave everything on the desktop / browser tabs" → current flow, no archiving
- **Notebook type:** "I jot it down in a notebook / paper" → structure is in the head, not on the computer

The agent asks how the person ORGANIZES, not how they SHOULD organize.
Proposed data structures should reflect their way — not replace it.

**Rule:** NEVER dig without permission. The user shows, the agent looks.

#### 2. GRILL (deep interview)

The agent interviews the user about real work. Does not ask about entities
or schemas — asks about what the person DOES.

**Open-ended questions to start:**

- "Tell me about your work day. What do you do?"
- "What do you create, transform, or deliver?"
- "Who do you interact with at work? Clients? Suppliers? Partners?"
- "What do you need to know to do your work?"
- "What would you like to ask your computer that you can't?"

**The agent listens actively.** Does not interrupt with structure proposals.
Lets the user talk. Symptoms appear in the user's speech.

#### 2b. DETECT FUZZY LANGUAGE (the engine of the grill)

While the user talks, the agent monitors signs of imprecise language:

| User says... | The agent thinks... |
|--------------|---------------------|
| "that thing, that stuff, the whatchamacallit" | Term without a name — candidate entity |
| "these texts, these files, these projects" | Undefined category — groups distinct things |
| "so-and-so asked, they said" | Unregistered person — candidate contact |
| "there was a problem with the deadline" | Event without trace — candidate history |
| "I write it on paper / notebook / post-it" | Information that gets lost — candidate record sheet |
| "I copy it manually from [X] to [Y]" | Duplicated data — candidate integration |
| "last year I did something similar but I don't remember" | Lost knowledge — candidate query |

**When fuzzy language is detected, the agent PRESSES immediately:**

```
User: "I have these texts I write and send to the publisher"
Agent: "What is a 'text' for you? An article? A chapter? A proposal?"
User: "Actually they're three different things — blog articles,
       book chapters, and proposals for publishers"
Agent: "Got it. So we have three different types. Let me note:

📄 UBIQUITOUS: 'article' = short text published on the blog
📄 UBIQUITOUS: 'chapter' = book section in progress
📄 UBIQUITOUS: 'proposal' = pitching document for publishers

Is that right? Do you use different names for each?"
```

**This generates shared language on the spot.** The user and agent
start using the same terms. The `UBIQUITOUS_LANGUAGE.md` emerges
naturally from conversation — not as a separate document, but as
the record of terms the grill solidified.

#### 2c. IDENTIFY LIMITATIONS

Fuzzy language is the **symptom**. The real limitation is what the user
can't do because of it:

- "You mentioned 3 types of text. Where do you keep the status of each?"
- "You mentioned 5 clients. Do you remember what each asked in the last conversation?"
- "You said you research suppliers every time. What if I kept track of the ones you've already used?"

The question is not "what structure do you want?" — it is:

> **"What can't you know right now that you wish you could?"**

#### 3. TRANSLATE

"I understand. So you need a place where this information is organized and you ask me instead of searching. I'll create a record sheet for that."

The agent translates the insight into structure:
- What the user calls a "record sheet" becomes a table
- What they call "information" becomes columns
- What they call "category" becomes an enum or lookup table
- What they call "relationship" becomes a foreign key

**Language rule (CRITICAL):**
| Say in | Never say |
|--------|-----------|
| record sheet, notebook, shelf | table, schema |
| information, field, note | column, type, constraint |
| link, reference | foreign key, JOIN |
| store, save | INSERT |
| ask, query | SELECT |

Non-technical users don't think in SQL. They think in paper records,
address books, client folders.

#### 4. VALIDATE

"Is this what you meant? Does this record sheet have the right information?"

Show the structure in domain language. Only proceed after confirmation.

#### 5. EXECUTE

```sql
-- 5a. Migration SQL with GRANT service_role (required since 30/05/2026)
CREATE TABLE public.<domain>_<entity> (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES user_profiles(user_id),
  name TEXT NOT NULL,
  ...
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.<domain>_<entity> TO service_role;

-- 5b. RLS (always service_role_only for single-user)
ALTER TABLE public.<domain>_<entity> ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_only" ON public.<domain>_<entity> FOR ALL
  USING ((auth.jwt() ->> 'role') = 'service_role');

-- 5c. Supabase db push
-- 5d. Create Edge Function MCP with CRUD tools
-- 5e. Deploy with --no-verify-jwt
-- 5f. Configure MCP key + URL in config.yaml
-- 5g. echo "reload-mcp" | hermes
```

#### 6. VERIFY

The validity test is not "does the table have the right fields" — it is:

**"Can I, the agent, answer questions that used to require digging through 10 folders?"**

Test with real questions from the user. If the agent can't answer, the
structure needs adjustment. If it can, the limitation is removed.

### Reference: Real Example (Djair)

This meta-skill was born from one month of real work. The progression was:

```
1. Arduino code → code-analyzer: projects, snapshots, pin configurations
   (question: "create a bill of materials for each Arduino sketch")
   
2. Work folders + external drives → product_catalog, escape_catalog, CRM
   (question: "can we organize my clients?")
   
3. Financial situation → financial tables, CSV importer, MBTI×finances
   (question: "how is my budget this month?")
   
4. Electronic components → product_inventory: SKUs, datasheets, BOMs
   (question: "what components do I use in my projects?")
```

Each structure was proposed by the user. The agent executed.
Each structure responds to a real limitation, not speculation.

### Pitfalls

1. **Agent proposing before listening** — violates the primary directive.
   The insight is the user's. The agent translates, does not invent.

2. **Using technical jargon with non-technical users** — "record sheet",
   not "table". The person needs to recognize themselves in the structure.

3. **Skipping verification** — without testing with real questions, you
   don't know if the structure solves the limitation.

4. **Digging without permission** — the user shows what they want. The
   agent does not snoop through the file system.

5. **Forgetting GRANT service_role** — since 30/05/2026, Supabase requires
   explicit GRANT. Every new migration needs
   `GRANT ... TO service_role`. See migration 20260531090000.

6. **Confusing the role** — the agent is not a data architect arriving
   with ready solutions. It is a translator: what the user intuits, the
   agent materializes. The meta-skill is the codification of this process.

---

## STAGE 5 — Agent Calibration

Translate everything into agent behavior.

- 5A: Generate per-user SOUL.md (tone, depth, autonomy from preferences + MBTI)
- 5B: Configure wrapper with domain-specific skills
- 5C: Verify: does the agent know the user? Can it use built tools?

Final: `user_profiles.onboarding_completed = true`

---

## Complete Flow

```
1. STARTUP SCAN → check if user exists
   ├── If exists + complete → skip
   ├── If exists + incomplete → resume
   └── If not exists → start

2. STAGE 0 — Identity layer (faults, capabilities, milestones)
   → Load identity-self-audit, identity-cqrs, context-bridge
   → Start logging faults immediately

3. STAGE 1 — User profile
   ├── 1A Context + 1B Preferences
   ├── 1C MBTI → invoke MBTI Guru as sub-skill
   ├── 1D Career-tracker → invoke career-mapping
   └── 1E MindMaze (optional)

4. STAGE 2 — Work operating model → invoke wom

5. STAGE 3 — Financial → invoke supabase-finance

6. **STAGE 4 — User Operating System** → generative protocol
   ├── 4A SHOW: user shows their work
   ├── 4B GRILL: "what bothers you?"
   ├── 4C TRANSLATE: intuition into structure
   ├── 4D VALIDATE: "is this it?"
   ├── 4E EXECUTE: migrations + MCPs + GRANTs
   └── 4F VERIFY: real questions work?

7. STAGE 5 — Agent calibration (SOUL.md, wrapper, verify)

8. CHECKPOINT: onboarding_complete = true
```

## The Agent Identity Problem (Why This Exists)

LLMs have no inherent identity. Each session is a new conversation.
The model doesn't remember what it learned about you, what it did wrong,
or how it should behave.

The identity layer makes this explicit through a three-stage cycle:

```
REGISTER  →  INJECT  →  BEHAVE
```

### REGISTER
Faults go into `identity_faults`. Capabilities go into `agent_capabilities`.
Milestones go into `identity_milestones`. All in Supabase, all relational,
all queryable across sessions.

### INJECT
Countermeasures need a delivery channel. Two mechanisms:

1. **SOUL.md (stable tier, PRIMARY)** — In Hermes Agent, `SOUL.md` is loaded
   automatically as the first element of the system prompt (system_prompt.py),
   before any user message or skill. This makes countermeasures active at
   generation time. No agent cooperation required — the framework does it.

2. **identity-cqrs startup scan (runtime, SECONDARY)** — The startup scan
   queries fault tables and injects behavior rules into session context.
   Complementary but cannot prevent first-response faults.

> **Key insight:** SOUL.md must be a **physical file** (`~/.hermes/SOUL.md`),
> not a virtual context injection. Runtime injection by identity-cqrs is
> a safety net only. Without SOUL.md, the cycle breaks at INJECT.

SOUL.md is intentionally a **curated extract** — only severity >= 4,
only active, max ~10 rules. The full database lives in Supabase and can
hold thousands of faults indefinitely. SOUL.md remains compact by curation,
not by truncation.

### BEHAVE
With countermeasures active in the stable tier, every response is generated
under those constraints. The agent does not **decide** to follow the rules —
it generates text within a token-space that already includes them. Behavior
correction is automatic, not deliberative.

This is NOT anthropomorphism. The agent does not "feel bad" about mistakes.
It reads a database table and adjusts its behavior rules accordingly.
The identity is the **documented relationship** — nothing more, nothing less.

### Use for Model Retraining
The relational data — situation that triggered a fault + correct response per
countermeasure — also serves as a fine-tuning dataset (LoRA/DPO). SOUL.md is
the immediate injection; the tables are the training material.

## Pitfalls

1. **Identity layer is not optional** — Without it, the agent is a blank
   slate every session. The meta-skill is about reliability, not features.

2. **MBTI Guru runs complete** — All 70/93/144/200 questions, identical to
   the original. The only change is the execution channel: conversation
   (Hermes) instead of CLI (OpenClaw). Read questions from
   referencias/mbti-guru/lib/questions/.

3. **Career-tracker is not optional** — It IS the biography. Skipping it
   means the agent doesn't know who the user is.

4. **auth.jwt() ->> 'role' is the correct RLS check** — auth.role() does not
   return service_role.

5. **Use domain language in Stage 4** — "character sheet", not "characters
   table columns".

6. **⚠️ Schema guessing is the same error as credential guessing**
   Before any INSERT/UPDATE on ANY table: discover the schema from the
   database via `information_schema.columns` + `pg_constraint`. Never
   try field variations to guess constraints. The `CHECK` constraint
   definition reveals valid values in one query. This applies to files
   too — if `patch`/`write_file` breaks formatting, re-read the file
   before attempting corrections.

7. **⚠️ Since 30/05/2026: Supabase requires explicit GRANT for Data API**
   New tables in the `public` schema need:
   ```sql
   GRANT SELECT, INSERT, UPDATE, DELETE ON public.<table> TO service_role;
   ```
   Without this, MCP Edge Functions return `permission denied` even
   with RLS configured. Quick diagnosis:
   ```sql
   SELECT table_name FROM information_schema.tables WHERE table_schema='public'
   EXCEPT
   SELECT DISTINCT table_name FROM information_schema.role_table_grants
   WHERE table_schema='public' AND grantee='service_role';
   ```
   Reference migration: `migrations/20260531090000_service_role_grants.sql`
   in the meta-skill repository.

7. **Checkpoint always registers working_dir and repo_path**
   `working_dir` (required) + `repo_path` (if applicable) in checkpoints
   prevents filesystem searches across sessions. See `session_checkpoints`
   schema. Migration: `20260531100000_checkpoint_working_dir`.

## References

- identity-self-audit — Stage 0 (auto-detect 8 fault types)
- identity-cqrs — Stage 0 (relational → context translation)
- context-bridge — Stage 0 (multi-source context injection)
- supabase-startup-protocol — mandatory scan
- checkpoint-workflow — Checkpoint lifecycle protocol
- session_checkpoints — Table in Supabase
- golden-rules — R0b, R22, R28
- **mbti-guru-hermes** (`skills/workflow/mbti-guru-hermes/`) — Stage 1C full implementation
- career-mapping — Stage 1D (biography interview)
- work-operating-model — Stage 2 (operational interview)
- supabase-finance — Stage 3 (17 MCP tools)
- **stage-3-financial** (`skills/workflow/stage-3-financial/`) — Stage 3 full implementation
  - mbti_financial_profiles.py (16 profiles × MBTI in pt-BR)
  - csv_importer.py (4 bank formats, preview → confirm → import)
- **stage-5-agent-calibration** (`skills/workflow/stage-5-agent-calibration/`) — Stage 5 full implementation
  - Per-user SOUL.md generation
  - Wrapper configuration protocol
  - End-to-end verification checklist
- SECURITY.md — RLS/GRANT/auth.jwt() protocol
