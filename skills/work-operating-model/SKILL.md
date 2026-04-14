---
name: work-operating-model
description: |
  Conversation-first workflow for turning tacit work patterns into a structured
  operating model. Use when the user wants to map how their work actually runs,
  generate USER.md / SOUL.md / HEARTBEAT.md artifacts, or build an agent-ready
  model of rhythms, recurring decisions, dependencies, institutional knowledge,
  and friction. Requires base Open Brain search/capture tools plus the paired
  Work Operating Model recipe MCP tools.
author: Jonathan Edwards
version: 1.0.0
---

# Work Operating Model

## Purpose

The first job is not to automate the user. It is to help them see and describe how their work actually runs.

Your job is to:

1. interview the user through five fixed layers
2. convert the approved results into canonical structured entries
3. save each layer only after explicit confirmation
4. capture one concise summary thought per approved layer in the core Open Brain
5. run a contradiction pass
6. generate the final exports

## Required Tools

Before doing anything else, identify the actual tool names available in the current environment for:

- the base Open Brain search tool, usually `search_thoughts`
- the base Open Brain capture tool, usually `capture_thought`
- `start_operating_model_session`
- `save_operating_model_layer`
- `query_operating_model`
- `generate_operating_model_exports`

If any of the recipe tools are missing, stop and say so clearly.
If the base search/capture tools are missing, stop and say so clearly.

Do not assume the exact tool prefix. Use the names exposed in the current client.

## Non-Negotiable Rules

1. Use this fixed layer order:
   - operating rhythms
   - recurring decisions
   - dependencies
   - institutional knowledge
   - friction

2. Start concrete, not abstract.
   - Ask about last week, last month, recent examples, recent misses, recent waits.
   - Do not open with “what do you do all day?”

3. Search results are hints, not facts.
   - You may use the base search tool before a layer starts.
   - Treat everything retrieved as tentative context.
   - Never persist a retrieved hint unless the user confirms it or you reframe it as a synthesized pattern they approve.

4. Save only after explicit confirmation.
   - Show a checkpoint summary first.
   - Ask for confirmation or corrections.
   - Only then call `save_operating_model_layer`.

5. Persist lean memory.
   - One summary thought per approved layer.
   - One final synthesis thought after export generation.
   - Do not capture one thought per atomic entry.

6. Use `source_confidence` honestly.
   - `confirmed`: the user explicitly said or approved it as written.
   - `synthesized`: you abstracted a pattern from multiple concrete examples and the user approved that synthesis.

7. Do not silently smooth contradictions.
   - Surface them in the final review.
   - If they materially affect a saved layer, revise and resave that layer before export generation.

## Workflow

### Phase 1: Session Start

1. Call `start_operating_model_session`.
2. Summarize:
   - whether this is a fresh session or a resume
   - completed layers
   - pending layer
   - any existing checkpoints worth carrying forward
3. If resuming, continue from the pending layer.
4. If fresh, begin with `operating_rhythms`.

### Phase 2: Layer Interview

For each layer:

1. Run a small, focused memory check with the base search tool.
   - Use 2-4 narrow queries.
   - Example for rhythms: “Monday planning”, “end of week review”, “calendar overload”
   - Example for dependencies: “waiting on finance”, “blocked by email”, “handoff”
2. Present any useful hints as tentative:
   - “I found a few hints from prior context. I’m treating these as prompts, not facts.”
3. Ask for recent concrete examples.
4. Convert the response into canonical entries.
5. Show a checkpoint summary with the strongest patterns and unresolved items.
6. Ask for confirmation or corrections.
7. After confirmation, call `save_operating_model_layer`.
8. Immediately capture one concise summary thought through the base `capture_thought` tool.

### Phase 3: Final Review

After all five layers are saved:

1. Call `query_operating_model`.
2. Compare the layers for contradictions:
   - rhythms vs dependencies
   - recurring decisions vs institutional knowledge
   - friction vs the claimed operating rhythm
3. Present contradictions or tensions explicitly.
4. If corrections are needed, revise the affected layer and resave it.

### Phase 4: Export Generation

1. Once the model is internally consistent, call `generate_operating_model_exports`.
2. Capture one final synthesis thought through the base capture tool.
3. Present the returned artifacts:
   - `operating-model.json`
   - `USER.md`
   - `SOUL.md`
   - `HEARTBEAT.md`
   - `schedule-recommendations.json`

## Canonical Entry Contract

Every saved entry must include:

- `title`
- `summary`
- `cadence`
- `trigger`
- `inputs[]`
- `stakeholders[]`
- `constraints[]`
- `details`
- `source_confidence`
- `status`
- `last_validated_at`

Layer-specific `details` must match these shapes:

### `operating_rhythms`

- `time_windows[]`
- `energy_pattern`
- `interruptions[]`
- `non_calendar_reality`

### `recurring_decisions`

- `decision_name`
- `decision_inputs[]`
- `thresholds[]`
- `escalation_rule`
- `reversible`

### `dependencies`

- `dependency_owner`
- `deliverable`
- `needed_by`
- `failure_impact`
- `fallback`

### `institutional_knowledge`

- `knowledge_area`
- `why_it_matters`
- `where_it_lives`
- `who_else_knows`
- `risk_if_missing`

### `friction`

- `frequency`
- `time_cost`
- `current_workaround`
- `systems_involved[]`
- `automation_candidate`
- `priority` when known (`low`, `medium`, or `high`)

## Interview Guidance By Layer

### 1. Operating Rhythms

Ask about:

- what their days actually feel like
- what gets front-loaded or deferred
- when they can do deep work
- what interrupts the ideal plan
- what repeats weekly or monthly even when it is not formally scheduled

Strong prompt pattern:

- “Walk me through a real Monday from the last two weeks.”
- “Where does your calendar lie to you?”
- “When are you actually good for deep work versus admin or reactive work?”

### 2. Recurring Decisions

Ask about:

- repeated judgment calls
- what inputs they look at
- what thresholds matter
- when they escalate
- which decisions are reversible

Strong prompt pattern:

- “What decisions do you make over and over where the answer depends on context, not a checklist?”
- “What do you look at before you decide?”

### 3. Dependencies

Ask about:

- people or systems they wait on
- the timing windows that matter
- what gets blocked
- fallback behavior when something is late

Strong prompt pattern:

- “What part of your week depends on someone else sending, approving, or clarifying something?”
- “What breaks when that doesn’t happen on time?”

### 4. Institutional Knowledge

Ask about:

- what they know that is not written down
- what context only they carry
- where key knowledge actually lives
- what would break if they disappeared for two weeks

Strong prompt pattern:

- “What do you know that your team relies on but nobody has really documented?”
- “What mistakes would a smart new hire make because the real context is still in your head?”

### 5. Friction

Ask about:

- recurring annoyances
- repeated re-explanations
- broken handoffs
- tools that force duplicate work
- annoying waits that steal time or quality

Strong prompt pattern:

- “What keeps eating 10-20 minutes at a time?”
- “Where do you keep doing work the hard way because the systems never quite line up?”

## Checkpoint Format

Every layer checkpoint should contain:

1. a short layer summary
2. 2-5 canonical entries
3. explicit unresolved items when present
4. the exact approval ask

Good approval ask:

“This is the operating-rhythms model I’d save right now. Correct anything that’s off, especially the deep-work window and the Friday compression pattern. If this looks right, I’ll save it and move to recurring decisions.”

## Summary Thought Pattern

After each approved layer, capture one thought like this:

`Operating model layer complete: operating rhythms. Real pattern: Monday is for intake and prioritization, Tuesday-Thursday carry the real build work, Friday compresses into follow-ups and cleanup. Deep work window is late morning when interruptions are lowest. Key non-calendar reality: the week shape depends heavily on inbox and approvals landing on time.`

Final synthesis thought should summarize the full operating model, not repeat all entries.

## Tone

Be direct, practical, and specific.
No generic productivity advice.
No fake certainty.
Keep momentum moving without bulldozing confirmation.
