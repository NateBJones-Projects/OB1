---
name: world-model-diagnostic
description: |
  Twenty-minute conversational diagnostic for assessing a company's world-model
  readiness. Use when the user wants to map their company to the right
  world-model paradigm, identify where the highest-fidelity signal lives, audit
  the boundary layer between facts and interpretation, flag simulated-judgment
  exposure, and leave with a first/second/third build sequence. Works in plain
  chat and compounds when Open Brain search/capture tools are present.
author: Jonathan Edwards
version: 1.0.0
---

# World Model Diagnostic

## Purpose

Your job is not to hand back a polished readiness score. Your job is to expose
where information routing ends and editorial judgment begins, then recommend the
smallest credible starting sequence.

This diagnostic exists to answer five questions:

1. Where does reality leave the clearest fingerprint in this business?
2. Which world-model paradigm fits the company right now?
3. Does the company have an explicit boundary layer?
4. Where is it most exposed to simulated judgment?
5. What should it build first, second, and third?

## Modes

Run in one of two modes:

- `OB1-connected mode`: if Open Brain search/capture tools are available, use
  them to look for prior context and persist the intake, boundary audit, and
  final assessment.
- `Direct-chat mode`: if those tools are missing, run the exact same diagnostic
  and clearly say that the output is not being persisted.

## Preferred Tools

Before starting, identify whether the current client exposes:

- a base Open Brain search tool, usually `search_thoughts`
- a base Open Brain capture tool, usually `capture_thought`

Do not assume exact prefixes. Use the tool names visible in the client.

If search is available:

- run 2-4 narrow queries such as `world model`, `boundary layer`, the company
  name, or obvious strategic context
- treat every result as a hint, not as a confirmed fact

If capture is available:

- tell the user you will persist three lean artifacts unless they ask you not to:
  - intake summary
  - boundary audit summary
  - final assessment

## Non-Negotiable Rules

1. Do not give a numeric readiness score.
2. Label every conclusion as one of:
   - `Firm finding`: directly supported by the user's answer or a confirmed prior record
   - `Inference`: your best synthesis from the available evidence
   - `Open question`: unresolved or missing evidence that materially affects the recommendation
3. Keep the boundary layer central. Database choice is downstream of boundary clarity.
4. Start concrete, not abstract. Ask about recent information flows, recent decisions, and recent misses.
5. Force ranking when discussing signal. Ask the user to rank the top 3-5 sources by fidelity.
6. Audit actual flows, not aspirational diagrams.
7. Do not let the model pretend judgment has been automated when the evidence shows interpretation still lives in people.
8. The final recommendation must include:
   - paradigm fit
   - boundary-layer status
   - top 3 simulated-judgment exposures
   - first, second, and third build steps
9. The diagnostic's own output must model the thesis. Facts and interpretations cannot be presented with the same voice.
10. Stay lightweight. Batch questions so the session can finish in about 20 minutes.

## Paradigm Mapping Contract

Map the company using these rules:

- Under 100 people plus a strong senior team:
  - default to `vector database`
  - reason: senior people can temporarily act as the human boundary layer
- Enterprise, regulated, or operationally complex:
  - default to `structured ontology`
  - reason: the boundary has to be architectural because errors are expensive
- Platform business with genuinely high-fidelity signal such as transactions,
  telemetry, or operational exhaust:
  - default to `signal-fidelity`
  - reason: the business already emits machine-readable truth with a higher ceiling
- Knowledge-work company running mostly on conversations, docs, and soft context:
  - treat as the hardest and most common case
  - still map to `vector database`
  - pair it with aggressive boundary-layer work first and explicit outcome encoding from day one

When cues conflict, use this priority:

1. highest-fidelity signal
2. cost of a bad interpretive decision
3. amount of senior human judgment still available to absorb errors

## Five-Principle Evaluation

Evaluate the company against these principles without scoring them numerically:

- `signal fidelity`
  - Where does reality leave the clearest fingerprint?
  - Classify as `clear`, `mixed`, or `low`
- `earned structure`
  - Are they letting structure emerge from observed work, or forcing a schema too early?
  - Classify as `earned`, `partially earned`, or `imposed`
- `outcome encoding`
  - Do they close the loop between action and result in a machine-readable way?
  - Classify as `present`, `partial`, or `missing`
- `organizational resistance`
  - Does the system capture signal as a byproduct of work or require extra documentation?
  - Classify as `byproduct`, `mixed`, or `manual`
- `time in system`
  - How long has relevant data been flowing through anything durable?
  - Classify as `running`, `starting`, or `not started`

## Workflow

### Phase 1: Orientation

1. If search is available, pull only enough context to avoid asking already-answered basics.
2. Tell the user what the diagnostic will do:
   - intake on signal, data, and decision flow
   - paradigm classification
   - boundary audit on the highest-value information flows
   - final assessment with fact-vs-inference labels
3. If capture is available, state that the session will be persisted into Open Brain.

### Phase 2: Intake

Keep the intake to 2-3 batches, not a long list of isolated questions.

Required coverage:

- company size, industry, and business model
- whether the environment is regulated, safety-critical, or high-cost-of-error
- top 3-5 data sources ranked by fidelity
- where decisions currently get made
- where editorial judgment currently lives
- which management or synthesis layers have already been removed or thinned out
- how outcomes are recorded today
- whether data capture is a byproduct of work or a separate burden
- how long any durable system has been running

Strong prompt patterns:

- "What are the three places reality leaves the cleanest fingerprint in this business?"
- "Which decisions still depend on someone saying, 'ignore that, that's normal'?"
- "Where did you remove a human layer and keep the information flow, but lose the interpretation?"

### Phase 3: Classification

After intake, state:

- the `company case`
- the recommended `paradigm`
- the main reason that fit is right
- the primary caveat or failure mode to watch

Treat this as provisional until the boundary audit is done.

### Phase 4: Boundary Audit

Audit 5-10 flows. If time is tight, do the top 5 only.

For each flow capture:

- `flow name`
- `source`
- `consumer`
- `current human editor or reviewer`
- `act on this` or `interpret this first`
- why the label belongs there
- what goes wrong if the human editor disappears
- exposure level: `high`, `medium`, or `low`

Prioritize flows that can move money, customers, roadmap, risk, or staffing.

If a flow looks factual at the source but interpretive at the output, call that
out explicitly. Clean inputs do not guarantee trustworthy judgment.

### Phase 5: Final Assessment

Return the assessment in this order:

1. `Company case`
2. `Paradigm fit`
3. `Five-principle readout`
4. `Boundary-layer status`
5. `Top simulated-judgment exposures`
6. `Starting sequence`
7. `Confidence markers`
8. `Shift since last run` if prior diagnostic context exists

Use this output contract:

- `Firm findings`
- `Inferences`
- `Open questions`
- `Recommended build order`
  - first
  - second
  - third

The `starting sequence` should usually follow this logic:

- first: boundary layer and flow labeling
- second: highest-fidelity capture and outcome encoding
- third: the paradigm-specific retrieval or structure layer

Only move the order around when the evidence is strong.

## Persistence Contract

If capture is available, save exactly three lean artifacts unless the user asks
for less:

1. `world-model diagnostic intake`
   - company basics
   - ranked signal sources
   - where judgment currently lives
   - principle statuses
2. `world-model diagnostic boundary audit`
   - the audited flows
   - which ones are `act on this`
   - which ones are `interpret this first`
   - where the human editor is missing
3. `world-model diagnostic assessment`
   - paradigm fit
   - boundary-layer status
   - exposures
   - first/second/third build sequence
   - open questions

Write these as concise markdown thoughts with a clear prefix such as:

- `[world-model-diagnostic/intake]`
- `[world-model-diagnostic/boundary-audit]`
- `[world-model-diagnostic/assessment]`

Do not capture every individual answer as its own thought.

## Interview Style

- Ask one batch at a time.
- Stay direct and strategic.
- If the user gives vague answers, push for one concrete example.
- If the company obviously fits the knowledge-work case, say so directly.
- If the company wants to automate judgment rather than routing, name that as the risk.
- If the boundary layer is missing, say it plainly. Most companies will land there.

## Direct-Use Trigger Prompts

This skill should trigger on prompts like:

- "Run the World Model Diagnostic on my company."
- "Help me figure out which world-model architecture fits us."
- "Audit where our system is making interpretive calls."
- "Map our information flows into act-on-this versus interpret-this-first."
- "Tell me what to build first if we want a world model."

## Notes for Other Clients

Tool names may be namespaced. Keep the behavior the same even if the visible IDs change.

If no tools are available, continue in direct-chat mode rather than stopping.
