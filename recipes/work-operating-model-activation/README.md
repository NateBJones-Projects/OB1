# Work Operating Model Activation

> A conversation-first workflow that interviews you about how your work actually runs, stores the answers as structured Open Brain data, and generates agent-ready operating files.

## What It Does

This recipe adds a dedicated MCP server plus schema for a 45-minute elicitation workflow. The interview runs in five fixed layers:

1. operating rhythms
2. recurring decisions
3. dependencies
4. institutional knowledge
5. friction

Each approved layer is saved into structured tables, summarized into one durable Open Brain thought through your existing core connector, and made available for later querying and export generation.

This recipe depends on the canonical [Work Operating Model skill](../../skills/work-operating-model/), which owns the interview behavior. The recipe owns the data model, remote MCP server, and export snapshots.

## Prerequisites

- Working Open Brain setup ([guide](../../docs/01-getting-started.md))
- Existing core Open Brain connector with `search_thoughts` and `capture_thought`
- AI client that supports reusable skills or prompt packs
- Supabase CLI installed and linked to your project
- Canonical [Work Operating Model skill](../../skills/work-operating-model/)

## Credential Tracker

```text
WORK OPERATING MODEL ACTIVATION -- CREDENTIAL TRACKER
----------------------------------------------------

FROM YOUR OPEN BRAIN SETUP
  Project URL:           ____________
  Secret key:            ____________
  Project ref:           ____________
  MCP Access Key:        ____________
  Core Open Brain tools available:  yes / no

GENERATED DURING SETUP
  Default User ID:       ____________
  Function URL:          ____________
  MCP Connection URL:    ____________
  Current profile version: ____________

----------------------------------------------------
```

## Steps

### 1. Install the skill dependency

Follow the installation steps in the [Work Operating Model skill](../../skills/work-operating-model/). The skill handles the interview, confirmation gates, contradiction pass, and summary-thought capture.

### 2. Run the schema

Open your Supabase SQL Editor and run [`schema.sql`](./schema.sql):

```text
https://supabase.com/dashboard/project/YOUR_PROJECT_ID/sql/new
```

This creates:

- `operating_model_profiles`
- `operating_model_sessions`
- `operating_model_layer_checkpoints`
- `operating_model_entries`
- `operating_model_exports`

It also adds the helper RPC functions `operating_model_start_session()` and `operating_model_save_layer()` for atomic session and layer persistence.

### 3. Generate your default user ID

This recipe is single-user on purpose. Generate one UUID and reuse it for future sessions:

```bash
uuidgen | tr '[:upper:]' '[:lower:]'
```

Save it to your credential tracker, then set it in Supabase:

```bash
supabase secrets set DEFAULT_USER_ID=your-generated-uuid
```

### 4. Deploy the MCP server

Follow the [Deploy an Edge Function](../../primitives/deploy-edge-function/) guide using these values:

| Setting | Value |
|---------|-------|
| Function name | `work-operating-model-mcp` |
| Download path | `recipes/work-operating-model-activation` |

This function uses:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `MCP_ACCESS_KEY`
- `DEFAULT_USER_ID`

### 5. Connect it to your AI client

Use the [Remote MCP Connection](../../primitives/remote-mcp/) pattern.

| Setting | Value |
|---------|-------|
| Connector name | `Work Operating Model` |
| URL | Your function URL with the same MCP key pattern you use for your other OB1 servers |

Keep your core Open Brain connector enabled too. This recipe stores structured data in its own tables, but the skill still uses the base `search_thoughts` and `capture_thought` tools for hints and summary memory writes.

### 6. Start the interview

With both connectors enabled and the skill installed, prompt your AI client:

```text
Use the Work Operating Model workflow to interview me and build my operating model.
```

The skill should:

1. call `start_operating_model_session`
2. run the five layers in order
3. show a checkpoint summary after each layer
4. wait for your confirmation before saving
5. save the layer with `save_operating_model_layer`
6. capture one summary thought through your core Open Brain connector
7. run a contradiction pass
8. call `generate_operating_model_exports`

### 7. Review the exports

At the end of a successful run, the MCP server stores and returns:

- `operating-model.json`
- `USER.md`
- `SOUL.md`
- `HEARTBEAT.md`
- `schedule-recommendations.json`

These are stored in `operating_model_exports`, so they still exist even if your client cannot write files locally.

## Available MCP Tools

1. `start_operating_model_session`
   Create or resume the active interview run. Returns profile status, session status, completed layers, pending layer, session checkpoints, and latest approved checkpoints.

2. `save_operating_model_layer`
   Atomically upserts the approved layer checkpoint plus canonical entries for that layer, then advances the session to the next layer or review state.

3. `query_operating_model`
   Reads the latest operating model or a filtered slice by `layer`, `keyword`, `cadence`, `stakeholder`, `unresolved_only`, or `friction_priority`.

4. `generate_operating_model_exports`
   Renders and stores the final JSON/markdown artifacts after all five layers are approved.

## Expected Outcome

When this recipe is working correctly:

- a first session creates version `1` of a structured operating model
- pausing after layer 2 and restarting later resumes at the correct pending layer
- each approved layer writes one checkpoint plus canonical entries into the recipe tables
- the skill captures six summary thoughts in your core Open Brain:
  - one per layer
  - one final synthesis
- `query_operating_model` can find things like `Monday planning block`, `finance email dependency`, or `handoff friction`
- `generate_operating_model_exports` returns all five artifact blobs even if no local files are written

## Troubleshooting

**Issue: `start_operating_model_session` says no environment variable is configured**
Solution: Verify `DEFAULT_USER_ID` was set with `supabase secrets set DEFAULT_USER_ID=...` and redeploy the function if needed.

**Issue: The skill can see the recipe connector but not `search_thoughts` or `capture_thought`**
Solution: This recipe does not replace the core Open Brain server. Re-enable your base connector alongside this one.

**Issue: Export generation fails with missing layers**
Solution: At least one approved checkpoint must exist for each of the five layers. Resume the session and finish the missing layer summaries before exporting.

**Issue: Querying by friction priority returns nothing**
Solution: `friction_priority` reads from `details.priority`, so the saved friction entries need `low`, `medium`, or `high` in that field.

## Next Steps

- Feed `USER.md`, `SOUL.md`, and `HEARTBEAT.md` into any agent platform that uses operating files.
- Re-run the workflow quarterly or after a major role change to create a new version.
- Use the [MCP Tool Audit & Optimization Guide](../../docs/05-tool-audit.md) once you add this server so your capture/query/admin tool surface stays manageable.
