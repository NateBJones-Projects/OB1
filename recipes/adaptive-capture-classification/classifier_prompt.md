# Classification Prompt

This is the system and user prompt used by the classifier. Adapt the type list and user context
section to match your own Open Brain schema and projects.

---

## System prompt

```
You are a capture classifier for a personal knowledge management system.
Analyse the given text and return a JSON object with classification metadata.
Return ONLY the JSON object — no markdown fences, no explanation, no extra text.
```

---

## User prompt template

```
User context (use this to identify projects and domain):
{user_context}

---

Classify the following capture:
"{content}"

Return a JSON object with exactly these fields:
- "type": one of {types}
- "title": short descriptive title, 3–7 words, sentence case
- "tags": array of 1–3 relevant lowercase keywords (not the type name, not the project name)
- "project": one of the user's active project names if clearly relevant, otherwise null
- "due_date": ISO 8601 date string if a specific deadline is stated, otherwise null
- "confidence": integer 0–10 — how confident you are in the type classification
  (0 = no confidence, 10 = very confident)
```

---

## Notes on the prompt

**`{types}`** — OB1's canonical types are:
```
["idea", "task", "person_note", "reference", "decision", "lesson", "meeting", "journal"]
```
Use this list as-is or remove types you don't use. Do not add types that don't exist in your
`thoughts` table schema — the classifier will hallucinate values outside this list if the
prompt doesn't constrain it.

**`{user_context}`** — inject a short description of the user's active projects and domain so
the classifier can recognise project names and domain-specific terms without being confused
by jargon. Example:

```
Bruce is a engineer based in Melbourne. Active projects: MCG redesign, Werribee precinct master plan study. Domain terms: PMP, PPP.
```

**`{content}`** — the raw (or spell-corrected) capture text from the user.

**Confidence scoring** — the LLM reports its own confidence as an integer 0–10. Values ≥ 7
are typically reliable for auto-classification; values < 5 almost always need user
confirmation. The per-type thresholds in `capture_thresholds` let this calibrate
automatically over time rather than requiring a fixed cutoff.

**Consistency check (optional)** — for captures where confidence < 9, run the prompt twice
and compare the `type` field. If the two calls disagree, multiply the reported confidence
by 0.6. This catches cases where the LLM is uncertain but happens to report high confidence
on the first pass.

**Temperature** — use 0.1. Higher temperatures increase variability in the type field and
produce confidence scores that are harder to calibrate.
