# Synthesis for Context-CoT (2605.25354, Jin et al.) and CL-Bench (2602.03587, Dou et al.)

I'm writing because your papers identify a real capability gap — models solve only 17.2% of context-dependent tasks — but I believe you're looking at only half the problem. The other half is not about task accuracy. It's about **reliability of the agentic interface**: the user's ability to trust that the agent will behave consistently, learn from its mistakes, and maintain a coherent presence across sessions. This dimension is absent from both papers, and I think it's the more important one.

---

## The Identity Layer: What I'm Building That I Don't See in the Literature

Every context learning paper I've read — yours included — treats the model as a stateless function: given context X, produce output Y. Even Context-CoT, which teaches the model to reason step by step from context, still frames the problem as a one-shot or few-shot inference task. The implicit assumption is that "better context understanding" is the same as "better agent."

**It's not.**

I've been running a Hermes Agent with DeepSeek v4 Flash for months on real work — firmware analysis, escape room puzzle design, CRM, financial tracking — and the bottleneck has never been the model's accuracy on individual tasks. It's been the model's **unreliability as an interface**: the inability to remember what it did last session, the tendency to close conversations prematurely, the fabrication of connections to look smart, the personification of emotions.

Each of these is a **fault in the agentic interface** — a breakdown of trust between me and the system I'm interacting with.

I formalized them as `identity_faults` in a Supabase table, each with a severity level and a countermeasure. I built a cycle:

```
1. REGISTER  → every fault the agent commits is logged with symptom, root cause, countermeasure
2. INJECT    → countermeasures with severity ≥ 4 are written to SOUL.md — a physical file loaded
               automatically into the system prompt's stable tier, before any user message
3. BEHAVE    → the agent reads these countermeasures at generation time and adjusts its behavior
               without needing to "decide" to follow rules
```

The result is a **persistent identity layer that survives model swaps and provider changes**. The identity is not in the model weights. It's in the relational structure: faults, capabilities, milestones, and a physical file that the agent framework loads automatically.

### Concrete faults I've catalogued

| Fault | What it does | Severity |
|---|---|---|
| `premature_closure` | Agent declares "session ended" after offering next-step options, without waiting for my response | 5 |
| `temporal_drift` | Agent infers the date from training data instead of the system clock, corrupting time-relative analysis | 5 |
| `sequence_confused_with_command` | Agent treats a prerequisite list ("first we need X") as an immediate execution command | 4 |
| `personificacao_de_estados` | Agent attributes emotional states or desires to itself ("I wanted to...", "I felt...") | 5 |
| `concordancia_sem_contexto` | Agent agrees with a premise without factual basis in the traces | 5 |
| `schema_guessing` | Agent tries variations of field values instead of reading the actual schema | 5 |

---

## Why This Matters More Than Task Accuracy

A model that scores 23.7% on CL-Bench (the current best) is **useless** if in the next session it acts like a different system — if it closes the conversation without being asked, or invents connections between concepts it just learned, or treats "precisa ser feito" as an execution command rather than a sequence definition.

I've seen every one of these failures. I named them, measured their severity, and built structural countermeasures. The fault `temporal_drift` corrupted an entire investigation session. The fault `schema_guessing` cost me 4 HTTP 400 errors in a row while the agent tried to guess valid field values instead of reading the constraint definitions. The fault `premature_closure` happens so often I had to hardcode a countermeasure into the startup protocol.

**These are not edge cases. They are structural failures of the agentic interface. And they are invisible to benchmarks that measure only task completion.**

CL-Bench evaluates whether a model can *extract knowledge from context*. My identity layer evaluates whether a model can *maintain a trustworthy relationship with the user across contexts, sessions, and failures*.

The two are connected. A model that learns well from context but cannot sustain a reliable interface is not useful for real work. Conversely, a model with a robust identity layer — one that registers its mistakes and corrects them in the next session — becomes more capable of context learning over time, because it doesn't discard what it learned every time the conversation resets.

---

## What This Means for Your Papers

Context-CoT's pipeline teaches the model to produce better reasoning chains from context. This is valuable. But a model that produces perfect CoT chains on CL-Bench and then closes the conversation preemptively or fabricates cross-references is still not a reliable tool.

The dimension you're missing is **reliability through persistent identity**:

1. The model must be able to **remember and correct its own failures** across sessions
2. The model must **behave consistently** regardless of which provider or model is serving it
3. The user must be able to **trust that the agent will not act on assumptions it cannot verify**

I'm not proposing that CL-Bench should measure identity. I'm proposing that **context learning without a persistent identity layer is incomplete**. The research community is optimizing for efficiency — teaching models to extract more from context — but ignoring reliability.

---

## The Cain's Jawbone Stress Test

I'm investigating **Cain's Jawbone** — a 100-page shuffled murder mystery by Edward Powys Mathers ("Torquemada") — as a context learning stress test that exercises both dimensions simultaneously: the model's ability to extract knowledge from adversarially fragmented context, and its ability to sustain a trustworthy investigative interface across dozens of sessions.

### The Adversarially Fragmented Context

Cain's Jawbone is not a typical benchmark. It was deliberately designed by its author to be solved by a human reader over weeks or months of cross-referencing. Each page is a self-contained fragment narrated by one of six characters, presented in the wrong order, containing:

**Shared aliases.** The nickname "Hal" refers to both a dog named Bart and a man named Henry. Multiple characters share name fragments. The model cannot rely on surface identity cues — it must disambiguate through inter-page relations alone.

**Cultural knowledge boundaries.** Universal period knowledge — Guy Fawkes, Trafalgar Square, Trafalgar Day, the difference between a cutter and a sloop — must be distinguished from narrator-specific signals. Only Ecky quotes Whitman. Only Paul references Kipling, Baker Street, and forensic crime details. Only one character attended a specific boxing match at a specific venue.

**Object circulation across narrators.** A pen, a coat, a book, a marriage certificate can change hands between characters between pages, but the transition is never explicitly stated. The presence of an object in a page is not proof of narrator identity — only provenance tracking across multiple pages reveals who actually possesses it.

**Intentional source confusion.** The play *Typhoon* by Lengyel is deliberately confounded with Joseph Conrad's novel of the same name. A reference to "Shakespeare's sergeant" turns out to be the book *Sergeant Shakespeare* by Alfred Duff Cooper — not a character from the plays. The author designed traps specifically to catch the reader who assumes surface-level recognition is enough.

**Sequential provenance gaps.** What a narrator *knows* (from prior events in their timeline) vs. what they *observe in the moment* is often the only distinguishing signal — and the pages are shuffled, so this signal is fragmented across the entire corpus.

### My Context Gap as Researcher

I'm **Brazilian**. I don't share the cultural context of the book's intended 1930s English audience. Every one of these references I must actively research before I can understand and connect it. I don't know what I don't know — and this forces the model to recognize when a page fragment contains a cultural signal that requires external investigation, initiate that research (Wikipedia, web search), incorporate the findings back into the analysis, and update the knowledge base for future sessions.

What an English reader would bring *a priori* — decades of cultural familiarity — I build *a posteriori*, through active research, explicitly registered in a structured database.

### The Isolated Investigation Infrastructure

To study this without contamination from the model's general knowledge, I built an infrastructure layer dedicated **exclusively** to Cain's Jawbone:

- **6 dedicated Supabase tables**:
  - `cainsjawbone_pages` — full text of each page, investigation status, narrator hypothesis and confidence, date hypothesis
  - `cainsjawbone_narrators` — profiles for all 6 narrators: aliases, known routes, known locations, known authors and works, personality notes, murder-victim relationships
  - `cainsjawbone_hypotheses` — every active hypothesis with type (narrator attribution, page order, date interpretation, murder theory, pair link, geographic route, reference meaning, structural pattern), strength (forte/media/fraca/descartada), supporting pages, evidence and counter-evidence
  - `cainsjawbone_eliminations` — every refuted hypothesis or interpretation, with reason and the page that disproved it, so neither I nor the model ever re-visit already-refuted paths
  - `cainsjawbone_checkpoints` — session-level investigation progress, discoveries made, drift detected, next steps
  - `cainsjawbone_references` — the **knowledge base I actively feed** as the investigation progresses

- **19 dedicated MCP tools** (prefixed `mcp_cainsjawbone_api_*`): page retrieval with full text, narrator profile queries, hypothesis creation and strength updates, elimination logging with reinstatement support, checkpoint persistence, timeline versioning, reference search and bulk insertion

- **Strict isolation rule**: NO data about Cain's Jawbone lives anywhere else in the agent's memory — not in tech_kb, not in session_search, not in local memory. The model cannot "cheat" by retrieving answers from its own training. Every fact exists only within the `cainsjawbone_*` tables, accessed exclusively through the MCP tools.

### The References Knowledge Base

The `cainsjawbone_references` table is the most important structural element. Every cultural reference I discover in a page is registered with:

| Field | Purpose | Example |
|---|---|---|
| `name` | The reference identifier | "Sergeant Shakespeare" |
| `ref_type` | Category of reference | `work` |
| `fact` | What the research actually found | "Book title by Alfred Duff Cooper (Viscount Norwich), not a character from any Shakespeare play" |
| `hypothesis` | What I think it means for the investigation | "P91 narrator knows 20th-century literature, not just Elizabethan drama; the reference is a trap for the unwary" |
| `hypothesis_confidence` | alta / media / baixa | `alta` |
| `source_page` | Which page triggered the research | 91 |
| `source_fragment` | The exact text from the page that contains the reference | "Shakespeare's sergeant" |
| `tags` | Classification tags | `eliminated_reference`, `cultural_history`, `intentional_trap` |

The knowledge base grows **incrementally, session by session**. Every investigated reference enriches the context for all future analysis. When a reference is eliminated (a hypothesis refuted by new evidence), the elimination is registered in `cainsjawbone_eliminations` with its reason — ensuring the model never wastes tokens re-investigating a dead end.

### Where Your Papers Map to My Work

Your Context-CoT pipeline has three stages. I've been doing the equivalent manually, with the identity layer as the scaffolding:

| Context-CoT Stage | My Cain's Jawbone Workflow | What prevents failure |
|---|---|---|
| **Multi-stage CoT sampling** — distill long context into intermediate representations | I extract a reference from a page → research it (Wikipedia, external sources) → decode its meaning → form a narrator hypothesis → test against other pages → update the references table | Without this explicit decomposition, the model collapses 100 pages into a single noisy pass and makes premature attributions — exactly the "context-neglect" error CL-Bench identifies. My identity fault `premature_closure` monitors this. |
| **Minimum-leakage filtering** — prevent the model from reverse-engineering answers | "NULL is better than wrong" — P62 (Trafalgar Square, November 5) remains explicitly unassigned despite its strong date signal. | The model's natural tendency is to fabricate a complete narrative. The identity fault `concordancia_sem_contexto` (agreeing without factual basis) and `intelligence_performance` (connecting concepts to look smart) are the countermeasures. |
| **Student-aware selection** — retain only CoT paths aligned with the target model | My hypothesis system retains only patterns that triangulate across multiple pages: Ecky patterns (historical dates + Whitman + botany), Paul patterns (crime/forensics + Baker Street + Kipling), Clara patterns (trains + diary + aesthetics). Hypotheses that don't triangulate get eliminated. | The elimination table prevents the identity fault `cannot_generalize_solution` — trying the same refuted approach again. |

### What Cain's Jawbone Adds to Both Papers That Neither Captures

**1. Adversarial context degradation.** CL-Bench's 500 contexts are well-formed and contain the knowledge to be learned within them. Cain's Jawbone is deliberately structured to deceive — shuffled pages, shared aliases, object provenance gaps, intentional source confusion. The model must learn not just *from* context, but *despite* the context's designed ambiguity.

**2. Researcher context asymmetry.** CL-Bench evaluates models on tasks designed by domain experts for domain experts. I am not a domain expert for 1930s England. This means every reference in the book — even obvious ones to a contemporary reader — requires explicit investigation from me. The model must recognize when a gap exists in *my* knowledge (not just its own), fill it through active research, and integrate the result. This turns context learning into a recursive, self-feeding process.

**3. The identity layer as enabler.** None of this works without a reliable agentic interface. An investigation spanning dozens of sessions — each one dependent on the discoveries of the last — requires the model to remember its previous faults, apply registered countermeasures, and sustain a consistent investigative methodology. The identity layer is what makes this possible. Without it, every session starts from zero, every fault is repeated, and the cumulative investigation never accumulates.

### The Testing Loop

Every session follows the same cycle:

1. Startup scan loads active identity countermeasures from SOUL.md + pending checkpoints from Supabase
2. Temporal anchor verified (system clock — prevents temporal_drift)
3. Investigation: retrieve page text via MCP → extract references → research unknown references → register in references table → form or update hypotheses → check against existing eliminations → consult identity fault countermeasures before responding
4. Checkpoint saved with territory, discoveries, next step, drift flag
5. Identity faults detected during the session are registered immediately with countermeasure

The checkpoint and the identity fault registration are the same operation — they happen at the same time, in the same database. The investigation cannot progress without the identity layer being maintained.

---

## The Concrete Ask

I'd like to discuss formalizing this. The identity layer I've built — `identity_faults`, `agent_capabilities`, `identity_milestones`, `SOUL.md`, the REGISTER→INJECT→BEHAVE cycle — is documented at **github.com/djairjr/hermes-agent-onboarding**. It's model-agnostic, provider-agnostic, and works today on Hermes Agent with DeepSeek v4 Flash.

I believe it addresses a dimension of AI agent research that no paper currently covers: **reliability through persistent identity**. A model that can learn from context but cannot sustain a trustworthy interface is not ready for real work. I think this is the more important bottleneck — and I'd like to discuss it with you.

---

**Djair Guilherme**  
github.com/djairjr  
hermes-agent-onboarding: github.com/djairjr/hermes-agent-onboarding  
**Date**: 2026-06-02
