---
name: claudeception
description: |
  Continuous learning system that extracts reusable knowledge from work sessions.
  Triggers: (1) /claudeception command to review session learnings, (2) "save this as a skill"
  or "extract a skill from this", (3) "what did we learn?", (4) After any task involving
  non-obvious debugging, workarounds, or trial-and-error discovery. Creates new skills
  when valuable, reusable knowledge is identified. Integrates with Open Brain to prevent
  duplicates and share knowledge across sessions.
author: Jared Irish
version: 2.0.0
---

# Claudeception

A continuous learning system that extracts reusable knowledge from work sessions and
codifies it into new skills. This enables autonomous improvement over time.

## Core Principle

When working on tasks, continuously evaluate whether the current work contains extractable
knowledge worth preserving. Not every task produces a skill. Be selective about what's truly
reusable and valuable.

## When to Extract

Extract when you encounter:

1. **Non-obvious Solutions**: Debugging that required significant investigation and wouldn't
   be immediately apparent to someone facing the same problem.
2. **Error Resolution**: Specific error messages and their actual root causes, especially
   when the error message is misleading.
3. **Tool Integration Knowledge**: How to properly use a tool, library, or API in ways
   that documentation doesn't cover well.
4. **Workflow Optimizations**: Multi-step processes that can be streamlined.
5. **Project-Specific Patterns**: Conventions or decisions specific to a codebase.

## Quality Criteria

Before extracting, verify:

- **Reusable**: Will this help with future tasks, not just this one instance?
- **Non-trivial**: Does this require discovery, not just documentation lookup?
- **Specific**: Can you describe exact trigger conditions and solution?
- **Verified**: Has this solution actually worked?

## Extraction Process

### Step 1: Search Open Brain for Existing Knowledge

Before creating anything, check if this knowledge already exists:

```
search_thoughts({ "query": "[keywords from the discovery]", "match_count": 5 })
```

| Search Result | Action |
|---------------|--------|
| Strong match found | Update the existing skill instead of creating new |
| Partial match | Create new, add "See also" cross-reference |
| No match | Create new |

### Step 2: Check for Existing Skills

Search local skill directories for related skills:

```
Look in:
  .claude/skills/          (project-level)
  ~/.claude/skills/        (user-level)
```

| Found | Action |
|-------|--------|
| Nothing related | Create new |
| Same trigger, same fix | Update existing (bump version) |
| Same trigger, different cause | Create new, link both ways |
| Partial overlap | Update existing with new variant subsection |

### Step 3: Research Current Best Practices

When the topic involves specific technologies or tools, search the web for current documentation
and best practices before creating the skill. Include a References section if external sources
were consulted. Skip this for project-specific internal patterns.

### Step 4: Structure the Skill

```markdown
---
name: [descriptive-kebab-case-name]
description: |
  [Precise description with: (1) exact use cases, (2) trigger conditions like
  specific error messages, (3) what problem this solves.]
author: [your name]
version: 1.0.0
---

# [Skill Name]

## Problem
[Clear description of the problem]

## Context / Trigger Conditions
[When should this fire? Include exact error messages, symptoms, scenarios]

## Solution
[Step-by-step solution]

## Verification
[How to verify it worked]

## Example
[Concrete example of applying this skill]

## Notes
[Caveats, edge cases, related considerations]

## References
[Links to docs or resources, if any]
```

### Step 5: Save the Skill

Save to the appropriate location:
- **Project-specific**: `.claude/skills/[skill-name]/SKILL.md`
- **User-wide**: `~/.claude/skills/[skill-name]/SKILL.md`

### Step 6: Capture to Open Brain

After creating the skill, save it to Open Brain so future sessions can find it:

```
capture_thought({
  "content": "New skill created: [skill-name]. [1-2 sentence summary of what it solves].
              Trigger: [exact trigger condition]. Location: ~/.claude/skills/[name]/SKILL.md"
})
```

### Step 7: Quality Gate Checklist

Before finalizing, verify:

- [ ] Description contains specific trigger conditions
- [ ] Solution has been verified to work
- [ ] Specific enough to be actionable
- [ ] General enough to be reusable
- [ ] No credentials or internal URLs included
- [ ] Doesn't duplicate existing skills
- [ ] Open Brain searched before creating
- [ ] Open Brain captured after creating

## Retrospective Mode

When `/claudeception` is invoked at session end:

1. Review the session for extractable knowledge
2. List candidates with brief justifications
3. Focus on highest-value, most reusable knowledge
4. Extract skills for top candidates (typically 1-3 per session)
5. Report what was created and why

## Self-Reflection Prompts

Use during work to spot extraction opportunities:

- "What did I just learn that wasn't obvious before starting?"
- "If I faced this exact problem again, what would I wish I knew?"
- "What error message led me here, and what was the actual cause?"
- "Is this pattern specific to this project, or would it help elsewhere?"

## Example: Complete Extraction Flow

**Scenario**: While deploying n8n workflows via API, you discover that the POST endpoint
rejects requests containing a `tags` field (returns "request/body/tags is read-only"),
even though the GET response includes tags. The API also uses a different key than
what's stored in the server's .env file.

**Step 1 - Search Open Brain**: `search_thoughts("n8n workflow API tags read-only")`
No match found.

**Step 2 - Check existing skills**: Search `~/.claude/skills/` for n8n-related skills.
Found `n8n-docker-troubleshooting` but it covers different issues (Code node sandbox).

**Step 3 - Structure the skill**:

```markdown
---
name: n8n-workflow-api-quirks
description: |
  Fix n8n REST API issues when importing/updating workflows. Use when:
  (1) POST /api/v1/workflows returns "tags is read-only",
  (2) API key from .env returns 401 but MCP config key works,
  (3) PATCH doesn't update workflow code (need delete + recreate).
author: Jared Irish
version: 1.0.0
---
# n8n Workflow API Quirks
## Problem
n8n's REST API has undocumented constraints...
```

**Step 4 - Save**: `~/.claude/skills/n8n-workflow-api-quirks/SKILL.md`

**Step 5 - Capture to Open Brain**: Records the skill's existence for cross-session discovery.

## Anti-Patterns

- **Over-extraction**: Not every task deserves a skill. Mundane solutions don't need preserving.
- **Vague descriptions**: "Helps with React" won't surface when needed.
- **Unverified solutions**: Only extract what actually worked.
- **Documentation duplication**: Don't recreate official docs. Link to them, add what's missing.
- **Skill hoarding**: If you have 30+ skills, review the 5 least-recently-modified for deprecation.

## Skill Lifecycle

1. **Creation**: Initial extraction with verified solution
2. **Refinement**: Update when additional use cases or edge cases are discovered
3. **Deprecation**: Mark deprecated when tools or patterns change
4. **Archival**: Remove skills that are no longer relevant

## Automatic Triggers

Invoke this skill after completing a task when ANY of these apply:

1. Solution required >10 minutes of investigation not found in documentation
2. Fixed an error where the error message was misleading
3. Found a workaround for a tool limitation that required experimentation
4. Discovered configuration that differs from standard patterns
5. Tried multiple approaches before finding what worked

Also invoke when the user runs `/claudeception`, says "save this as a skill", or asks "what did we learn?"
