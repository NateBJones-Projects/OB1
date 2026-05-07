# BrainLift Converter

> Analyze and restructure data into knowledge bases optimized for LLMs using the BrainLift methodology.

## What It Does

Transforms raw source materials into structured BrainLift knowledge bases that optimize content for both human comprehension and computational processing. The methodology includes taxonomy development, expert analysis, source validation, insight generation, and spiky POV creation, with the ability to train LLMs on domain-specific contrarian insights.

## Supported Clients

- Claude Code
- Codex
- Cursor
- Any AI client that supports reusable skills or custom instructions

## Prerequisites

- Working Open Brain setup if this skill uses Open Brain tools ([guide](../../docs/01-getting-started.md))
- AI client that supports reusable skills, rules, or custom instructions
- Source materials to be converted
- Basic understanding of knowledge organization principles
- The spov-generation skill (for SPOV creation)

## Installation

1. Copy `SKILL.md` into the right folder for your client
2. Restart or reload the client so it picks up the new skill
3. Verify by invoking the trigger phrase or workflow

## Trigger Conditions

- "Convert these sources into a BrainLift"
- "Restructure data for LLM training"
- "Create knowledge base with taxonomy development"
- "Generate spiky POVs from accumulated insights"
- "Analyze and validate source materials"

## Expected Outcome

When you provide source materials, this skill will generate a complete BrainLift with:
- Clear purpose definition and usage scenarios
- Expert profiles with verified sources and contributions
- Truth/myth SPOVs with confidence scoring
- Strategic insights from source analysis
- Hierarchical knowledge tree with categorized subtopics
- Verified primary sources with working hyperlinks
- Cross-references between components

## Troubleshooting

**Issue: Sources cited as "Context" or "Internal Document"**
Solution: Explicitly instruct the AI that source materials CONTAIN lists of Sources and Insights, and should not be cited as a Source directly.

**Issue: Placeholder categories like "Category" or "Subcategory"**
Solution: Use the actual topic names and specific subtopic names that appear in the source materials.

**Issue: Duplicate SPOVs**
Solution: Check that confidence scoring uses the full 0.1-0.95 range and each SPOV combines insights from multiple domains.

**Issue: Missing expert profiles**
Solution: The AI should research additional relevant experts beyond those mentioned in the source materials.

## Notes for Other Clients

This skill requires careful prompt structure to work effectively across different AI clients. Ensure the system prompt includes:
- The complete BrainLift structure requirements
- The truth/myth SPOV framework
- The two-phase processing approach (Restructuring + Supplementation)
- Quality guidelines for hyperlink validation and terminology
- Cross-referencing requirements between components
- The need to avoid citing source materials directly (they contain sources/insights lists)