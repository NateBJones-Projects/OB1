# Claudeception

*Skills that create other skills.*

A continuous learning system that extracts reusable knowledge from work sessions and codifies it into new AI coding tool skills. When you discover something non-obvious (a debugging technique, a workaround, an error resolution), Claudeception evaluates whether it's worth preserving and creates a structured skill file automatically.

**This is the meta-skill.** Every other recipe in OB1 does a specific thing. This one creates new things from the act of working.

## What It Does

During normal work, Claudeception watches for extractable knowledge:

| Discovery Type | Example | What Gets Created |
|----------------|---------|-------------------|
| Non-obvious debugging | Spent 20 min finding that n8n Code node blocks `process.env` | Skill: "n8n-code-node-sandbox-limits" |
| Error resolution | Misleading error led to wrong fix path | Skill with exact error message as trigger |
| Workflow optimization | Found a 3-step process that replaces a 10-step one | Skill documenting the shortcut |
| Tool integration | Discovered undocumented API behavior | Skill with the actual behavior documented |

Before creating, it searches Open Brain to check if the knowledge already exists. After creating, it captures the new skill to Open Brain so future sessions can find it.

## Prerequisites

- Working Open Brain setup ([guide](../../docs/01-getting-started.md))
- Claude Code installed and working
- Open Brain MCP tools connected (`search_thoughts`, `capture_thought`)

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
mkdir -p ~/.claude/skills/claudeception
```

### 2. Copy the skill file

```bash
cp claudeception.skill.md ~/.claude/skills/claudeception/SKILL.md
```

### 3. Verify Claude Code picks up the skill

Restart Claude Code. To verify, say "what did we learn?" or run `/claudeception` at the end of a work session. Claude should reference the Claudeception methodology.

### 4. Work normally

Claudeception fires automatically after tasks involving non-obvious investigation. You can also trigger it manually:

- `/claudeception` at end of session (retrospective mode)
- "save this as a skill" after a discovery
- "what did we learn?" to review the session

### 5. Review created skills

New skills appear in `~/.claude/skills/[skill-name]/SKILL.md`. Each includes:
- Problem description
- Trigger conditions (exact error messages, symptoms)
- Step-by-step solution
- Verification steps
- Quality gate checklist

## Expected Outcome

When working correctly, you should see:

- After non-obvious debugging sessions, a prompt asking whether to extract the knowledge
- Before creating a skill, an Open Brain search confirming no duplicate exists
- New skill files appearing in `~/.claude/skills/` with structured content
- After creation, the skill captured to Open Brain via `capture_thought`
- In future sessions, the skill fires automatically when trigger conditions match

A typical week of active development produces 1-3 new skills. Not every session produces one, and that's correct. Over-extraction is an anti-pattern.

## Open Brain Integration

Claudeception connects to Open Brain at two points:

**Before creating (search):** Queries `search_thoughts` with keywords from the discovery. If related knowledge already exists in Open Brain, it updates the existing skill instead of creating a duplicate.

**After creating (capture):** Saves the new skill to Open Brain via `capture_thought` with tags like `skill-created`, the skill name, and relevant domain tags. This means future sessions across any project can find the skill via semantic search.

**Example flow:**

```
Discovery: n8n Code node blocks process.env
  -> search_thoughts("n8n code node sandbox process.env")
  -> No match found
  -> Create skill: ~/.claude/skills/n8n-code-node-sandbox/SKILL.md
  -> capture_thought("New skill created: n8n-code-node-sandbox.
     n8n Code node v2 sandbox blocks process.env, fetch(), require().
     Only pure JS transforms on $input/$json work.")
```

## Adapting for Other Tools

The core pattern (discover, evaluate, extract, verify) works with any AI coding tool that supports custom instructions or skill files:

- **Cursor:** Save to `.cursorrules` or project-level rules
- **Windsurf:** Save to `.windsurfrules`
- **Codex:** Save to `AGENTS.md` or codex instructions

The skill file format may differ, but the extraction process and quality criteria are universal.

## Troubleshooting

**Issue:** Claudeception fires too often, creating low-value skills.
**Solution:** Check the quality criteria in the skill file. A skill must be reusable, non-trivial, specific, and verified. If it only helps with one instance and won't recur, it's not a skill.

**Issue:** Skills aren't being discovered in future sessions.
**Solution:** Check the `description` field in the skill's frontmatter. It needs specific trigger conditions (error messages, symptoms, tool names) for Claude Code's semantic matching to surface it. Vague descriptions like "helps with React" won't match.

**Issue:** Open Brain search returns nothing but a similar skill exists locally.
**Solution:** The skill may have been created before Open Brain integration was added. Run `/claudeception` in retrospective mode to capture existing skills to Open Brain.

**Issue:** Too many skills accumulating (30+).
**Solution:** Review the 5 least-recently-modified skills. If they haven't fired in 30+ days, either the trigger conditions are too narrow (update them) or the knowledge is no longer relevant (deprecate). Add a `deprecated: true` note to the frontmatter rather than deleting.

---

*The meta-skill. Skills that create other skills.*
