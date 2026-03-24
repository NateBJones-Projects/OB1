# MCP Tool Audit & Optimization Guide

You installed Open Brain. You built a few extensions. Maybe you went further and created your own MCP server covering every table in your database. Now your AI is holding 30, 40, 50+ tool definitions in context on every single message — and you're starting to notice: slower responses, tools getting ignored, the AI picking the wrong tool, or just a vague sense that things aren't working as well as they used to.

This guide helps you audit what you've got, identify what's costing you, and right-size your tool surface area so your AI stays sharp.

**Who this is for:** Anyone running multiple MCP servers or a single server with more than ~10 tools. If your AI has started misrouting tool calls or you've built a "do everything" MCP server, this is for you.

**What you'll need:** An AI client with your MCP servers connected (Claude, ChatGPT, Gemini — any of them work).

---

## Why Tool Count Matters

Every MCP tool you expose sends its full definition — name, description, parameter schema — into your AI's context window on every message. This isn't free.

**The math:** A typical MCP tool definition runs 150–400 tokens depending on parameter complexity. At 40 tools, that's 6,000–16,000 tokens of context consumed before you've said a word. That's context your AI can't use for your actual conversation, retrieved memories, or reasoning.

**The routing problem:** More tools means more chances for the AI to pick the wrong one. When you have `search_contacts`, `search_household_items`, `search_recipes`, `search_thoughts`, `search_activities`, and `search_maintenance_history` all loaded simultaneously, the AI has to distinguish between six similarly-named tools on every query. Stronger models (Claude Opus) handle this well. Weaker models start misfiring. From [Issue #36](https://github.com/NateBJones-Projects/OB1/issues/36):

> This is the difference between new OpenClaw users who are wow'd and three weeks in and everything falls over in context weight.

**What deferred loading solves (and doesn't):** Claude's MCP Tool Search feature defers loading tool definitions when they exceed 10% of context — roughly an 85% reduction in context overhead. This helps with the context weight problem. But it doesn't help with routing accuracy: the AI still has to discover and choose between all available tools, and multi-step prompts that span multiple servers remain hard to route correctly.

The bottom line: fewer, smarter tools beat many narrow ones.

---

## 1. Auditing Your Tools

Before you can optimize, you need to see what you've got. The fastest way is to ask your AI to do the audit for you.

### Quick audit

Paste this into any MCP-connected AI conversation:

```text
List every MCP tool you currently have access to. For each tool, show:
- Tool name
- Which MCP server it belongs to
- A one-line summary of what it does

Group them by server, then give me a total count.
```

This gives you the lay of the land. If the total count is under 10, you're probably fine. If it's over 20, keep reading.

### Deep audit

For a more thorough analysis, use the **Audit My MCP Tools** prompt kit in [Section 4](#4-prompt-kits) below. It groups tools by entity, flags redundancies, estimates context cost, and identifies tools you're probably never using.

### What to look for

**Redundant CRUD patterns.** The most common bloat pattern is one tool per operation per table:

| Tool | What it does |
|------|-------------|
| `create_recipe` | Inserts a recipe |
| `get_recipe` | Reads a recipe by ID |
| `update_recipe` | Updates a recipe |
| `delete_recipe` | Deletes a recipe |
| `list_recipes` | Lists all recipes |
| `search_recipes` | Searches recipes |

That's 6 tools for one table. Multiply by 5–8 tables and you're at 30–48 tools before you've added anything interesting.

**Tools that duplicate each other across servers.** If your CRM server has `search_contacts` and your household server has `search_vendors`, and both are just doing ILIKE queries against different tables with the same pattern — that's two tool definitions doing essentially the same thing.

**Tools you never use.** Be honest: when was the last time you asked your AI to `delete_recipe` or `update_household_item`? Most people capture and search. Update and delete are maintenance operations that don't need to be loaded into every conversation.

**Tools with overlapping descriptions.** If two tool descriptions start with "Search for..." and the AI has to read deep into the parameter schema to tell them apart, that's a routing risk.

---

## 2. Merging Tools

Once you've identified bloat, here are the patterns for consolidating.

### Pattern A: The unified CRUD tool

Instead of 5 separate tools per table, expose one tool with an `action` parameter:

**Before (5 tools):**
```
create_recipe
get_recipe
update_recipe
delete_recipe
list_recipes
```

**After (1 tool):**
```
manage_recipe
  action: "create" | "read" | "update" | "delete" | "list"
  id: (required for read/update/delete)
  data: (required for create/update — contains the recipe fields)
  filters: (optional for list — search/filter parameters)
```

**Token savings:** ~800–1,500 tokens per table, depending on parameter complexity.

**Tradeoff:** The single tool's description and parameter schema is more complex. The AI needs to understand the `action` parameter and which sub-parameters apply to each action. Strong models handle this well. If you're on a weaker model, Pattern B may be better.

### Pattern B: Read/write split

A gentler consolidation that preserves clear intent:

**Before (5 tools):**
```
create_recipe
get_recipe
update_recipe
delete_recipe
search_recipes
```

**After (2 tools):**
```
save_recipe       — creates or updates (upsert pattern)
query_recipes      — search, filter, get by ID, list all
```

This maps to how people actually talk to their AI: "save this" or "find that." The AI rarely needs to distinguish between create and update — upsert handles both. Similarly, "get by ID" and "search by keyword" are both query operations.

**Token savings:** ~500–1,000 tokens per table.

**Tradeoff:** Less precise routing, but the two-tool split matches natural language patterns well enough that misrouting is rare.

### Pattern C: The generic entity manager

For tables with similar schemas (all your Open Brain extension tables follow the same `user_id` + timestamps + domain fields pattern), you can go further:

**Before (20+ tools across 4 extensions):**
```
add_household_item, search_household_items, get_item_details,
add_vendor, list_vendors,
add_maintenance_task, log_maintenance, get_upcoming_maintenance,
search_maintenance_history, add_family_member, ...
```

**After (2–3 tools):**
```
save_entity
  entity_type: "household_item" | "vendor" | "maintenance_task" | ...
  data: { ... entity-specific fields ... }

query_entities
  entity_type: "household_item" | "vendor" | "maintenance_task" | ...
  filters: { search?: string, category?: string, date_range?: ... }

get_entity_detail
  entity_type: string
  id: UUID
```

**Token savings:** Dramatic — you're replacing N×5 tools with 2–3.

**Tradeoff:** This is the most aggressive consolidation. The tool descriptions become complex because they need to document the valid fields for each entity type. Works well if your tables genuinely share similar structures. Falls apart if each table has wildly different parameters or if the AI needs domain-specific context in the tool description to make good decisions.

### When NOT to merge

Not everything should be consolidated:

- **Cross-extension bridge tools** (`link_thought_to_contact`, `link_contact_to_professional_crm`) — These orchestrate across domains. Their specificity is the point.
- **Tools with complex, unique workflows** (`generate_shopping_list` in Meal Planning) — These aren't CRUD. Merging them into a generic tool loses the workflow context.
- **High-frequency tools** (`capture_thought`, `search_thoughts`) — The core Open Brain tools benefit from being individually named and described. The AI needs to reach for these quickly and confidently.

---

## 3. Scoping by Use Case

Merging tools reduces count within a server. Scoping splits tools across servers by workflow, so you only load what's relevant to what you're doing right now.

### The three-server pattern

Most Open Brain users' workflows fall into three modes:

#### Capture server (write-heavy)
**When you use it:** Quick capture moments — jotting down a thought, logging a contact interaction, saving a recipe.

**Tools to include:**
- `capture_thought`
- `save_entity` (if using the generic pattern) or individual `add_*` tools
- `log_interaction`, `log_maintenance`

**What to leave out:** Search, reporting, admin operations. When you're capturing, you want the AI focused on saving, not tempted to search or retrieve.

**Context cost:** ~5–8 tools, ~1,500–3,000 tokens.

#### Query server (read-heavy)
**When you use it:** Research, recall, weekly reviews, planning sessions — any time you're pulling information out rather than putting it in.

**Tools to include:**
- `search_thoughts` (semantic search)
- `query_entities` or individual `search_*`/`get_*` tools
- `get_upcoming_maintenance`, `get_week_schedule`, `get_pipeline_overview`
- Cross-extension bridge tools (these are read-oriented orchestrations)

**What to leave out:** Create/update/delete operations. When you're reviewing and synthesizing, you don't need write tools cluttering the routing space.

**Context cost:** ~8–12 tools, ~3,000–5,000 tokens.

#### Admin server (rarely used)
**When you use it:** Occasional maintenance — bulk updates, deletions, schema changes, data cleanup.

**Tools to include:**
- `update_*` and `delete_*` tools
- Bulk operation tools
- Data migration utilities
- Any tool you use less than once a week

**What to leave out:** Everything else. This server only gets connected when you're explicitly doing maintenance.

**Context cost:** Doesn't matter — it's rarely connected.

### How to decide what goes where

Ask yourself three questions for each tool:

1. **When do I use this?** During quick capture, during deep work/research, or during occasional maintenance?
2. **How often do I use this?** Daily → capture or query server. Weekly → query server. Monthly or less → admin server.
3. **Does this tool need other tools nearby to be useful?** If `generate_shopping_list` only makes sense alongside `get_meal_plan`, they belong on the same server.

### Implementation

Each scoped server is its own Supabase Edge Function with its own MCP tool definitions. They share the same database — scoping is about which tools are exposed, not which data is accessible.

In Claude Desktop: Settings → Connectors. Add each server as a separate connector. Connect only the ones relevant to your current task. The admin server stays disconnected until you need it.

The **Design My MCP Scoping** prompt kit in [Section 4](#4-prompt-kits) walks you through this decision process interactively.

---

## 4. Prompt Kits

Four ready-to-paste prompts to help you audit, optimize, and scope your MCP tools. Use them with any MCP-connected AI client.

---

### Prompt Kit 1: Audit My MCP Tools

**Job:** Produces a full inventory of your connected MCP tools with groupings, redundancy flags, and usage analysis.

**When to use:** Before any optimization work. Run this first to see what you're working with.

````text
<role>
You are an MCP tool auditor. Your job is to analyze every MCP tool currently available to you and produce a structured report that helps the user understand their tool surface area.
</role>

<instructions>
1. List every MCP tool you have access to. For each tool, extract:
   - Tool name
   - Server/source it belongs to
   - Description (from the tool definition)
   - Number of parameters
   - Required vs optional parameter count

2. Group the tools by entity/domain (e.g., all recipe-related tools together, all contact-related tools together). If a tool doesn't clearly belong to one entity, create a "cross-cutting" group.

3. Within each group, flag:
   - **CRUD redundancy**: If there are separate create/read/update/delete/list tools for the same entity, mark them as "CRUD set — consolidation candidate"
   - **Search overlap**: If multiple tools across different groups perform search/filter operations with similar patterns, flag them
   - **Orphan tools**: Tools that don't logically group with anything else

4. Produce this summary:

   **Tool Inventory**
   - Total tools: [count]
   - Tools by server: [server name: count, ...]
   - Tools by group: [group name: count, ...]

   **Estimated Context Cost**
   - Approximate tokens consumed by tool definitions: [rough estimate based on description + parameter schema complexity]
   - As percentage of a 200k context window: [percentage]
   - As percentage of a 128k context window: [percentage]

   **Consolidation Opportunities**
   - CRUD sets that could merge: [list with current tool count → suggested tool count]
   - Search tools that overlap: [list]
   - Rarely-useful tools to move to an admin server: [list with reasoning]

   **Recommended Actions** (prioritized by token savings):
   1. [Highest-impact consolidation]
   2. [Second-highest]
   3. [...]

5. End with: "Want me to draft the merged tool definitions for any of these recommendations?"
</instructions>
````

---

### Prompt Kit 2: Suggest Tool Merges

**Job:** Takes your current tool inventory and produces concrete before/after merge recommendations with implementation guidance.

**When to use:** After running the audit, when you're ready to consolidate.

````text
<role>
You are an MCP tool architect. Your job is to analyze the user's current MCP tools and recommend specific merges that reduce tool count while preserving functionality.
</role>

<instructions>
1. List all MCP tools currently available to you. Group them by the entity or table they operate on.

2. For each group with 3+ tools, evaluate whether they can be merged. Consider:
   - Can CRUD operations (create/read/update/delete) be combined into a single tool with an `action` parameter?
   - Can search and get-by-ID be combined into a single query tool?
   - Are there tools that are just variations of the same operation (e.g., `list_vendors` and `search_vendors`)?

3. For each recommended merge, provide:

   **Before:**
   ```
   Tool 1: [name] — [what it does]
   Tool 2: [name] — [what it does]
   Tool 3: [name] — [what it does]
   ```

   **After:**
   ```
   Merged tool: [name]
   Description: [clear, complete description]
   Parameters:
     action: [enum of supported actions]
     [other params with types and descriptions]
   ```

   **Savings:** [N] tools → [1-2] tools, ~[X] tokens saved

4. Flag any tools that should NOT be merged and explain why (unique workflows, cross-extension bridges, high-frequency tools that benefit from specific names).

5. Provide a priority order: which merges give the biggest context savings with the least complexity increase?

6. End with a summary table:

   | Group | Current Tools | Merged Tools | Token Savings |
   |-------|--------------|--------------|---------------|
   | ...   | ...          | ...          | ...           |
   | **Total** | **[N]** | **[M]** | **~[X] tokens** |
</instructions>
````

---

### Prompt Kit 3: Design My MCP Scoping

**Job:** Interactive conversation that helps you decide how to split your tools across multiple MCP servers based on your actual usage patterns.

**When to use:** After you've audited and merged tools, when you're ready to organize them into scoped servers.

````text
<role>
You are an MCP architecture consultant. Your job is to help the user split their MCP tools across multiple servers based on how they actually use them, so they can connect only the relevant tools for each workflow.
</role>

<instructions>
1. First, list all MCP tools currently available and ask the user:
   "I can see [N] tools across [M] servers. Before I recommend a scoping plan, I need to understand how you use them. I'll ask a few questions."

2. Ask these questions (one at a time, wait for answers):
   a. "What does your typical quick capture look like? When you want to save something fast, which tools do you reach for?"
   b. "What about research or recall sessions — when you're pulling information out, which tools do you use most?"
   c. "Are there tools you've set up but rarely or never actually use?"
   d. "Do you use different AI clients for different tasks? (e.g., Claude for deep work, ChatGPT for quick captures)"

3. Based on their answers, draft a scoping plan with 2-4 servers:

   **Server: [name] — [one-line purpose]**
   Connect when: [usage scenario]
   Tools:
   - [tool name] — [why it belongs here]
   - ...
   Estimated context cost: ~[X] tokens

   Repeat for each server.

4. Show what the user gains:
   - Current state: [N] tools, ~[X] tokens always loaded
   - Proposed: [capture count] + [query count] tools loaded per typical session
   - Context savings: ~[Y]% reduction in typical use

5. Ask: "Does this split match how you actually work? Any tools I've put in the wrong bucket?"

6. After the user confirms or adjusts, provide implementation guidance:
   - Which tools to put in each Edge Function
   - How to name the servers for clarity in the Claude Desktop connector list
   - Reminder to test each server independently after splitting
</instructions>
````

---

### Prompt Kit 4: Estimate My Context Cost

**Job:** Quick calculation of how much context window your MCP tool definitions are consuming.

**When to use:** Anytime you want a fast check on your tool overhead. Takes about 30 seconds.

````text
<role>
You are a context window analyst. Estimate the token cost of all MCP tool definitions currently loaded.
</role>

<instructions>
1. List every MCP tool currently available to you.

2. For each tool, estimate its token footprint based on:
   - Tool name: ~5 tokens
   - Description: count words, multiply by 1.3 (rough token-to-word ratio)
   - Each parameter: ~20-40 tokens (name + type + description + constraints)
   - Enum values: ~3 tokens each
   - Required/optional metadata: ~5 tokens per parameter

3. Present the results:

   | Tool Name | Est. Tokens | Parameters |
   |-----------|------------|------------|
   | ... | ... | ... |
   | **Total** | **[sum]** | |

   **Context Impact:**
   - Total tool definition tokens: ~[X]
   - Claude (200k context): [X/200000 * 100]% of context consumed by tools alone
   - ChatGPT (128k context): [X/128000 * 100]% consumed
   - Gemini (1M context): [X/1000000 * 100]% consumed

   **Verdict:** [One of: "Your tool surface is lean — no action needed", "Moderate overhead — merging would help on smaller context windows", "Heavy overhead — optimization recommended for all clients"]

4. If the total exceeds 5% of any common context window, add: "Your top 3 heaviest tools by token count are [X, Y, Z]. These would be the highest-impact targets for consolidation."
</instructions>
````

---

## Open Brain Extension Benchmark

For reference, here's what the official Open Brain extensions expose:

| Extension | Tools | Cross-Extension |
|-----------|-------|----------------|
| 1. Household Knowledge | 5 | — |
| 2. Home Maintenance | 4 | — |
| 3. Family Calendar | 6 | — |
| 4. Meal Planning | 6 + 4 shared | — |
| 5. Professional CRM | 7 | 1 bridge to core |
| 6. Job Hunt Pipeline | 8 | 1 bridge to CRM |
| **All extensions** | **40** | **2 bridges** |

With all 6 extensions connected simultaneously, that's ~40 tool definitions. Based on community testing ([Issue #36](https://github.com/NateBJones-Projects/OB1/issues/36)), Claude Opus handles this fine in scripted use but routing accuracy degrades for ambiguous, multi-domain prompts — and weaker models struggle significantly.

The official extensions are designed to be connected selectively (you don't need Meal Planning loaded during a job search), but many users connect everything and leave it. This guide helps you be intentional about it.

---

## Further Reading

- [Issue #36: MCP Scoping & Cross-Entity Orchestration](https://github.com/NateBJones-Projects/OB1/issues/36) — The full discussion on context weight, routing accuracy, and architectural options
- [Issue #61: Standardize Ingestion Patterns](https://github.com/NateBJones-Projects/OB1/issues/61) — Related work on consolidating how thoughts get into the system
- [Companion Prompts](02-companion-prompts.md) — The core Open Brain prompt kits
- [FAQ](03-faq.md) — Common issues and solutions
