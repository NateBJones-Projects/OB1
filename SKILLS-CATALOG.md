# Open Brain v2 Skills Catalog

## Summary of 6 High-Value Skills Verified

---

## 1. Panning for Gold
**Name and purpose:** Extract ideas from brain dumps and transcripts with thorough evaluation and synthesis into actionable inventories

**MCP tools it uses:**
- `capture_thought` - stores final ACT NOW items and session summary
- `search_thoughts` - finds related prior thinking during evaluation phase

**Prerequisites:**
- Working Open Brain setup with MCP tools connected
- Claude Code (or similar AI coding tool that supports skills)
- No external services required (pure prompt-based skill)

**Ready to use:** Yes
- Pure prompt file, no code deployment needed
- Comprehensive methodology with proven rules from production use
- Includes critical lessons learned and anti-patterns

**Notes on adaptation:** None needed. Skill is designed to work as-is with any Open Brain setup.

---

## 2. Research Synthesis
**Name and purpose:** Transform a defined source set into decision-grade findings with contradictions, confidence markers, gaps, and next questions

**MCP tools it uses:**
- `search_thoughts` - pulls prior related context before synthesis
- `capture_thought` - stores final synthesis or key findings (optional)

**Prerequisites:**
- Working Open Brain setup (for memory search/capture)
- AI client that supports reusable skills/rules
- A defined research question and source set

**Ready to use:** Yes
- Standalone skill with clear process: Frame → Inventory → Extract → Resolve → Mark confidence → End with usefulness
- Evidence and judgment rules prevent fake consensus
- Works independently but can be chained with other skills

**Notes on adaptation:** None. Skill focuses on methodology over implementation, making it portable across AI clients.

---

## 3. Meeting Synthesis
**Name and purpose:** Convert meeting transcripts/notes into decisions, action items, unresolved questions, risks, and follow-up artifacts

**MCP tools it uses:**
- `search_thoughts` - searches for prior related meetings/project notes
- `capture_thought` - stores key decisions or final synthesis (optional)

**Prerequisites:**
- Working Open Brain setup (for memory search/capture)
- AI client that supports reusable skills/rules
- Transcript, notes, or faithful meeting summary

**Ready to use:** Yes
- Clear separation between "decided", "assigned", and "discussed"
- Preserves uncertainty instead of creating false closure
- Produces appropriate artifacts (decision log, action list, follow-up draft)

**Notes on adaptation:** None needed. Skill maintains strict discipline around treating meeting artifacts as truth.

---

## 4. Weekly Signal Diff
**Name and purpose:** Convert weekly market news into personalized structural changes (what shifted, why it matters, what to watch)

**MCP tools it uses:**
- `search_thoughts` - pulls active projects, priorities, and prior digests from memory
- `capture_thought` - stores the final weekly digest (optional)

**Prerequisites:**
- Working Open Brain setup (for memory search/capture)
- AI client that supports reusable skills/rules
- One of: live web access OR user-provided weekly source set
- Optional: OpenRouter access for Perplexity Sonar search

**Ready to use:** Yes
- Focuses on structural shifts, not news digests
- Adapts watchlist based on user's actual interests from Open Brain
- Includes starter universe for bootstrap (AI categories/companies)

**Notes on adaptation:** None needed. Skill is portable and can work with or without live search. The structural questions are the core value.

---

## 5. Auto-Capture
**Name and purpose:** Automatically capture ACT NOW items and session summaries to Open Brain when a work session ends

**MCP tools it uses:**
- `search_thoughts` - checks for existing matches before capturing (optional)
- `capture_thought` - stores ACT NOW items and session summary

**Prerequisites:**
- Working Open Brain setup with capture tool available
- AI client that supports reusable skills/rules
- Recommended: search tool to avoid duplicates

**Ready to use:** Yes
- Behavioral protocol, not background hook
- Very specific about what to capture (ACT NOW items only, not noise)
- Includes provenance and concrete next actions

**Notes on adaptation:** None needed. Skill is intentionally simple and behavioral, focusing on capturing only high-value outputs.

---

## 6. Claudeception
**Name and purpose:** Extract reusable knowledge from work sessions and codify it into new skills

**MCP tools it uses:**
- `search_thoughts` - searches for existing knowledge/skills before creating new ones
- `capture_thought` - records new skill creation in Open Brain for future discovery

**Prerequisites:**
- Working Open Brain setup (for duplicate checking and capture)
- AI client that can load and execute the skill
- File system access to save new skill files

**Ready to use:** Yes
- Comprehensive extraction process with quality gates
- Prevents duplicate skills via Open Brain search
- Structured skill creation template included

**Notes on adaptation:** None needed. Skill provides complete workflow for knowledge extraction and skill creation.

---

## Overall Assessment

All 6 skills are:
- **Pure prompt files** - no code deployment required
- **Well-documented** - include READMEs with installation and troubleshooting
- **Production-ready** - include lessons learned from real use
- **MCP-integrated** - properly use search/capture tools where beneficial
- **Self-contained** - can work independently or be chained together

The skills form a cohesive ecosystem for knowledge management, from raw input capture to synthesis to skill creation.