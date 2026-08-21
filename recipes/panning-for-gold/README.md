# Panning for Gold

<div align="center">

![Community Contribution](https://img.shields.io/badge/OB1_COMMUNITY-Approved_Contribution-2ea44f?style=for-the-badge&logo=github)

**Created by [@jaredirish](https://github.com/jaredirish)**

*v3.0.0 — updated with five months of production lessons since the original merge*

</div>

*Brain dump processor for Open Brain*

Turn raw brain dumps, voice transcripts, and stream-of-consciousness notes into structured, evaluated thought inventories that get captured into Open Brain automatically. Every line gets examined. The gold is in the tangents.

## What's New in v3.0.0

The original v2.0.0 shipped a solid three-phase extract/evaluate/synthesize loop. This update adds the piece that was missing: **the skill now reads Open Brain before it reads your transcript.**

- **Stage 0: Open Brain Pre-Load.** Before extraction starts, the skill builds a context dossier — who's already known, what projects are active, what happened in the last 14 days — so every thread gets tagged with its prior connection instead of being extracted cold.
- **Deadline Audit.** A three-step check (literal quote / inferred from an anchor / your own extrapolation) that stops the skill from inventing urgency a transcript never established.
- **Gap Detection.** After evaluation, the skill explicitly asks what got missed and what your memory system knows that neither speaker mentioned.
- **Hardened speaker handling.** Covers the zero-labels case (no speaker attribution at all), the diarizer-ceiling case (more real speakers than the tool supports), and a mandatory biographical-attribution quiz for any claim that could get projected onto the wrong person.
- **Advisory-only dedup.** Capture guards now advise, never block — a duplicate is an acceptable outcome, a silently dropped capture is not.
- **Pairs with [Flywheel Retrieval](../flywheel-retrieval/).** This recipe writes to Open Brain after the fact; that one reads from it live during brainstorming and writes at session close. Together they close the loop.

Every change here traces back to a real production failure documented in the skill's own Lessons Log — see that section in `panning-for-gold.skill.md` for the specifics.

## What It Does

Takes any unstructured text (voice transcripts, ChatGPT exports, freeform notes, multi-topic brain dumps) and runs a five-phase process: **Pre-Load** relevant Open Brain context, **Extract** every idea thread without filtering, **Evaluate** the highest-signal ones with targeted retrieval and gap detection, **Synthesize** into a permanent gold-found file, and **Write Back** results to Open Brain. Nothing gets dismissed as noise on the first pass.

## When to Use It

- **After a meeting or brainstorm call.** Export your transcript, point Panning for Gold at it, and get a clean inventory of every topic, including the half-sentence at minute 38 that's actually a warm intro worth more than the whole agenda.
- **Weekly brain dump ritual.** Write for 10 minutes with no structure, then run Panning for Gold on it. You'll be surprised what surfaces when every line gets examined without skimming.
- **Processing AI conversation exports.** Exported a long chat session where you explored several different ideas? Point this at it instead of re-reading. Pairs well with a conversation-import recipe if you have one.
- **Post-conference notes.** You scribbled 4 pages at a conference. Run Panning for Gold to get a structured inventory and walk away with concrete next actions instead of a notebook you'll never reopen.
- **End-of-day processing.** Had one of those days where 15 things are bouncing around? Brain dump it all, run the recipe, and let it sort the signal from the noise. The PARK and KILL verdicts are just as valuable as ACT NOW.

## Prerequisites

- Working Open Brain setup ([guide](../../docs/01-getting-started.md))
- Claude Code (or another AI coding tool that supports skills/system prompts)
- Open Brain MCP tools connected to your AI coding tool (`capture_thought`, `search_thoughts`, `list_thoughts`)
- (Recommended) a lightweight contacts file if you want person-status enrichment to have somewhere to check against

### Credential Tracker

```
From your existing Open Brain setup:
- Project URL: _______________
- OpenRouter API key: _______________
- Open Brain MCP server connected: yes / no
- search_thoughts available: yes / no
- capture_thought available: yes / no

No additional credentials needed for this recipe.
```

## Steps

### 1. Create the skill directory

```bash
mkdir -p ~/.claude/skills/panning-for-gold
```

### 2. Copy the skill file

```bash
cp panning-for-gold.skill.md ~/.claude/skills/panning-for-gold/SKILL.md
```

Or download directly from GitHub:

```bash
curl -o ~/.claude/skills/panning-for-gold/SKILL.md \
  https://raw.githubusercontent.com/NateBJones-Projects/OB1/main/recipes/panning-for-gold/panning-for-gold.skill.md
```

### 3. Verify Claude Code picks up the skill

Restart Claude Code (close and reopen, or start a new session). To verify, ask: "What skills do you have loaded?" or say "process this" and confirm it references the Panning for Gold methodology.

### 4. Prepare your brain dump

Save your raw input to a file:

```bash
# Voice transcript export
cp ~/Downloads/meeting-notes.md ~/project/docs/brainstorming/YYYY-MM-DD-meeting.md

# AI conversation export
cp ~/Downloads/chat-export.md ~/project/docs/brainstorming/YYYY-MM-DD-ideas.md

# Or just paste text into a new file
cat > ~/project/docs/brainstorming/YYYY-MM-DD-brain-dump.md << 'EOF'
(paste your brain dump here)
EOF
```

### 5. Run the processor

```
Process this brain dump: docs/brainstorming/YYYY-MM-DD-brain-dump.md
```

Or simply paste raw text and say "process this" or "pan for gold."

The processor will:

1. **Stage 0 (Pre-Load):** Search Open Brain for people, projects, and topics mentioned, and build a context dossier before touching the transcript.
2. **Phase 1 (Extract):** Read every line, extract all idea threads regardless of category, tagged with prior-connection status.
3. **Phase 2 (Evaluate):** Evaluate the top 3-5 threads with deep brainstorming, targeted retrieval, a deadline audit, and gap detection.
4. **Phase 3 (Synthesize):** Write a permanent gold-found file with verdicts (ACT NOW / RESEARCH MORE / PARK / KILL) and connections discovered.
5. **Phase 3.5 (Write Back):** Capture ACT NOW items, new contact notes, and a session summary to Open Brain automatically.

### 6. Review the outputs

- **Gold-found file:** `docs/meetings/YYYY-MM-DD-{source}-gold-found.md` with the full thread inventory, evaluations, verdicts, and next actions.
- **Transcript file:** `docs/meetings/YYYY-MM-DD-{source}-transcript.md`, saved at the end of the run.
- **Open Brain thoughts:** ACT NOW items, new contact notes, and a session summary, all searchable in future sessions.

### 7. (Optional) Combine with Flywheel Retrieval

Install [Flywheel Retrieval](../flywheel-retrieval/) alongside this recipe for the full loop: Panning for Gold captures evaluated ideas post-hoc, Flywheel Retrieval surfaces them live during your next brainstorming session and auto-captures new ones at close.

### 8. (Optional) Adapt for your tool

If you are not using Claude Code, the skill file works as a prompt template. Copy the content of `panning-for-gold.skill.md` into your AI tool's system prompt or custom instructions. The core methodology works with any LLM that can read files, write output, and call `search_thoughts` / `capture_thought` via MCP.

## Expected Outcome

- A numbered inventory of **every** idea thread in your input, tagged with a prior-connection status, grouped by category with exact quotes from the source.
- Deep evaluations for the top threads, each with a clear verdict, next actions, and an audited deadline (or explicitly none, if the source didn't establish one).
- A gap-detection pass calling out what got missed and what your memory system knew but nobody said out loud.
- A gold-found markdown file saved to your project's docs directory.
- Key findings captured in Open Brain, searchable across future sessions.

A typical 30-minute voice transcript yields 10-20 threads, with 3-5 getting full evaluations. Processing takes a few minutes depending on length and how many Open Brain queries the dossier needs.

## Why a Skill File?

You could ask an agent to "process this brain dump and save the good stuff" without a skill file, and sometimes it'd work fine. But it would also skim, miss threads, bias toward technical topics, invent deadlines the source didn't establish, or dump everything without evaluating what's worth keeping.

Panning for Gold makes the process repeatable. It enforces a "read every line" discipline, forces a memory check before extraction so nothing gets processed cold, audits every deadline claim instead of inventing urgency, categorizes across six domains (not just tech), and saves files to disk as it goes so a crashed session doesn't lose work. The Red Flags diagnostic tables help you spot when the process is going sideways in real time.

Think of it less as "new capability" and more as a senior analyst's methodology, encoded as a system prompt, that also remembers what you told it last time.

## Troubleshooting

**Issue:** The processor skips personal or non-technical threads.
**Solution:** This is the most common failure mode. The skill explicitly instructs against tech bias. Check that the skill file is loaded correctly and that the "Red Flags: You're Rushing" section is intact.

**Issue:** Evaluation agents lose their work (output missing after processing).
**Solution:** The skill requires all evaluators to write to permanent files as part of their task. If evaluations are still missing, the synthesis phase will fall back to the inline analysis and thread inventory. Check that your AI tool has write permissions to the output directory.

**Issue:** Open Brain capture fails during Phase 3.5.
**Solution:** Verify your Open Brain MCP connection is active by running `search_thoughts` with a test query. If the MCP server is disconnected, the gold-found file still contains all results locally, and you can capture key items manually later.

**Issue:** Processing a very long transcript uses excessive tokens.
**Solution:** The skill uses a "summaries first" strategy. If your transcript tool generates a summary alongside the full transcript, keep both files in the same directory. The processor reads the summary first and only dips into the transcript for exact quotes and completeness verification.

**Issue:** Stage 0 pre-load takes a long time or feels excessive.
**Solution:** Query counts are capped (8 people/topic queries + 1 recency query at pre-load, 10 more during evaluation). If Open Brain is sparse or mostly new contacts, the skill should degrade gracefully and skip the dossier, noting that in the gold-found header. If it isn't degrading, check that your Open Brain instance is responding to `list_thoughts`.

**Issue:** A deadline in the gold-found file looks wrong or invented.
**Solution:** Check the evidence citation next to the date. The skill is required to mark inferred dates with `[inferred from: <anchor>]` and to drop the calendar date entirely for its own extrapolations. If a date has no citation, that's a bug in the run, not the skill design, flag it and re-run the audit.

---

*The gold is always in the tangents.*
