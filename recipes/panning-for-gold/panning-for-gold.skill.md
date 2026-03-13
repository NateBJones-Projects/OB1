---
name: panning-for-gold
description: Use when processing voice transcripts, brain dumps, stream-of-consciousness notes, or any raw multi-topic capture. Extracts every idea thread, then evaluates each one with deep brainstorming, then captures results to Open Brain. Trigger on transcripts, exports, "process this", "pan for gold", "brain dump", "what did I say", or multi-topic markdown files.
---

# Panning for Gold

## Overview

Transform raw brain dumps into evaluated, actionable idea inventories. Three phases: **Extract** every thread without filtering, **Evaluate** the highest-signal ones, then **Synthesize** into a permanent gold-found file with key insights captured to Open Brain.

**Core principle:** Every line gets examined. Nothing is dismissed as noise on the first pass. Personal threads, half-formed thoughts, and tangential observations often contain the highest-signal ideas.

## When to Use

- Voice transcripts (multi-speaker, timestamped)
- Stream-of-consciousness notes
- Brain dump markdown exports from ChatGPT/Gemini/Claude
- Any document where the user says "process this" or "what's in here"
- Multi-topic conversations that need thread extraction

## Critical Rules (Learned from Production Use)

These rules prevent the most common and expensive failure modes in brain dump processing:

1. **SAVE EVERYTHING TO PERMANENT FILES.** Phase 1 inventory, Phase 2 evaluations, and Phase 3 synthesis ALL get saved to files in the project's docs directory. Never rely on agent memory or temp task outputs surviving compaction.

2. **SUMMARIES FIRST, TRANSCRIPT SECOND.** If a summary/notes file exists alongside a transcript, use the summary as the primary extraction source. Only read the full transcript for: (a) exact quotes to support threads, (b) verifying completeness on the second pass. This saves 10-20K tokens per scan.

3. **EVALUATORS WRITE TO FILES.** Every background evaluator agent MUST write its evaluation to a permanent file (e.g., `docs/brainstorming/evaluations/YYYY-MM-DD-{slug}.md`) as part of its task. Do not depend on collecting agent return values.

4. **SYNTHESIS HAPPENS INLINE.** Do not dispatch a separate agent for synthesis. Write the gold-found file yourself after evaluators finish. If evaluators disappear (compaction, task ID loss), write the synthesis from your own reading.

5. **TWO PASSES ON TRANSCRIPTS.** Always run Phase 1 twice. First pass uses summary + targeted transcript reads. Second pass is a verification scan for missed threads. Present both inventories merged.

## Process

```
Input -> Save Raw Input -> Read Summary (if exists) -> Phase 1a: Extract from Summary
-> Phase 1b: Verify Against Transcript -> Save Inventory -> Present to User
-> User Confirms? (yes -> Phase 2, no -> Targeted Re-read) -> Phase 2: Evaluate Top Threads
-> Evaluators Write to Files -> Phase 3: Write Gold-Found File + Capture to Open Brain
-> Update Skill Lessons
```

## Phase 0: Save Raw Input

**BEFORE ANY ANALYSIS:** Save the raw transcript/brain dump to a file if it is not already saved. Order: save first, analyze second.

File naming: `docs/brainstorming/YYYY-MM-DD-{source}-transcript.md` or `docs/brainstorming/YYYY-MM-DD-{topic}.md`

## Phase 1: Extract (Pan)

### Token-Efficient Reading Strategy

1. **If a summary/notes file exists alongside the transcript:** Read the summary FIRST. Extract all threads from it. This covers 80-90% of content in roughly 200 lines instead of 900.
2. **Then targeted transcript reads:** For each summary thread, pull ONE exact quote from the transcript (use Grep to find it, do not read the whole file).
3. **Second pass verification:** For transcripts over 100 lines, read the last 30% (conversations front-load business, end with personal/relationship threads that summaries often skip). For shorter transcripts (under 100 lines), do a full read on the second pass since the token cost is minimal.

### Extraction Rules

1. **Read every line.** Voice transcripts have ideas buried in small talk. A casual conversation might contain a warm intro to a key contact.
2. **No category filtering.** Extract personal, professional, technical, creative, wellness, financial, relational threads equally. You do not decide what matters, the user does.
3. **Context is signal.** "I should have talked to her first" is a strategic insight, not filler. "My wrist has been hurting" next to "I carry both kids" is a biomechanics thread.
4. **Tangents are features.** Stream-of-consciousness thinking links ideas the user has not consciously connected yet. Note the connections.
5. **Transcription artifacts are clues.** Garbled speech, speaker changes, and interruptions mark moments of excitement or distraction, both worth capturing.

### What to Extract

For each thread, capture:
- **The idea** (1-2 sentences)
- **Exact quote** from the source (so the user can remember the moment)
- **Implicit connections** to other threads or known projects
- **Category** (do not filter by category, but label for organization)

### Save the Inventory

**IMMEDIATELY** save the Phase 1 inventory to `docs/brainstorming/YYYY-MM-DD-{source}-inventory.md` or equivalent. This file survives compaction even if nothing else does.

### Present the Inventory

Show ALL threads in a numbered list, grouped by category but with EVERY category represented. Include a count. Ask the user: "I found N threads. Does that feel complete, or did I miss something?"

**If the user says you missed things:** Do a targeted re-read of specific transcript sections. Do NOT re-read the entire transcript (token waste). Ask: "Which topic area feels thin?"

## Phase 2: Evaluate (Brainstorm per Nugget)

### Triage First

NOT every thread needs a full evaluation agent. Categorize threads:
- **ACT NOW candidates (3-5 max):** Get full evaluation (Opus agent or inline)
- **Already validated:** Threads that confirm things from prior sessions. Note them, skip evaluation.
- **PARK candidates:** Threads with clear "not now" signals. One-line verdict, no agent.

### Evaluation Approach (Efficiency-Ranked)

1. **Inline evaluation (preferred for 1-3 threads):** Write the evaluation directly into the gold-found file's ACT NOW section. No separate file needed. Fastest, no agent overhead, no risk of lost work.
2. **Background agents (for 4+ ACT NOW threads):** Dispatch agents BUT require them to write to permanent files.
3. **NEVER dispatch more than 5 background evaluators.** If you have more than 5 ACT NOW candidates, you miscategorized. Re-triage.

### Per-Idea Evaluation Template

```
You are brainstorming about a single idea extracted from a brain dump.

IDEA: {idea description}
CONTEXT: {surrounding context from transcript}
USER'S CONTEXT: {call search_thoughts("keywords from the idea") to find related prior thinking}

IMPORTANT: Write your evaluation to {output_file_path} using the Write tool before returning.

Evaluate this idea thoroughly:

1. **What is this really?** Restate the idea in its strongest form.
2. **Why did this excite them?** What need or desire does it serve?
3. **Build vs Buy:** Does something already exist? Search GitHub. What is the delta?
4. **Feasibility:** How hard is this? Time estimate. Dependencies.
5. **Connections:** How does this connect to their existing thinking? (Use search_thoughts to find related Open Brain entries.)
6. **Verdict:** One of:
   - ACT NOW (high value, low effort, unblocks something)
   - RESEARCH MORE (promising but needs investigation)
   - PARK IT (interesting but not timely)
   - KILL IT (not worth attention, explain why)
7. **If ACT NOW or RESEARCH MORE:** What are the next 3 concrete actions?

Be honest. Do not inflate value. Do not dismiss things as "someday" just because they are not code.

Example search_thoughts call before evaluation:
search_thoughts({ "query": "API redesign microservices", "match_threshold": 0.5, "match_count": 5 })
```

### Agent Configuration

- Use `run_in_background: true` for all evaluators
- **Every evaluator MUST include instructions to write output to a permanent file**
- Use Opus for ideas that connect to active projects or involve strategic decisions
- Use Sonnet for lower-stakes research (hardware, consumer products, wellness)
- Use Haiku for quick feasibility checks (does an API exist? is this possible?)
- Output path: `docs/brainstorming/evaluations/YYYY-MM-DD-{idea-slug}.md`

## Phase 3: Synthesis

Write the gold-found file **yourself** (do not delegate to an agent). Collect from:
1. Evaluation files written by agents (if they succeeded)
2. Your own inline evaluations
3. Your Phase 1 inventory for threads that did not need full evaluation

### Gold-Found File Location

`docs/brainstorming/YYYY-MM-DD-{source}-gold-found.md`

### Summary Format

```markdown
# Gold Found: {date} {source}

**Source:** {transcript/brain dump description}
**Extraction method:** {summary-first + transcript verification / full read / etc.}
**Thread count:** {N}

---

## ACT NOW
{Full evaluation for each, with evidence quotes and next 3 actions}

## RESEARCH MORE
| # | Idea | Question to Answer | Next Action |
|---|------|--------------------|-------------|

## PARKED (No guilt, no deadlines)
| # | Idea | Why Interesting | Trigger to Revisit |
|---|------|-----------------|---------------------|

## KILLED
| # | Idea | Why Not |
|---|------|---------|

## Connections Discovered
- {idea A} connects to {idea B} because...
- {thread from transcript} validates {existing assumption}

## Next Actions
Top 3-5 concrete actions distilled from all ACT NOW and RESEARCH MORE items, ordered by impact.

1. ...
2. ...
3. ...
```

### Capture to Open Brain

After writing the gold-found file, capture key results to Open Brain using the `capture_thought` MCP tool:

1. **Each ACT NOW item** gets its own thought, tagged with `brain-dump`, `act-now`, and any relevant topic tags. Include the verdict and next 3 actions in the thought content.
2. **Each significant connection discovered** gets its own thought, tagged with `brain-dump`, `connection`. Cross-linking ideas is where Open Brain shines across sessions.
3. **The overall synthesis** gets one summary thought with a link to the gold-found file path, tagged with `brain-dump`, `synthesis`.

Example capture:

```
capture_thought({
  "thought": "ACT NOW: [idea in strongest form]. Next actions: (1) ..., (2) ..., (3) ... Evidence: '[exact quote]'. From brain dump processed YYYY-MM-DD.",
  "tags": ["brain-dump", "act-now", "relevant-topic"]
})
```

This ensures that future sessions can find these insights with `search_thoughts`, even if the original files are in a different project or directory.

**If Open Brain MCP is not connected:** Skip the capture step. The gold-found file is the primary output and contains everything. You can manually capture key items later once your MCP connection is configured. The recipe works without Open Brain, it just works better with it.

## Phase 4: Self-Improvement

After every processing session, check:
1. **Did any work get lost?** (agents died, compaction ate something, files not saved) -> Add a rule to Critical Rules section
2. **Was token usage reasonable?** (did we re-read unnecessarily, dispatch too many agents?) -> Update the reading strategy
3. **Did the user correct the extraction?** (missed threads, wrong categorization) -> Add to Common Mistakes

If any lesson is learned, update this skill file directly. The skill improves with every use.

### Lessons Log

| Date | Lesson | Change Made |
|------|--------|-------------|
| (This table grows as you use the skill. Add entries when things go wrong or right.) | | |

## Red Flags: You're Rushing

| Thought | Reality |
|---------|---------|
| "This section is just small talk" | Small talk contains relationship signals and warm intros |
| "This is not actionable" | Not everything needs to be a task to be valuable |
| "I'll focus on the tech ideas" | The user said EVERY idea. Tech bias is the #1 failure mode |
| "I can summarize this section" | You are skimming. Read every line. |
| "This is too long to read carefully" | That is exactly why the user asked YOU to do it |
| "Personal/wellness is not relevant" | The user's body, relationships, and energy ARE the system |

## Red Flags: You're Wasting Tokens

| Thought | Reality |
|---------|---------|
| "Let me read the full transcript again" | Did you check if a summary exists first? Use Grep for quotes. |
| "I'll dispatch 8 evaluator agents" | More than 5 means you miscategorized. Re-triage. |
| "I'll have an agent write the synthesis" | Write it yourself. Agents disappear. |
| "Let me re-read to find that quote" | Use Grep with a keyword from the thread. 100x cheaper. |
| "I need to read the whole file for context" | Read the first 50 and last 50 lines. Middle is usually elaboration, not new threads. |

## Common Mistakes

1. **Filtering by your assumptions about "actionable."** A massage therapist knowing a business owner IS actionable. It is a warm intro worth more than 100 lines of code.
2. **Speed over thoroughness.** Brain dumps reward slow reading. The gold is in the tangents.
3. **Collapsing related threads.** "CBD for pain relief" and "CBD business opportunity" are TWO ideas, not one. Keep them separate. They have different evaluations.
4. **Ignoring meta-observations.** When someone says "maybe I should just record and process later," that is a workflow insight, not filler.
5. **Not asking if you missed threads.** Always ask. You probably did.
6. **Not saving intermediate work.** Every output (inventory, evaluations, synthesis) gets a permanent file. If it is not on disk, it does not exist.
7. **Re-reading the whole transcript for one quote.** Use Grep. It is 100x cheaper.
8. **Dispatching agents and hoping they return.** Agents are unreliable across compaction boundaries. For critical synthesis, do it inline.
