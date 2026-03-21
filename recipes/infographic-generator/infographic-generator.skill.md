---
name: infographic-generator
description: Generate infographic images from any research doc, Open Brain thoughts, or analysis. Auto-chunks content, writes prompts, generates images via Gemini API (free tier), and saves to media/. Use --premium for better text rendering.
---

# Infographic Generator

Turn research, analysis, or documentation into infographic images. Generates verbose prompts, then calls the Gemini API to create the images automatically.

## Commands

| Invocation | What it does |
|-----------|-------------|
| `infographic docs/strategy/deal.md` | Full pipeline: read doc, write prompts, generate images, save to media/ |
| `infographic current` | Use recent conversation content as source |
| `infographic --generate-only infographic-prompts/deal.md` | Skip prompt writing, just generate images from existing prompt file |
| `infographic --premium docs/report.md` | Use higher-quality model (better text rendering) |
| `infographic --redo 3 infographic-prompts/deal.md` | Regenerate just infographic #3 from existing prompts |

## Shorthand triggers

These also activate this skill:
- "infographic", "image prompt", "visualize this", "make this visual", "turn into a graphic"
- "generate the infographics", "make the images"
- "redo that one", "fix that image", "regenerate #3"

## Process

### Step 1: Route the request

Check the arguments:
- If `--generate-only <file>` or `--redo N <file>`: skip to Step 6 (generation only)
- If a file path is provided: read that file as source content
- If "current": use the most recent research/analysis from the conversation
- If no argument: ask the user what content to convert

### Step 2: Identify the audience

Check for audience keywords. Default: business professional.

| Keyword | Calibration |
|---------|------------|
| Family/non-technical | Simplify heavily. No jargon. Warm tone. |
| Industry peers | Industry-aware. Technical terms are fine. Business model clarity. |
| C-suite/prospects | ROI-focused. Numbers, percentages, before/after. |
| LinkedIn/social | Hook-driven. One big insight per graphic. Bold headline. |
| Technical | Full detail. Architecture diagrams, competitive landscapes, financial models. |

### Step 3: Analyze and chunk the content

Read the source and identify logical segments. Each segment = one infographic prompt.
- One infographic per major topic or section
- Maximum 5-7 data points per graphic
- Tables, timelines, hierarchies, and flows each get their own graphic
- If content would make 8+ graphics, split into two files by theme

### Step 4: Generate verbose prompts

For EACH segment, write a prompt block following this structure:

```
## Infographic [N]: [Title]
**Audience:** [who]

### Prompt (copy everything below this line)

Create a professional infographic with the following specifications:

**Subject:** [one-sentence summary]

**Key Data Points:**
- [bullet 1 with specific numbers]
- [bullet 2-7 max]

**Visual Layout:**
- [layout type: flow chart, comparison, timeline, pyramid, etc.]
- [spatial arrangement]
- Aspect ratio: [16:9 for landscape, 4:5 for phone, 1:1 for general, 9:16 for tall]

**Design Style:**
- [specific hex colors, not just "blue"]
- [background, corner style, icon style]

**Typography:**
- Headline: [max 8 words]
- Subheadline: [the "so what"]
- Data labels: small but readable
- No paragraphs. Bullets and numbers only.

**What to emphasize:**
- [the single most important takeaway]

**What to avoid:**
- Stock photos, clip art, cheesy business imagery
- More than 3 colors plus neutrals
- Tiny text or overcrowded layouts
- Generic AI aesthetic (gradients, floating cubes, robot hands)
```

### Step 5: Save prompts

Write all prompts to `./infographic-prompts/[source-filename]-prompts.md`. Create the directory if needed. Display in conversation too.

### Step 6: Generate images

Run the generation script:

```bash
python3 ~/.claude/skills/infographic-generator/generate.py \
  "[prompts-file-path]" \
  --output-dir "./media" \
  [--premium] \
  [--redo N]
```

After generation:
1. Read the manifest file (`media/_latest_generation.json`) to see what was created
2. Display each generated image to the user using the Read tool so they can review
3. Ask: "Any of these need a redo? Say 'redo 3' or 'redo 3 premium' to regenerate with better quality."

### Step 7: Handle redo requests

When user says "redo N" or "fix that one" or "redo N premium":
- Parse which infographic number to redo
- If "premium" mentioned, add --premium flag
- Run generation script with --redo N
- Show the new result
- Ask again if they want more changes

## Important rules

- Keep prompts verbose (300+ words each). More detail = better images.
- Always include specific hex colors, not just "blue" or "green."
- Always specify aspect ratio.
- Always mention what to AVOID (dramatically improves output).
- If content has numbers, ALWAYS include them. Numbers make infographics credible.
- Each prompt is independently useful (don't reference other prompts).
- Default to FREE model. Only use premium when user explicitly asks or when redoing a specific image.

## Open Brain Integration

**As source:** Use `search_thoughts` to find content on a topic, synthesize it, then generate infographics from the synthesis.

**As storage:** After generation, capture the prompts to Open Brain with `capture_thought`. This creates a searchable library of visual templates that can be regenerated or adapted in future sessions.
