# World Model Diagnostic Activation

> Ship-now OB1 activation path for the World Model Readiness Diagnostic. V1 keeps the behavior lightweight by reusing the base Open Brain connector instead of adding a new MCP server or schema.

## What It Does

This recipe is the fastest credible way to ship the diagnostic promised in the
"World Model" post without turning it into a heavier product build.

V1 deliberately does three things only:

1. runs the full 20-minute diagnostic through the paired [World Model Readiness Diagnostic skill](../../skills/world-model-diagnostic/)
2. uses the existing core Open Brain `search_thoughts` and `capture_thought` tools when they are available
3. persists three durable artifacts into the user's brain:
   - intake summary
   - boundary audit
   - final assessment

The same prompt also works in plain Claude or ChatGPT. Without OB1 connected, the
workflow still runs, but it does not persist.

## Why V1 Looks Like This

The cleanest ship for tomorrow is **no new MCP tool surface in v1**.

That is the right call for this diagnostic because:

- the hard part is the conversation flow, not CRUD
- the user needs copy-paste portability into Claude and ChatGPT
- the assessment has to model uncertainty honestly, which lives best in the skill behavior
- OB1 already has the durable memory primitives we need

So v1 is:

- skill-owned interview behavior
- client-driven conversation state
- base OB1 search/capture for compounding memory

The upgrade path is already drafted in [`schema-v2-draft.sql`](./schema-v2-draft.sql).

## Prerequisites

- Working Open Brain setup with `search_thoughts` and `capture_thought` available ([guide](../../docs/01-getting-started.md))
- AI client that supports reusable skills/prompts, or a plain Claude/ChatGPT chat for direct paste
- Canonical [World Model Readiness Diagnostic skill](../../skills/world-model-diagnostic/)

## Steps

### 1. Install the skill dependency

Follow the installation steps in the [World Model Readiness Diagnostic skill](../../skills/world-model-diagnostic/).

This recipe does not replace the skill. The skill owns:

- the intake questions
- the paradigm mapping logic
- the boundary audit
- the fact-vs-inference output contract
- the persistence behavior when OB1 tools exist

### 2. Keep your core Open Brain connector enabled

V1 depends on the base connector you already use for Open Brain.

The client should be able to see:

- `search_thoughts`
- `capture_thought`

If those tools are missing, the diagnostic still works, but it becomes a
non-persistent chat workflow.

### 3. Run the diagnostic

Use this exact prompt:

```text
Use the World Model Diagnostic. Interview me for about 20 minutes to assess whether my company is ready for a world model. Ask about company size, industry, business model, the top 3-5 data sources ranked by fidelity, where decisions and editorial judgment currently live, which management layers have already been removed, how outcomes get recorded, and whether data capture happens as a byproduct of work or as separate documentation. Then map me to the right paradigm (vector database, structured ontology, or signal-fidelity), audit my top information flows by labeling each as "act on this" or "interpret this first," identify my biggest simulated-judgment exposures, and give me a first/second/third build sequence. Do not give me a readiness score. Label every conclusion as Firm finding, Inference, or Open question. If Open Brain search/capture tools are available, use them to check for prior context and persist the intake, boundary audit, and final assessment.
```

### 4. Review what gets saved into OB1

When the base connector is available, the skill should persist three thoughts:

1. `[world-model-diagnostic/intake]`
2. `[world-model-diagnostic/boundary-audit]`
3. `[world-model-diagnostic/assessment]`

This is intentional. The diagnostic should compound, but it should not spray
dozens of tiny fragments into the brain.

### 5. Re-run later and compare

The recommended cadence is:

- first run before any world-model build
- second run after the boundary layer exists
- later runs after outcome encoding or a paradigm shift

The diagnostic should compare against prior saved context when `search_thoughts`
is available and call out what changed.

## Direct-Paste Fallback

If the reader does **not** have OB1 connected yet, the same prompt still works in
Claude or ChatGPT. The only thing they lose is persistence.

That means the post promise stays true:

- works in Claude
- works in ChatGPT
- compounds in OB1 when the brain connector exists

## V2 Upgrade Path

V1 stores durable output in core thoughts on purpose. If this graduates into a
structured diagnostic product, use the draft in [`schema-v2-draft.sql`](./schema-v2-draft.sql).

The intended Option B shape is:

- `world_model_assessments`
- `world_model_boundary_flows`

Recommended tool surface for that future version:

1. `start_world_model_assessment`
2. `save_world_model_boundary_flow`
3. `finalize_world_model_assessment`
4. `get_world_model_assessment_history`

That keeps the conversation in the client while giving structured storage and
rerun history without forcing a single monolithic tool call.

## Expected Outcome

When this recipe is working correctly:

- the reader can paste one prompt into Claude or ChatGPT and run the full diagnostic
- the same workflow compounds into Open Brain when the base connector is present
- the output clearly distinguishes facts from interpretation
- the reader gets a paradigm fit, boundary-layer read, top exposures, and a first/second/third build sequence
- the repo already contains a schema-ready path for a structured v2

## Troubleshooting

**Issue: The client can run the interview but nothing is persisted**
Solution: Re-enable the base Open Brain connector and verify the client can actually see `search_thoughts` and `capture_thought`.

**Issue: The diagnostic returns polished confidence instead of labeled uncertainty**
Solution: Restore the skill rules. V1 should never collapse into a readiness dashboard or unlabeled inference.

**Issue: The assessment feels too abstract**
Solution: Force the top 5-10 flow audit. The boundary labels are the core of the workflow, not an optional extra.
