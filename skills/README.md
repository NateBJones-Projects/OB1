# Skills

Reusable AI client skills and prompt packs. These are the canonical home for reusable agent behavior: install the file, reload your client, and reuse the behavior across projects or other contributions.

Most skills here are useful on their own — Open Brain integration is additive. A few are tightly coupled to a running Open Brain and need the core setup to be meaningful. The **Works without OB1?** column makes that distinction explicit.

| Skill | What It Does | Works without OB1? | Contributor |
| ----- | ------------ | ------------------ | ----------- |
| [Auto-Capture Skill Pack](auto-capture/) | Captures ACT NOW items and session summaries to Open Brain when a session ends | ❌ Required | [@jaredirish](https://github.com/jaredirish) |
| [Autodream Brain Sync](autodream-brain-sync/) | Syncs Claude Code's local memory saves to Open Brain so memories are accessible from all AI clients and devices | ❌ Required | [@jaredirish](https://github.com/jaredirish) |
| [Weekly Signal Diff](weekly-signal-diff/) | Weekly scan that reweights a category/company universe using what Open Brain already knows about the user | ❌ Required | [@NateBJones](https://github.com/NateBJones) |
| [Work Operating Model Skill Pack](work-operating-model/) | Runs a five-layer elicitation interview and saves the approved operating model into structured Open Brain tables plus exports | ❌ Required | [@jonathanedwards](https://github.com/jonathanedwards) |
| [Competitive Analysis Skill Pack](competitive-analysis/) | Builds competitor briefs, pricing comparisons, market maps, and strategic recommendations | ✅ Yes | [@NateBJones](https://github.com/NateBJones) |
| [Financial Model Review Skill Pack](financial-model-review/) | Reviews an existing model for assumption quality, structural risk, and scenario gaps | ✅ Yes | [@NateBJones](https://github.com/NateBJones) |
| [Deal Memo Drafting Skill Pack](deal-memo-drafting/) | Turns existing diligence materials into structured deal, IC, or partnership memos | ✅ Yes | [@NateBJones](https://github.com/NateBJones) |
| [Research Synthesis Skill Pack](research-synthesis/) | Synthesizes source sets into findings, contradictions, confidence markers, and next questions | ✅ Yes | [@NateBJones](https://github.com/NateBJones) |
| [Meeting Synthesis Skill Pack](meeting-synthesis/) | Converts meeting notes or transcripts into decisions, action items, risks, and follow-up artifacts | ✅ Yes | [@NateBJones](https://github.com/NateBJones) |
| [Heavy File Ingestion Skill Pack](heavy-file-ingestion/) | Converts PDFs, decks, spreadsheets, and other bulky files into markdown, CSV, and a cheap structural index before analysis | ✅ Yes | [@NateBJones](https://github.com/NateBJones) |
| [Panning for Gold Skill Pack](panning-for-gold/) | Turns brain dumps and transcripts into evaluated idea inventories | ✅ Yes | [@jaredirish](https://github.com/jaredirish) |
| [Aiception Skill Pack (formerly Claudeception)](claudeception/) | Extracts reusable lessons from work sessions into new skills | ✅ Yes | [@jaredirish](https://github.com/jaredirish) |
| [N Agentic Harnesses Skill Pack](n-agentic-harnesses/) | Teaches an agent to select and adapt the right harness for a given job across different AI clients | ✅ Yes | [@NateBJones](https://github.com/NateBJones) |

**Compatibility legend:**
- ❌ **Required** — depends on the core Open Brain setup (Supabase + pgvector + MCP). Install Open Brain first, then this skill.
- ✅ **Yes** — works on its own with any supported AI client. If you also run Open Brain, the skill's outputs can be captured as thoughts, but nothing about the skill itself requires it.

## How Skills Differ From Recipes

- **Skills** are installable behaviors: prompt packs, system prompts, reusable operating procedures, and triggerable workflows.
- **Recipes** are fuller builds: setup guides, schema changes, automation wiring, and end-to-end implementations.
- **Recipes can depend on skills** via `requires_skills` when they build on reusable prompt behavior that lives here.
- If you just want the reusable agent behavior, start in `skills/`.
- If you need the full surrounding workflow, data model, or automation, start in `recipes/`.

## Contributing

Skills are open for community contributions. Keep them plain-text and reviewable: submit `SKILL.md`, `*.skill.md`, or `*-skill.md` files, not zipped exports. See [CONTRIBUTING.md](../CONTRIBUTING.md) for the full requirements.

Each skill's `metadata.json` must declare `requires.open_brain` as either `"required"` or `"optional"`. Use `"optional"` if the skill gives value with no Open Brain setup; use `"required"` if the skill's core behavior calls Open Brain tools or depends on Open Brain data shapes.
