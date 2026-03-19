# Infographic Generator

*Turn research docs and Open Brain thoughts into professional infographic images*

Generate infographic images from any markdown document, research analysis, or Open Brain thought cluster using Gemini's free-tier image generation API. Auto-chunks content into logical segments, writes verbose image prompts, generates PNGs, and optionally captures prompts back to Open Brain for future retrieval.

## What It Does

Takes structured or unstructured content and runs a four-step process: **Analyze** the source for logical segments, **Chunk** into one-infographic-per-topic, **Prompt** with verbose image generation instructions (300+ words each with specific colors, layout, typography), and **Generate** actual PNG images via Gemini API. Prompts can be stored in Open Brain for future regeneration or adaptation.

## Prerequisites

- Working Open Brain setup ([guide](../../docs/01-getting-started.md))
- Claude Code (or another AI coding tool that supports skills/system prompts)
- Open Brain MCP tools connected (`capture_thought`, `search_thoughts`)
- Python 3.10+ installed
- Gemini API key (free tier, get one at [ai.google.dev](https://ai.google.dev))

### Credential Tracker

```
From your existing Open Brain setup:
- Project URL: _______________
- Open Brain MCP server connected: yes / no

New for this recipe:
- Gemini API key: _______________ (from ai.google.dev, free tier works)
```

## Steps

### 1. Create the skill directory

```bash
mkdir -p ~/.claude/skills/infographic-generator
```

### 2. Copy the skill and generation script

Copy `infographic-generator.skill.md` and `generate.py` from this recipe:

```bash
cp infographic-generator.skill.md ~/.claude/skills/infographic-generator/SKILL.md
cp generate.py ~/.claude/skills/infographic-generator/generate.py
chmod +x ~/.claude/skills/infographic-generator/generate.py
```

### 3. Set up the Python environment

```bash
cd ~/.claude/skills/infographic-generator
python3 -m venv .venv
source .venv/bin/activate
pip install google-genai Pillow
```

### 4. Set your Gemini API key

```bash
export GEMINI_API_KEY="your-api-key-here"
```

Or add it to your shell profile for persistence:

```bash
echo 'export GEMINI_API_KEY="your-api-key-here"' >> ~/.zshrc
```

### 5. Verify Claude Code picks up the skill

Restart Claude Code. To verify, say "make an infographic from this doc" or "visualize this research" and confirm it references the Infographic Generator methodology.

### 6. Generate your first infographic

Point the skill at any markdown file:

```
Make infographics from docs/research/my-analysis.md
```

Or use Open Brain as the source:

```
Visualize my thoughts about [topic]
```

The skill will:
1. Read and analyze the source content
2. Chunk into logical segments (one infographic per major topic)
3. Write verbose prompts with specific hex colors, layout types, and typography
4. Save prompts to `./infographic-prompts/`
5. Generate PNG images via Gemini API to `./media/`

### 7. Review and iterate

After generation, the skill shows each image. You can:

```
redo 3          # regenerate infographic #3
redo 3 premium  # regenerate with higher quality model
```

### 8. (Optional) Capture prompts to Open Brain

The generated prompts are 300+ word rich text documents. Storing them in Open Brain makes them searchable across sessions:

```
Save these infographic prompts to Open Brain
```

Future sessions can find them: `search_thoughts("infographic ROI analysis")`

## Expected Outcome

When working correctly, you should see:

- A prompt file saved to `./infographic-prompts/[source]-prompts.md` with one verbose prompt per content segment
- PNG images saved to `./media/` with descriptive filenames
- A manifest file at `./media/_latest_generation.json` linking filenames to titles
- Each prompt includes specific hex colors, aspect ratio, layout type, typography specs, and "what to avoid" guidance

A typical 2-page research doc yields 4-8 infographics. Generation takes 30-60 seconds per image on Gemini's free tier.

## Open Brain Integration

This recipe connects to Open Brain in two ways:

**As a source (read side):** Search Open Brain for thoughts on a topic, synthesize them, then generate infographics from the synthesis. "Visualize my thoughts about MSP operations" pulls relevant thoughts and creates visuals from them.

**As storage (write side):** Generated prompts can be captured back to Open Brain. This creates a searchable library of visual templates. "What infographic did I make for the deal structure?" returns the prompt, which can be regenerated or adapted for new content.

Together with [Panning for Gold](../brain-dump-processor/) and [Auto-Capture Protocol](../auto-capture-protocol/), this forms a complete capture-process-visualize flywheel (see [Issue #84](https://github.com/NateBJones-Projects/OB1/issues/84)).

## Troubleshooting

**Issue:** `GEMINI_API_KEY not set` error when generating.
**Solution:** Ensure the environment variable is exported in your current shell session. Run `echo $GEMINI_API_KEY` to verify. If using Claude Code, the shell inherits from your profile, so add it to `~/.zshrc` or `~/.bashrc`.

**Issue:** Gemini returns content policy errors for certain prompts.
**Solution:** Some prompts trigger safety filters (surveillance themes, medical imagery, etc.). The script retries once automatically. If it still fails, the prompt is logged and skipped. You can manually edit the prompt to soften the language and use `--redo N` to regenerate just that image.

**Issue:** Images have poor text rendering.
**Solution:** Gemini's free tier (Flash) struggles with small text in infographics. Use `--premium` flag for better text rendering (uses a higher-quality model, may require a paid API key depending on your Gemini plan).

**Issue:** Too many infographics generated from a short document.
**Solution:** The skill chunks aggressively by default (one per section/topic). For shorter docs, tell the skill: "Make 3 infographics max from this doc" to constrain output.

---

*Part of the [Open Brain Flywheel](https://github.com/NateBJones-Projects/OB1/issues/84): capture, process, visualize.*
