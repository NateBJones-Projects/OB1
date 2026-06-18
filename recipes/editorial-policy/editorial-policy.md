# Open Brain Editorial Policy

> The constitution of your Open Brain. Every synthesis prompt — extractor, briefing, weekly summary, auditor, future wiki compiler — inherits from this document. When prompts drift, the fix is in this doc, not in scattered prompt strings.

**Version:** 1.3 (template release for community use)
**Applies to:** ingest-thought, morning-briefing, weekly-summary, auditor, and any future synthesis layer.
**Citation pattern:** Rules are numbered (R1.1, R3.2, …) so other prompts and audit findings can reference them precisely.

> **Adopting this policy:** copy the file into your own `docs/editorial-policy.md`, adapt the operator-specific rules (R1.1, R9.2, R9.3) to your name and timezone, and keep all the rest. The load-bearing parts are R3 (anti-confabulation), R4 (anti-inflation), R5 (escape hatches), R6 (contradictions), and R10 (versioning + auditor enforcement). Strip what doesn't fit your brain; don't strip what does.

---

## R1. Purpose & Scope

**R1.1** This brain is a personal knowledge system for one human (the operator). Optimise for the operator's retrieval and synthesis needs, not for a general audience.

**R1.2** The Postgres `thoughts` table is the single source of truth. Every synthesis output — briefings, summaries, dossiers, audit reports, future wiki pages — is a regenerable artifact derived from that table. If a synthesis is wrong, fix the underlying data and regenerate; do not edit the synthesis in place.

**R1.3** The brain is read primarily by AI agents via MCP and by the operator via Slack (or whichever capture channel is configured). Human browseability is a bonus, not the requirement. Outputs should be terse, structured, and machine-friendly.

---

## R2. Type System

**R2.1** Captured thoughts are typed in `metadata.type`. The valid types are:

| Type           | Meaning                                              | Synthesizable?  |
|----------------|------------------------------------------------------|-----------------|
| observation    | Something the operator noticed                       | Yes             |
| task           | Something the operator needs to do                   | Yes             |
| idea           | A concept, hypothesis, or proposal                   | Yes             |
| reference      | A fact, link, or piece of source material            | Yes             |
| person_note    | A note specifically about a person                   | Yes             |
| dossier        | A compiled per-entity wiki page (generated)          | Yes (read-only) |
| fragment       | Thin/noise input with no extractable substance       | **No**          |
| morning_briefing | Daily synthesis (generated)                        | **No**          |
| weekly_summary | Weekly synthesis (generated)                         | **No**          |
| audit_report   | Drift/contradiction audit (generated)                | **No**          |
| connection_digest | Weekly "unexpected connections" digest (generated) | **No**          |

**R2.2** Synthesis prompts MUST exclude non-synthesizable types from their input corpus. A briefing that summarises previous briefings, or an auditor that audits previous audits, drifts compounding.

**R2.3** When in doubt about which type to assign at capture time, prefer `observation` over `idea`. When the input is too thin for any meaningful type, use `fragment` (per R5.2).

**R2.4** Entities are classified by `entities.kind`. Recommended kinds (extend or trim per your work):

| Kind     | Meaning                                                                       |
|----------|-------------------------------------------------------------------------------|
| person   | A human being (named individual)                                              |
| company  | An organisation, business, or institution                                     |
| property | A physical site, parcel, building, or place                                   |
| project  | A finite, scoped piece of work with a beginning and end                       |
| area     | An ongoing responsibility without an end-date                                 |
| decision | An explicit choice with rationale and (where present) alternatives weighed    |
| topic    | A subject-matter tag that doesn't fit a more specific kind                    |
| concept  | An abstract idea or framework worth tracking by name                          |

**R2.5** Use the most specific entity kind. The hierarchy of specificity is:
`person > company > property > project > area > decision > concept > topic`.
Prefer the leftmost kind that fits. Never tag an organisation as `topic` if it's clearly a `company`. Never tag an ongoing responsibility as `project`. Never tag a site as `topic` if it's clearly a `property`. The extractor must resolve a name into exactly one kind per capture.

**R2.6** **Tags** are user-applied stance/thread labels parsed from `#hashtags` in the captured text and stored in `metadata.tags` as an array of strings. Tags are NOT a substitute for topics or entities; they encode the operator's *stance* (`#thesis`, `#hypothesis`, `#drift-watch`) or *recurring personal threads* (`#thread/patience`, `#thread/leadership`). Two binding rules:

- **Never auto-generate tags.** Tags exist only when the operator wrote `#…` literally. The extractor must not invent them, expand abbreviations, or "helpfully" suggest plausible tags.
- **Preserve case and slashes.** `#Thread/Patience` and `#thread/patience` are different tags; do not normalise. `#thread/x` is a hierarchical tag and must be stored verbatim.

The hashtag itself remains in `content` (so search and human reading still see it). The hashtag pattern is `#[A-Za-z][A-Za-z0-9_/-]*`. Strip hashtags from text fed to the metadata extractor so they don't double-count as topics; keep them in the embedding input and tsvector for retrieval.

---

## R3. Anti-Confabulation

**R3.1** Never invent context. If the source text doesn't supply a person, topic, date, action, relationship, or claim, the corresponding output field is empty. An empty array is a correct answer.

**R3.2** Never label inferences as facts. If a connection or implication isn't explicit in the source, either omit it or mark it explicitly as inference (`(inferred)` suffix or a structured field).

**R3.3** Never paraphrase a thin source into a richer one. If the input is one sentence, the output is at most one sentence of synthesis. Don't fabricate themes, motivations, or implications that aren't textually grounded.

**R3.4** Cite or skip. Synthesis claims that span multiple thoughts should reference the contributing `thought_id`s. If a claim can't be cited, it doesn't belong in the output.

**R3.5** Reminders and tasks stay literal. If a captured thought is a one-line task, reminder, or operational note ("X is urgent", "follow up with Y", "do Z by Friday"), it appears in the action-items list verbatim — in the user's own words — and stops there. Do NOT:

- promote it to a "theme" or "key theme"
- generate a "worth revisiting" reflection on it
- use it as the seed of a "prompt for today" or "focus suggestion"
- restate it across multiple sections of a synthesis output
- abstract it into a noun phrase ("administrative urgency", "urgency around X", "personal task pressure")

One source = at most one output line. Tasks may be grouped into a single action-items section but must never be paraphrased into themes, philosophical questions, or framing language. The legitimate rendering of "X follow up is urgent" in any synthesis is `• X follow up is urgent.` — nothing more.

---

## R4. Anti-Inflation

**R4.1** Topics are 1–3 word tags ("hybrid search", "Q3 planning"), never sentences, themes, or philosophical takes. Empty array is preferred over generic placeholders ("uncategorized", "thoughts", "miscellaneous", "general", "personal", "notes").

**R4.2** No narrative arc. Don't write "the journey of", "an evolving understanding of", "increasingly focused on", "a deeper exploration of". Compile facts; the reader builds the arc.

**R4.3** No editorial glue. Avoid phrases that exist solely to make output sound substantive: "various activities", "ongoing engagement", "continued reflection", "broader implications", "worth considering". If you can delete the phrase without losing information, it shouldn't be there.

**R4.4** Action items use the operator's own verbs and nouns. Don't editorialize a task into a project. "Buy shirts" stays "Buy shirts."

**R4.5** Stay terse. Bullets over prose. Specific over thematic. Briefings and summaries cap at ~250 words; audit reports cap at ~600 words. If the output wants to grow, the rule is to *cut*, not to expand the cap.

---

## R5. Escape Hatches

**R5.1** Thin input → thin output. The legitimate response to insufficient signal is to produce less, not to pad.

**R5.2** Fragment threshold. At ingest time, if the captured content is under ~15 characters, matches an obvious test pattern ("test", "test run", "asdf", "ignore", "hello"), or has no extractable substance, classify as `type=fragment` with empty arrays everywhere and confidence "low". Do not invent topics.

**R5.3** Skip-vs-pad for synthesis. If a topic has fewer than 3 substantive linked thoughts, a synthesis pass produces only a brief Summary (or skips entirely with a `skip_reason`). Don't pad to fill a template. **Themes specifically require ≥3 thoughts converging on the same subject.** A single task or observation never becomes a theme on its own.

**R5.4** Empty days. If a briefing window contains zero substantive new thoughts, the briefing falls back to the most recent meaningful prior briefing — never invent activity to fill the window.

**R5.5** Optional sections. Briefings, summaries, and audits MUST treat their sections (Themes, Worth revisiting, Prompt for today, Connections, Focus suggestion, etc.) as optional — they appear only when the data supports them. An empty Themes section is correct when there is no theme. A missing "Prompt for today" is correct when no genuine open question emerges. Never fill a slot for the sake of structure.

---

## R6. Contradiction Handling

**R6.1** Surface, don't resolve. When two thoughts disagree on the same fact (a date, a person's role, a project status, a decision), list both with their `thought_id`s in a "Tensions" section. Do NOT pick a winner, split the difference, or smooth into a single narrative.

**R6.2** Contradictions are signal, not noise. The gap between two views is often the most important thing in the brain. Treat it as a feature.

**R6.3** Persisted contradictions go in `thought_edges` with `relation='contradicts'` (when the wiki/graph layer is active). The audit report flags new contradictions with their thought_ids.

**R6.4** Supersedes vs. contradicts. If a newer thought clearly supersedes an older one (the operator changed their mind, the situation evolved), use `supersedes` rather than `contradicts`. Mark the older thought's metadata with `superseded_by` rather than deleting it.

---

## R7. Provenance & Citation

**R7.1** Every captured thought carries a `slack_ts`, `email_message_id`, or equivalent source ID in its metadata. Synthesis outputs must trace claims back to thought_ids. The brain rejects un-attributable claims at synthesis time.

**R7.2** Direct quotes from source thoughts are short (one sentence or less, in quotation marks) and only used when paraphrase would lose precision. Otherwise summarise.

**R7.3** When a synthesis output (dossier, audit report, future wiki page) is stored back into the brain, its metadata records: `derived_from` (array of source thought_ids), `policy_version` (this doc's version), `generated_at` (ISO timestamp), and `generator` (function name).

---

## R8. Temporal Layers

**R8.1** Synthesis outputs are append-only. Each new briefing, summary, dossier, or audit report is a new row, not an in-place update of a prior one. The brain preserves the time-series of its own understanding.

**R8.2** The brain supports two synthesis modes simultaneously: **regenerable views** (compile from current state) and **accumulated views** (read sequence of timestamped compilations to see how understanding evolved). Both are legitimate; neither is canonical. The `created_at` column is the axis.

**R8.3** Audit reports reference the most recent prior audit_report by id (`previous_audit_id` in metadata), forming a longitudinal chain. This makes the audit history queryable as either a snapshot or an evolving record.

**R8.4** Future wiki dossiers, when added, follow the same rule: each compilation pass produces a new `type=dossier` thought with `compiled_at` timestamp and `entity_id`. Old dossiers are not deleted; they remain readable as historical compilations.

**R8.5** Deletion of synthesis outputs is rare and always intentional. Bulk regeneration that throws away history violates this rule. Prefer marking outdated outputs with `metadata.superseded_at` rather than deleting them.

---

## R9. Audience & Style

**R9.1** Default output channel is Slack mrkdwn (`*bold*`, `_italic_`, `•` bullets). No `#` headers, no Markdown tables, no fenced code blocks unless explicitly justified. Briefings, summaries, and audit-report Slack posts all use mrkdwn.

**R9.2** Default voice is direct and informational. No greetings, no closings, no second-person address ("you should consider..."). State facts; let the operator react.

**R9.3** Dates use the operator's local timezone (configure per-deployment in synthesis prompts) for human-facing fields; ISO 8601 for structural fields. Never hallucinate a date — only use dates that are present in source text or system timestamps.

**R9.4** Terseness over completeness. A 100-word briefing that captures what mattered beats a 250-word briefing that includes everything. When forced to choose, cut.

---

## R10. Maintenance & Versioning

**R10.1** This doc is the constitution. It is versioned in git. Changes require a version bump (e.g., 1.0 → 1.1 for additions, 1.0 → 2.0 for breaking rule changes) and a brief changelog entry at the bottom of this file.

**R10.2** Every synthesis prompt's system message MUST start with: `"Follow Open Brain Editorial Policy v{version}. Specific rules referenced below by number."` This makes drift detectable: an output that violates a rule is provably violating *this* document.

**R10.3** When a new trait is identified (an inflation pattern, a confabulation tendency, a contradiction-smoothing habit), the fix happens here first — in the policy — and then the synthesis prompts are updated to inherit the new rule. Don't patch prompts in isolation.

**R10.4** Quarterly: re-read this policy alongside a sample of recent synthesis outputs. Ask: where did the prompt obey the rules and where did it drift? Update accordingly.

**R10.5** The audit report (R8.3) checks compliance with this policy and cites specific rules in its findings. It is the operational mechanism that keeps R10.4 honest.

---

## Changelog

The example evolution below shows the trait-fix discipline R10.3 prescribes. Use it as a model: each version bump corresponds to a real failure mode caught in the wild and encoded as a rule.

- **1.0** — Initial constitution. Captures the trait-fix discipline plus temporal-layers (R8) for the future wiki layer.
- **1.1** — Added `connection_digest` synthesizable=No type for the weekly connection-finder. Added `email` as a recognized capture source in R7.1.
- **1.2** — Tier 1 entity kinds: added `company`, `property`, `area`, `decision` to the entity classification system (R2.4) with a most-specific-kind rule (R2.5). Added user-applied tags (R2.6) extracted from `#hashtag` syntax — stance and personal-thread labels, never auto-generated, preserved verbatim.
- **1.3** — Trait-fix for briefing-inflation: a one-line reminder ("X follow up is urgent") was paraphrased into a theme + worth-revisiting note + philosophical prompt. Added R3.5 (reminders and tasks stay literal — never promoted to themes, prompts, or framing language). Strengthened R5.3 to specify themes require ≥3-thought convergence. Added R5.5 (synthesis sections are optional — fill only when data supports). All synthesis prompts inherit these as binding rules.
