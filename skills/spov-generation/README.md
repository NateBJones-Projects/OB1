# SPOV Generation

> Generate truth/myth Spiky Points of View with confidence scoring from accumulated insights.

## What It Does

Transforms DOK2 knowledge clusters and DOK3 strategic insights into bold, actionable SPOVs (Strongly Pointed-Out Views) that challenge conventional wisdom. Each SPOV is classified as either a "truth" (surprising but true) or "myth" (commonly believed but false), complete with confidence scoring and supporting evidence.

## Supported Clients

- Claude Code
- Codex
- Cursor
- Any AI client that supports reusable skills or custom instructions

## Prerequisites

- Working Open Brain setup if this skill uses Open Brain tools ([guide](../../docs/01-getting-started.md))
- AI client that supports reusable skills, rules, or custom instructions
- Access to insights or knowledge clusters to process
- Basic understanding of truth/myth frameworks

## Installation

1. Copy `SKILL.md` into the right folder for your client
2. Restart or reload the client so it picks up the new skill
3. Verify by invoking the trigger phrase or workflow

## Trigger Conditions

- "Generate SPOVs from these insights"
- "Create truth/myth statements"
- "Transform this knowledge into contrarian positions"
- "Apply confidence scoring to insights"
- Combine insights from multiple domains

## Expected Outcome

When you provide insights to this skill, it will generate structured SPOVs with:
- Provocative titles for contrarian views
- Clear "truth" or "myth" classification
- Bold, actionable positions
- Supporting evidence (2-3 key facts)
- Confidence scores (0.1-0.95)
- Links to source insights

## Troubleshooting

**Issue: SPOVs are too conservative**
Solution: Ensure you're using bold language that challenges conventional wisdom, not just observations.

**Issue: Confidence scores are clustered**
Solution: Use the full 0.1-0.95 range: 0.1-0.3 (speculative), 0.3-0.5 (plausible), 0.5-0.7 (moderately supported), 0.7-0.85 (well-supported), 0.85-0.95 (strongly supported).

**Issue: SPOVs don't combine domains**
Solution: Explicitly ask the AI to "combine insights from at least 2 different domains" to create cross-domain SPOVs.

## Notes for Other Clients

This skill works best when given structured input with clear source documentation. For non-Claude clients, ensure the system prompt includes:
- The truth/myth framework definition
- The requirement to combine insights from multiple domains
- The confidence scoring guidelines
- The structured output format with title, type, position, evidence, challenge, confidence, and sources