# Bring Your Own Context

<!-- markdownlint-disable MD013 -->

Portable context workflow for extracting what your AI already knows,
turning it into a structured operating profile, and carrying that profile
across AI clients.

> [!IMPORTANT]
> This is a composition recipe. It does not introduce a new MCP server or a
> new tool surface in v1.

It packages existing Open Brain pieces into one entrypoint:

- focused extraction prompts in [extraction-prompts.md](./extraction-prompts.md)
- the canonical [Work Operating Model skill](../../skills/work-operating-model/)
- the paired [Work Operating Model Activation recipe](../work-operating-model-activation/)
- the existing [Remote MCP Connection](../../primitives/remote-mcp/) pattern

## What It Does

Bring Your Own Context gives you one publishable workflow for portable AI context inside OB1.

You first seed Open Brain with reviewed context using the extraction prompts in this folder. Then you run the existing Work Operating Model workflow to turn that raw context into a reusable bundle with a documented contract:

- `operating-model.json`
- `USER.md`
- `SOUL.md`
- `HEARTBEAT.md`
- `schedule-recommendations.json`

The machine-readable schema for that bundle lives in [context-profile.schema.json](./context-profile.schema.json).

## Prerequisites

- Working Open Brain setup ([guide](../../docs/01-getting-started.md))
- Existing core Open Brain connector with `search_thoughts` and `capture_thought`
- AI client that supports reusable skills or prompt packs
- Supabase CLI installed and linked to your project
- Canonical [Work Operating Model skill](../../skills/work-operating-model/)
- Optional source material to import: existing AI memory, exported notes, Obsidian vault content, Notion exports, text files, or similar context sources

## Credential Tracker

Copy this block into a text editor and fill it in as you go.

```text
BRING YOUR OWN CONTEXT -- CREDENTIAL TRACKER
--------------------------------------------

FROM YOUR OPEN BRAIN SETUP
  Project URL:                ____________
  Project ref:                ____________
  MCP Access Key:             ____________
  Core connector available:   yes / no
  Core search tool visible:   yes / no
  Core capture tool visible:  yes / no

GENERATED DURING SETUP
  Prompt source used:         memory / import / both
  DEFAULT_USER_ID:            ____________
  Function URL:               ____________
  MCP Connection URL:         ____________
  Latest session ID:          ____________
  Current profile version:    ____________

--------------------------------------------
```

## Recipe Assets

- [extraction-prompts.md](./extraction-prompts.md) — the two prompt assets promised in the article
- [context-profile.schema.json](./context-profile.schema.json) — machine-readable contract for the portable bundle returned by `generate_operating_model_exports`
- [Work Operating Model Activation](../work-operating-model-activation/) — the profiling engine this recipe reuses

## Steps

![Step 1](https://img.shields.io/badge/Step_1-Choose_Your_Extraction_Pass-0F766E?style=for-the-badge)

Pick the right prompt from [extraction-prompts.md](./extraction-prompts.md):

- Use **Memory Extraction** if the AI platform already knows a lot about you from past chats or built-in memory.
- Use **Context Import** if you are bringing in notes, exports, or another second-brain system.
- If both are true, run **Memory Extraction first** and **Context Import second**.

These prompts are intentionally upstream of profile generation. They create durable, searchable Open Brain context. They do **not** generate the final portable bundle by themselves.

✅ **Done when:** You know which extraction pass you are running and your core Open Brain connector is enabled in the client you will use.

---

![Step 2](https://img.shields.io/badge/Step_2-Seed_Open_Brain_With_Context-0F766E?style=for-the-badge)

Run the chosen prompt in your AI client with the core Open Brain connector enabled.

Rules to keep the BYOC corpus clean:

- review the preview batches before saving
- store self-contained statements, not shorthand fragments
- preserve names, dates, and decision context
- skip noise, templates, and obviously stale junk

This stage should leave you with durable raw context that the later profiling pass can search against.

✅ **Done when:** `search_thoughts` can find a few recent captures about your people, projects, decisions, or workflow.

---

![Step 3](https://img.shields.io/badge/Step_3-Install_The_Profiling_Workflow-0F766E?style=for-the-badge)

Install the canonical [Work Operating Model skill](../../skills/work-operating-model/) before doing anything else. BYOC reuses that exact interview behavior instead of inventing a second profiling prompt.

If you have not installed it yet, follow the installation steps in the skill README and confirm your client can load reusable prompt packs or skills.

✅ **Done when:** The Work Operating Model skill is available in your client and ready to use once the paired MCP tools are connected.

---

![Step 4](https://img.shields.io/badge/Step_4-Deploy_And_Connect_The_Profile_Server-0F766E?style=for-the-badge)

BYOC reuses the [Work Operating Model Activation](../work-operating-model-activation/) recipe as its structured profiling engine.

### 4.1 Run the schema

Run [`recipes/work-operating-model-activation/schema.sql`](../work-operating-model-activation/schema.sql) in the Supabase SQL Editor.

### 4.2 Generate a Default User ID

```bash
uuidgen | tr '[:upper:]' '[:lower:]'
```

Then set it as a secret:

```bash
supabase secrets set DEFAULT_USER_ID=your-generated-uuid
```

### 4.3 Deploy the Function

Use the [Deploy an Edge Function](../../primitives/deploy-edge-function/) pattern with these values:

| Setting | Value |
| ------- | ----- |
| Function name | `work-operating-model-mcp` |
| Download path | `recipes/work-operating-model-activation` |

### 4.4 Connect It to Your AI Client

URL-based connector example:

```text
https://YOUR_PROJECT_REF.supabase.co/functions/v1/work-operating-model-mcp?key=your-access-key
```

Header-based connector example for Claude Code:

```bash
claude mcp add --transport http work-operating-model \
  https://YOUR_PROJECT_REF.supabase.co/functions/v1/work-operating-model-mcp \
  --header "x-access-key: your-access-key"
```

Use the full [Remote MCP Connection](../../primitives/remote-mcp/) guide if your client needs a different setup path.

> [!IMPORTANT]
> Keep your base Open Brain connector enabled too. BYOC uses the existing Work Operating Model tools for structure, but it still depends on your core `search_thoughts` and `capture_thought` tools for memory hints and summary captures.

✅ **Done when:** Your client can see all six required tools:

- `search_thoughts`
- `capture_thought`
- `start_operating_model_session`
- `save_operating_model_layer`
- `query_operating_model`
- `generate_operating_model_exports`

---

![Step 5](https://img.shields.io/badge/Step_5-Build_The_Portable_Profile-0F766E?style=for-the-badge)

With both connectors enabled and the skill installed, prompt your AI client:

```text
Use the Work Operating Model workflow to interview me and build my operating model.
```

The workflow should:

1. call `start_operating_model_session`
2. search for hints in your seeded Open Brain context
3. interview you through the five fixed layers
4. show a checkpoint summary before every save
5. persist each approved layer with `save_operating_model_layer`
6. review contradictions with `query_operating_model`
7. return the final bundle with `generate_operating_model_exports`

BYOC is strongest when you treat the earlier extraction pass as raw material and this interview as the normalization pass. Do not skip the confirmation gates.

✅ **Done when:** The workflow reaches export generation without missing layers and returns a session ID plus a profile version.

---

![Step 6](https://img.shields.io/badge/Step_6-Use_The_Portable_Bundle-0F766E?style=for-the-badge)

The current portable bundle contract is:

- `operating-model.json` — structured JSON representation of the full profile
- `USER.md` — operator-facing profile summary
- `SOUL.md` — guardrails, heuristics, and knowledge to respect
- `HEARTBEAT.md` — recurring and event-driven check recommendations
- `schedule-recommendations.json` — machine-readable recommendation output

The transport shape returned by `generate_operating_model_exports` is documented in [context-profile.schema.json](./context-profile.schema.json). The schema also defines the parsed JSON contracts for `operating-model.json` and `schedule-recommendations.json` inside `$defs`.

This is the honest v1 BYOC story inside OB1:

- the **portable context profile** is the export bundle above
- the **context server pattern** is the existing remote MCP deployment flow you already use in Open Brain

✅ **Done when:** You can point to one export bundle, one schema file, and one recipe URL as the canonical BYOC entrypoint for the article.

## Expected Outcome

When this recipe is working correctly:

- your Open Brain contains reviewed context captured through the extraction prompts
- the Work Operating Model workflow can pull that context in as hints during the interview
- `query_operating_model` returns structured entries for rhythms, decisions, dependencies, institutional knowledge, and friction
- `generate_operating_model_exports` returns all five portable artifacts
- [context-profile.schema.json](./context-profile.schema.json) documents the response shape and the parsed JSON artifact contracts

## Troubleshooting

**Issue: `capture_thought` is not visible when I run the extraction prompt**
Solution: The BYOC prompt stage only works with your base Open Brain connector enabled. Re-enable the core connector first, then rerun the prompt.

**Issue: The Work Operating Model skill is loaded, but the profile tools are missing**
Solution: The skill and the recipe are paired. Install the skill from [skills/work-operating-model](../../skills/work-operating-model/) and deploy/connect the MCP server from [Work Operating Model Activation](../work-operating-model-activation/) before starting the interview.

**Issue: Export generation says layers are missing**
Solution: Every one of the five layers must be approved before `generate_operating_model_exports` can succeed. Resume the session, finish the missing layer, then export again.

**Issue: The connector works in one client but not another**
Solution: Use the connection style your client actually supports. Some clients want the URL with `?key=...`, while Claude Code prefers the header-based form. The [Remote MCP Connection](../../primitives/remote-mcp/) guide covers both.

## Next Steps

- Feed `USER.md`, `SOUL.md`, and `HEARTBEAT.md` into any agent workflow that accepts operating files or durable system context.
- Re-run the workflow after a major role change or workflow shift so your portable context stays current.
- Use the [MCP Tool Audit & Optimization Guide](../../docs/05-tool-audit.md) once you add the second connector so the tool surface stays manageable.

<!-- markdownlint-enable MD013 -->
