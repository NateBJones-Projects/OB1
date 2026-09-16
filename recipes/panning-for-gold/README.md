# Panning for Gold

<div align="center">

![Community Contribution](https://img.shields.io/badge/OB1_COMMUNITY-Approved_Contribution-2ea44f?style=for-the-badge&logo=github)

**Created by [@jaredirish](https://github.com/jaredirish)**

*Reviewed and merged by the Open Brain maintainer team — thank you for building the future of AI memory!*

</div>

*Brain dump processor for Open Brain*

Turn raw brain dumps, voice transcripts, and stream-of-consciousness notes into structured, evaluated thought inventories that get captured into Open Brain automatically. Every line gets examined. The gold is in the tangents.

## What It Does

Takes any unstructured text (voice transcripts, ChatGPT exports, freeform notes, multi-topic brain dumps) and runs a three-phase process: **Extract** every idea thread without filtering, **Evaluate** the highest-signal ones with deep brainstorming, and **Synthesize** into a permanent gold-found file with results captured as Open Brain thoughts. Nothing gets dismissed as noise on the first pass.

## When to Use It

- **After a meeting or brainstorm call.** Export your Fathom/Otter/Fireflies transcript, point Panning for Gold at it, and get a clean inventory of every topic — including the half-sentence at minute 38 that's actually a warm intro worth more than the whole agenda.
- **Weekly brain dump ritual.** Every Friday, write for 10 minutes with no structure, then run Panning for Gold on it. You'll be surprised what surfaces when every line gets examined without skimming.
- **Processing AI conversation exports.** Exported a long ChatGPT or Claude session where you explored 8 different ideas? Point this at it instead of re-reading. Pairs well with the [ChatGPT Import recipe](../chatgpt-conversation-import/).
- **Post-conference notes.** You scribbled 4 pages at a conference. Run Panning for Gold to get a structured inventory and walk away with concrete next actions instead of a notebook you'll never reopen.
- **End-of-day processing.** Had one of those days where 15 things are bouncing around? Brain dump it all, run the recipe, and let it sort the signal from the noise. The PARK and KILL verdicts are just as valuable as ACT NOW.

## Prerequisites

- Working Open Brain setup ([guide](../../docs/01-getting-started.md))
- Claude Code (or another AI coding tool that supports skills/system prompts)
- Open Brain MCP tools connected to your AI coding tool (`capture_thought`, `search_thoughts`)

### Credential Tracker

```
From your existing Open Brain setup:
- Project URL: _______________
- OpenRouter API key: _______________
- Open Brain MCP server connected: yes / no

No additional credentials needed for this recipe.
```

## Steps

### 1. Create the skill directory

```bash
mkdir -p ~/.claude/skills/panning-for-gold
```

### 2. Copy the skill file

Copy `panning-for-gold.skill.md` from this recipe into the directory you just created:

```bash
cp panning-for-gold.skill.md ~/.claude/skills/panning-for-gold/SKILL.md
```

If you downloaded this recipe from GitHub, adjust the source path accordingly.

### 3. Verify Claude Code picks up the skill

Restart Claude Code (close and reopen, or start a new session). Claude Code automatically loads skills from `~/.claude/skills/` on startup. To verify, ask Claude Code: "What skills do you have loaded?" or simply say "process this" and confirm it references the Panning for Gold methodology.

### 4. Prepare your brain dump

Save your raw input to a file. Examples:

```bash
# Voice transcript from Fathom, Otter, etc.
cp ~/Downloads/meeting-notes.md ~/project/docs/brainstorming/YYYY-MM-DD-meeting.md

# ChatGPT export
cp ~/Downloads/chatgpt-export.md ~/project/docs/brainstorming/YYYY-MM-DD-ideas.md

# Or just paste text into a new file
cat > ~/project/docs/brainstorming/YYYY-MM-DD-brain-dump.md << 'EOF'
(paste your brain dump here)
EOF
```

### 5. Run the processor

In Claude Code, point the skill at your file:

```
Process this brain dump: docs/brainstorming/YYYY-MM-DD-brain-dump.md
```

Run this from within your project directory, or provide an absolute file path.

Or simply paste raw text and say "process this" or "pan for gold."

The processor will:

1. **Phase 1 (Extract):** Read every line, extract all idea threads regardless of category, save an inventory file, and present it to you for confirmation.
2. **Phase 2 (Evaluate):** After you confirm the inventory, evaluate the top 3-5 threads with deep brainstorming (Build vs Buy analysis, feasibility, connections to your existing work).
3. **Phase 3 (Synthesize):** Write a permanent gold-found file with verdicts (ACT NOW / RESEARCH MORE / PARK / KILL) and capture key insights to Open Brain via `capture_thought`.

### 6. Review the outputs

After processing, you will have:

- **Inventory file:** `docs/brainstorming/YYYY-MM-DD-{source}-inventory.md` listing every extracted thread
- **Gold-found file:** `docs/brainstorming/YYYY-MM-DD-{source}-gold-found.md` with evaluated threads, verdicts, and next actions
- **Open Brain thoughts:** ACT NOW items and key insights captured as searchable thoughts

### 7. (Optional) Adapt for your tool

If you are not using Claude Code, the skill file works as a prompt template. Copy the content of `panning-for-gold.skill.md` into your AI tool's system prompt or custom instructions. The core methodology works with any LLM that can read files and write output.

## Expected Outcome

When working correctly, you should see:

- A numbered inventory of **every** idea thread found in your input, grouped by category (technical, personal, creative, financial, relational, etc.), with exact quotes from the source
- A triage step where you confirm the inventory before evaluation begins
- Deep evaluations for the top threads, each with a clear verdict and next actions
- A gold-found markdown file saved to your project's docs directory
- Key findings captured in Open Brain, searchable across future sessions with `search_thoughts`

A typical 30-minute voice transcript yields 10-20 threads, with 3-5 getting full evaluations. Processing takes 2-5 minutes depending on length.

## Why a Skill File?

You could ask Claude "process this brain dump and save the good stuff" without the skill file, and sometimes it'd be great. But it'd also skim, miss threads, bias toward technical topics, or dump everything without evaluating what's worth keeping.

Panning for Gold makes the process repeatable. It enforces a "read every line" discipline (skimming is the #1 failure mode), forces a human checkpoint between extraction and evaluation so you confirm nothing was missed, categorizes across six domains (not just tech — personal, wellness, financial, relational, and creative threads get equal weight), and saves files to disk as it goes so you don't lose work if a session crashes. The Red Flags diagnostic tables even help you spot when the process is going sideways.

Think of it less as "new capability" and more as a senior analyst's methodology, encoded as a system prompt. The 5-minute setup buys you consistency every time you use it.

## Troubleshooting

**Issue:** The processor skips personal or non-technical threads.
**Solution:** This is the most common failure mode. The skill explicitly instructs against tech bias. If threads are being filtered, check that the skill file is loaded correctly and that the "Red Flags: You're Rushing" section is intact. Personal, wellness, and relational threads often contain the highest-signal ideas.

**Issue:** Evaluation agents lose their work (output missing after processing).
**Solution:** The skill requires all evaluators to write to permanent files as part of their task. If you see missing evaluations, the synthesis phase will still work from the inventory and inline analysis. Check that your AI tool has write permissions to the output directory.

**Issue:** Open Brain capture fails during Phase 3.
**Solution:** Verify your Open Brain MCP connection is active by running `search_thoughts` with a test query. If the MCP server is disconnected, the gold-found file still contains all results locally. You can manually capture key items later with `capture_thought`.

**Issue:** Processing a very long transcript (60+ minutes) uses excessive tokens.
**Solution:** The skill uses a "summaries first" strategy. If your transcript tool (Fathom, Otter, Fireflies) generates a summary alongside the full transcript, place both files in the same directory. The processor reads the summary first and only dips into the transcript for exact quotes and verification of completeness.

---

*The gold is always in the tangents.*
