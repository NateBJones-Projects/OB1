# Live Retrieval

*The read side of the flywheel.*

Automatically surfaces relevant Open Brain thoughts during active work. Fires when topic shifts are detected (person names, project names, technologies). Silent on miss, brief on hit. No manual searching required.

**This is the recipe nobody else has built.** Every OB1 recipe writes data in. This one reads it back during active creation.

## What It Does

You're working on a project. You mention a person's name or switch topics. The skill silently searches Open Brain. If it finds related thoughts you captured last week, it surfaces them in a brief 2-3 line note. If it finds nothing, you never know it searched.

The result: knowledge you captured Tuesday shows up Thursday when you're working on the same topic, without you having to remember it exists.

## Prerequisites

- Working Open Brain setup ([guide](../../docs/01-getting-started.md))
- Claude Code installed and working
- Open Brain MCP tools connected (`search_thoughts`, `list_thoughts`)

### Credential Tracker

```
From your existing Open Brain setup:
- Project URL: _______________
- Open Brain MCP server connected: yes / no

No additional credentials needed for this recipe.
```

## Steps

### 1. Create the skill directory

```bash
mkdir -p ~/.claude/skills/live-retrieval
```

### 2. Copy the skill file

```bash
cp live-retrieval.skill.md ~/.claude/skills/live-retrieval/SKILL.md
```

### 3. Verify Claude Code picks up the skill

Restart Claude Code. The skill fires proactively (you don't invoke it). To test: mention a topic you've previously captured thoughts about and see if context surfaces.

### 4. Work normally

The skill does its job in the background. You'll notice it when it surfaces something useful. You won't notice it when it doesn't.

### 5. Review the retrieval log

After a few sessions, check `.claude/live-retrieval-log.jsonl` in your project root to see hit/miss rates and tune sensitivity.

## Expected Outcome

When working correctly, you should see:

- At session start, a brief note showing recent Open Brain activity (ACT NOW items, recent captures)
- During work, occasional context notes when you mention a person or topic that has related thoughts
- No noise: if nothing relevant is found, nothing appears
- A growing retrieval log that helps tune the skill over time

Target: at least 1 useful surfacing per 5 sessions. If you're getting zero, your Open Brain may not have enough thoughts yet (keep using Auto-Capture and Panning for Gold to build density).

## Troubleshooting

**Issue:** The skill never surfaces anything.
**Solution:** Check that your Open Brain has thoughts to find. Run `list_thoughts({ "limit": 5 })` manually. If you have fewer than 20 thoughts, the density is too low for useful retrieval. Use the other flywheel recipes (Auto-Capture, Panning for Gold) to build up content first.

**Issue:** The skill surfaces too much irrelevant context.
**Solution:** Check the retrieval log. If hit scores are consistently below 0.6, the skill is matching on noise. This usually means your queries are too broad. The skill should only search on specific entity names, not generic topics.

**Issue:** `search_thoughts` MCP tool not available.
**Solution:** The skill silently skips when the MCP connection is down. Verify your Open Brain MCP server is connected in Claude Code settings. The skill degrades gracefully: no MCP means no retrieval, but no errors either.

---

*Every recipe writes in. This one reads back. The flywheel needs both sides.*
