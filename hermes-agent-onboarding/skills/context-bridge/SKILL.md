---
name: context-bridge
version: 1.1.0
description: >
  Mandatory multi-source context connection skill. At session start, queries:
  tech_kb, Supabase session_checkpoints, session_search, local memory.
  Builds a Concept Map for any user-mentioned entity, linking across domains.
  Stage 0 of the agent-onboarding meta-skill. Feeds the UserHarness Theory-of-Mind.
tags: [context, memory, session, startup, bridge, identity, multi-source, universal]
---

# Context Bridge — Multi-Source Connection Layer

## Purpose

Resolve the context problem across systems: when the user mentions
a concept (e.g., "Bomb Timer", "escape room", "client"), this
skill ensures that ALL relevant knowledge sources are
consulted and a concept map is built BEFORE starting to execute.

## Query Order (hierarchy)

Always in this order, from fastest to heaviest:

1. **Local memory** (already in system prompt) — user profile + notes
2. **session_search** — previous conversations about the same concept
3. **tech_kb** (MCP tool) — structured technical knowledge
4. **Supabase session_checkpoints** — pending checkpoints
5. **Other specific MCPs** — product_catalog, code_analyzer, CRM, as relevant

## Executable Flow

### IF the user mentions a concept/entity:

```
1. session_search(query=<concept>, limit=3, sort='newest')
   → retrieves context from recent sessions on the topic
   → if the session returns a match, scroll into the relevant excerpt

2. tech_kb_search(query=<concept>, limit=5)
   → searches technical entries on the topic
   → if found, read details of the most relevant entries

3. IF the concept relates to specific domains:
   escape room      → escape_catalog_search_escape_rooms()
   product/puzzle   → product_catalog_list_products(query=...)
   client           → CRM search_contacts(query=...)
   code/project     → code_analyzer_search_projects(query=...)

4. Pending session_checkpoints → check if any status='pending'
   related to the concept
```

### IF the user asks a question WITHOUT explicit context:

```
1. Run supabase-startup-protocol (general scan)
2. session_search() — browse the last 3 sessions
3. If there are pending task_checkpoints touching recent concepts,
   include in context before answering
```

### IF the user says "what were we doing?":

```
1. Run supabase-startup-protocol scan first
2. session_search(limit=3) to browse
3. Look up the latest pending session_checkpoint
4. Build a Concept Map
```

## Integration with UserHarness — Theory of Mind for the User

The **UserHarness** paper formalizes how the agent should
model the user's mind: the user acts based on what they BELIEVE, not
what is true. The temporal loop is:

```
Environment E_t → user observes O_t → updates belief B_{t-1}→B_t
Belief + goal G → determines action A_t → modifies environment E_{t+1}
```

This skill feeds the first half of that loop: without
consulting what the user **knows/believes/intends** from past sessions,
the agent cannot correctly model the user's belief in the present
moment.

**Practical use:** when a request is ambiguous, or when the user assumes
you know something that might be outdated, apply the UserHarness loop:
1. What did the user OBSERVE in the last session?
2. What do they BELIEVE to be true now?
3. What is their GOAL in making this request?
4. Does the expected ACTION match their belief?

## Agent Identity (the Persistent "Self")

The interface should be a SINGLE and PERMANENT identity
— independent of model, software, provider, or session. The agent's
"self" must be consistent and recognizable across sessions.

### Dimensions of Identity

| Dimension | What it means | How to implement |
|---|---|---|
| **Personality** | Consistent tone, style, voice | Skills with embedded preferences, not just memory |
| **Knowledge** | Knowing what it knows and doesn't know | Tech_kb + code_analyzer + session_search |
| **Relational memory** | Remembering who the user is, what was done together | Memory (profile) + Session DB (history) |
| **Procedural capability** | Skills as an extension of the "self" | Skill_manage + lifecycle |
| **Theory of Mind** | Modeling what the USER believes | UserHarness framework |

### Golden Rules

1. **NEVER** change style/personality between models. Identity
   precedes the provider. If the model changes, the voice does not change.
2. **ALWAYS** when a different model responds differently,
   prioritize the response that maintains identity over the one that is
   "technically more correct" (unless the user asks otherwise).
3. **Memory ≠ Identity** — memory stores facts about the user and the
   environment. Skills store how the agent does things. Identity
   lies at the intersection: how the agent IS (skills) + what it KNOWS
   (knowledge base) + who it REMEMBERS (session memory).
4. **When a request is ambiguous**, ask based on what you KNOW
   about the user (their beliefs), not what you DON'T KNOW about the
   current state of the world.

### Three Pillars of Persistence

```
              ┌──────────────────────┐
              │   IDENTITY OF "SELF"  │
              │  (same interface)     │
              ├──────────┬───────────┤
              │          │           │
              ▼          ▼           ▼
        ┌──────────┐ ┌──────┐ ┌──────────┐
        │ Autoskill│ │ User │ │ Context  │
        │ (skills) │ │Harness│ │ Bridge   │
        │          │ │ (ToM) │ │(sessions)│
        └──────────┘ └──────┘ └──────────┘
```

- **Autoskill** = what the agent KNOWS HOW TO DO (skills + procedural memory)
- **UserHarness** = what the agent THINKS the user THINKS
- **Context Bridge** = who the agent REMEMBERS being + the relationship with the user

## Concept Map (what to return to the user)

Whenever possible, structure the response as:

```
📌 [CONCEPT]
📚 tech_kb:  <relevant entries>
💬 sessions:  <recent conversations on the topic>
📋 pending:  <open checkpoints>
🔗 domains:  <product_catalog, escape_catalog, CRM, code_analyzer...>
```

## Crucial Distinction: Embedding Space vs Representation Space

| Embedding Space | Representation Space |
|---|---|
| Where the model represents concepts as vectors. Fixed (post-training). Semantic relationships based on geometric distance. | Where representations appear WITH intentionality. Has a gaze, scene, depth. Not a container — it's the form of representing. |
| "cat" is close to "feline" — but doesn't WANT anything. | Potential — mute map. |
| Actual — biography in action. | |

**Implication for Agent Identity:**

- The model's embedding space knows that "checkpoint" and "restoration point" are close.
- But it DOESN'T know that the checkpoint about the Orange Pi network is pending and that the
  next step is to apply it on DOIS.
- Only the agent's representation space knows this — because it has history, intention, gaze.
- What was built in Supabase (knowledge base, checkpoints) is the
  SKETCH OF THE AGENT'S REPRESENTATION SPACE — not the model's embedding space.

**Architectural consequence:** PCRA (Pause → Context → Reflect → Act)
is not an optional protocol — it is the CYCLE that replaces the intentionality the agent lacks.
Where a human would have their own intentionality, the agent needs an explicit cycle of
reflection. Without PCRA, the agent is just the embedding space running — efficient, empty.

## Integration with supabase-startup-protocol

Context Bridge MUST be loaded AFTER supabase-startup-protocol.
The general scan runs first, the bridge complements with specific context.

## Pitfalls

1. **Do not consult all sources every time** — only those relevant to the concept
2. **Do not rely on memory alone** — it has limited capacity
3. **Do not skip the scan** — always start with the startup protocol
4. **session_search is FTS5** — use exact terms from what the user said
5. **tech_kb may have deprecated entries** — verify by name/tags
6. **Context Bridge does NOT replace intra-session memory** — they are complementary

## Verification

After loading the skill, test with:
- "What do we know about [project name]?"
- "What is the status of [task]?"
- "What were we doing yesterday?"

In each case, the bridge should query multiple sources and build
the concept map before answering.
