# Adaptive Capture Classification

## What This Does

OB1's `capture` MCP tool classifies your input once and moves on — there is no mechanism to
tell it when it got the type wrong. This recipe adds a learning loop on top of the existing capture flow: the
classifier reports a confidence score, a per-type threshold gates whether to auto-classify or
ask for confirmation, and every user response nudges that threshold up or down. Over time the
system learns which capture types it can reliably auto-classify for you and becomes
progressively less intrusive.

## Difficulty

Intermediate

## Prerequisites

- Open Brain setup complete with the `thoughts` table populated
- An AI gateway configured (OpenRouter, Ollama, or any OpenAI-compatible endpoint)
- Access to run SQL migrations against your Supabase project (Supabase Studio or CLI)
- A capture interface you control — CLI script, Telegram bot, n8n workflow, or similar
  (this recipe is interface-agnostic; the gating logic sits between your interface and the
  OB1 `capture` MCP call)
- A trusted server-side environment for the reference implementation below
  (`capture-with-gating.ts` uses `SUPABASE_SERVICE_ROLE_KEY`, not a browser-safe anon key)

## What You'll Learn

- How to add confidence scoring to LLM classification without changing your existing schema
- How to implement adaptive per-type thresholds that improve from user feedback
- How to run A/B model comparisons on live captures to choose between models empirically
- How to build a spell/typo correction layer that learns from user corrections

---

## Setup

### Step 1: Run the schema migration

Run `schema.sql` against your Supabase project. This creates four tables alongside your
existing OB1 schema — nothing existing is modified.

**Supabase Studio:** open the SQL editor, paste the contents of `schema.sql`, and run it.

**Supabase CLI:**

```bash
supabase migration new adaptive_capture_classification
# paste the contents of schema.sql into the generated migration file
supabase db push
```

✅ **Done when:** the four tables appear in your Supabase Studio table list:
`correction_learnings`, `classification_outcomes`, `capture_thresholds`, `ab_comparisons`.

---

### Step 2: Configure your capture types

In `classifier_prompt.md`, edit the `{types}` list to match your Open Brain schema. OB1's
canonical types are:

```json
["idea", "task", "person_note", "reference", "decision", "lesson", "meeting", "journal"]
```

Remove types you don't use, but do not add values outside this list unless you have added
corresponding type support to your `thoughts` table. The classifier and threshold system
will adapt to whatever list you set — per-type rows in `capture_thresholds` are created on
first use.

---

### Step 3: Add a user context string

The classifier prompt includes a `{user_context}` slot. Fill this in with a short description
of your active projects and any domain vocabulary the classifier might otherwise misread as
typos or generic words. Store this string wherever your capture interface loads configuration.

Example:

```
Maya is a product designer in San Francisco. Active projects: Onboarding v3, Design System
audit, Q2 mobile app. Domain terms: Figma, Lottie, handoff, A11y, WCAG.
```

---

### Step 4: Wrap your capture call with the gating logic

> [!NOTE]
> This recipe provides a pseudocode description of the gating pattern plus a minimal
> TypeScript reference implementation (`capture-with-gating.ts`). You will need to adapt
> the implementation to your own capture interface — the logic is intentionally kept
> separate from any specific bot, CLI, or workflow framework.

Replace your current direct call to the OB1 `capture` MCP tool with the following pattern.

```
CONSTANTS:
    DEFAULT_THRESHOLD  = 0.75
    THRESHOLD_MIN      = 0.50
    THRESHOLD_MAX      = 0.95
    THRESHOLD_NUDGE    = 0.02
    CONSISTENCY_CUTOFF = 9       # re-run classifier if confidence below this
    CONSISTENCY_FACTOR = 0.6     # multiply confidence if two runs disagree on type

FUNCTION process_capture(raw_text, hint_type=null, hint_project=null):

    # --- 1. Classify ---
    result = call_llm(
        system_prompt = SYSTEM_PROMPT,           # from classifier_prompt.md
        user_prompt   = USER_TEMPLATE.format(
            user_context = USER_CONTEXT,
            content      = raw_text,
            types        = CAPTURE_TYPES,
            type_note    = "" if hint_type is null
                           else ' — you MUST use "{hint_type}" for this field'
        ),
        temperature = 0.1
    )
    classified = parse_json(result)              # fields: type, title, tags, project,
                                                 # due_date, confidence (0–10)

    # --- 2. Optional consistency check ---
    if hint_type is null and classified.confidence < CONSISTENCY_CUTOFF:
        second = call_llm(same prompt)
        if second.type != classified.type:
            classified.confidence = round(classified.confidence * CONSISTENCY_FACTOR)

    # --- 3. Look up learned threshold ---
    threshold = get_threshold(classified.type)   # SELECT from capture_thresholds

    # --- 4. Gate: auto-classify or ask? ---
    if hint_type is not null or (classified.confidence / 10) >= threshold:
        auto_classify = true
    else:
        auto_classify = false

    # --- 5. Record outcome (user_accepted filled in later) ---
    outcome_id = insert_outcome(
        model          = model_name,
        item_type      = classified.type,
        confidence     = classified.confidence,
        auto_classified = auto_classify
    )

    return { classified, auto_classify, outcome_id }


FUNCTION complete_capture(outcome_id, classified, accepted, user_correction=null):

    # --- 6. Write to OB1 ---
    if accepted:
        call_ob1_capture(
            content  = classified.title,
            type     = classified.type,
            tags     = classified.tags,
            project  = classified.project,
            due_date = classified.due_date
        )

    # --- 7. Record feedback and adjust threshold ---
    update_outcome(outcome_id, user_accepted=accepted, user_correction=user_correction)
    adjust_threshold(classified.type, accepted=accepted)


FUNCTION adjust_threshold(item_type, accepted):
    current = get_threshold(item_type)
    # Lower threshold when accepted (auto-classify was correct → be more aggressive)
    # Raise threshold when rejected (auto-classify was wrong → be more conservative)
    delta = -THRESHOLD_NUDGE if accepted else +THRESHOLD_NUDGE
    new_val = clamp(current + delta, THRESHOLD_MIN, THRESHOLD_MAX)
    upsert_threshold(item_type, new_val)
```

---

### Step 5: Add confirmation handling to your interface

When `auto_classify` is `false`, prompt the user to confirm or correct. The minimum viable
confirmation loop is:

```
Show:    "I think this is a [type]: [title]. Confidence: [n]/10. Correct? [Yes] [No] [Pick type]"

On Yes:  complete_capture(outcome_id, classified, accepted=true)
On No:   complete_capture(outcome_id, classified, accepted=false)
On Pick: re-run classification with hint_type = user_chosen_type
         complete_capture(outcome_id, new_classified, accepted=true, user_correction=user_chosen_type)
```

For CLI interfaces, a simple y/n prompt is sufficient. For Telegram or Slack, an inline
keyboard with type buttons works well.

---

### Step 6 (optional): Enable A/B model comparison

If you want to empirically compare two models before committing to one as your default,
run both classifiers in parallel on the same capture and ask the user to pick the better
result. Store the outcome in `ab_comparisons`.

```
model_a_result = classify(text, model="model-a")
model_b_result = classify(text, model="model-b")

compare_id = insert_ab_compare(model_a_result, model_b_result)

Show both results to user, ask: "Which is better? [A] [B] [Both] [Neither]"

update_ab_compare(compare_id, winner=user_choice)
```

Query `ab_comparisons` to see win rates:

```sql
SELECT
    model_a,
    model_b,
    COUNT(*) AS total,
    SUM(CASE WHEN winner = 'a'       THEN 1 ELSE 0 END) AS wins_a,
    SUM(CASE WHEN winner = 'b'       THEN 1 ELSE 0 END) AS wins_b,
    AVG(time_ms_a) AS avg_ms_a,
    AVG(time_ms_b) AS avg_ms_b
FROM ab_comparisons
WHERE winner IS NOT NULL
GROUP BY model_a, model_b;
```

---

## How to Use It

Once wired up, your capture flow works like this:

**High-confidence capture** — the classifier returns confidence 8/10 and the current
threshold for `task` is 0.75. It auto-classifies, writes to OB1, and silently nudges the
`task` threshold down by 0.02 (the system is performing well — it can be slightly more
aggressive next time).

**Low-confidence capture** — the classifier returns confidence 5/10 for `note` but the
threshold is 0.75. You get a confirmation prompt. If you accept, the threshold nudges down.
If you correct it to `decision`, the threshold for `note` nudges up (you were right to ask)
and the correction is recorded.

**Checking learned thresholds:**

```sql
SELECT item_type, threshold, sample_count, updated_at
FROM capture_thresholds
ORDER BY sample_count DESC;
```

**Checking model accuracy:**

```sql
SELECT
    model,
    COUNT(*) AS outcomes,
    ROUND(AVG(CASE WHEN user_accepted THEN 1.0 ELSE 0.0 END), 3) AS accuracy
FROM classification_outcomes
WHERE user_accepted IS NOT NULL
GROUP BY model;
```

---

## Example

**Capture:** "need to call alex re thursday meeting"

**Classifier output:**

```json
{
  "type": "task",
  "title": "Call Alex re Thursday meeting",
  "tags": ["comms", "meeting"],
  "project": null,
  "due_date": null,
  "confidence": 9
}
```

**Current `task` threshold:** 0.75

**Decision:** 9/10 = 0.90 ≥ 0.75 → auto-classify. Written to OB1 immediately with no prompt.
`task` threshold nudges to 0.73.

---

**Capture:** "alex thursday"

**Classifier output:**

```json
{
  "type": "task",
  "title": "Follow up with Alex on Thursday",
  "tags": ["comms"],
  "project": null,
  "due_date": null,
  "confidence": 5
}
```

**Decision:** 5/10 = 0.50 < 0.75 → confirmation prompt shown.

User taps **Yes** → written to OB1, `task` threshold nudges to 0.73.
User taps **Decision** → re-classified as `decision`, written to OB1, `task` threshold
nudges to 0.77 (auto-classify was wrong for this type — raise the bar slightly).

---

## Notes

**The threshold floor is 0.50.** Even a perfectly performing classifier will never
auto-classify captures where the LLM reports less than 50% confidence. Captures that
consistently fall below the floor for a given type are inherently ambiguous — the right
response is to always ask.

**The threshold ceiling is 0.95.** The classifier is never treated as infallible.
This preserves occasional confirmation prompts even for types the system handles well,
which catches model drift and keeps the feedback loop alive.

**Thresholds are per-type, not global.** `task` captures may auto-classify aggressively
(threshold 0.60) while `decision` captures — which carry more consequence — stay
conservative (threshold 0.85). The system finds this balance from your corrections
without manual tuning.

**The spell correction tables (`correction_learnings`) are optional.** If your capture
interface already handles typos, or your users type accurately, skip this table entirely.
The rest of the recipe functions without it. If you do use it, see `classifier_prompt.md`
for guidance on domain vocabulary that should never be flagged as misspellings.

**This recipe does not modify the OB1 `thoughts` table or any existing schema.** All four
tables are additive. Rolling back means dropping the four tables; nothing else is affected.

## Troubleshooting

**All captures are being asked for confirmation.**
The thresholds start at 0.75 and the classifier may report conservative confidence scores
initially. This is expected — the system needs 10–20 captures per type before thresholds
settle. If confidence scores are consistently low (< 5), check your `{user_context}` string;
a missing or vague context causes the classifier to hedge on `project` and `type` fields,
which drags confidence down.

**The classifier keeps choosing the wrong type.**
Add an explicit type hint at capture time for captures where you know the type. A hint
locks the type field (confidence is set to 10 automatically) and the other metadata fields
are still inferred. This trains the threshold without polluting the accuracy stats with
cases where classification was genuinely ambiguous.

**Threshold for a type is stuck near the ceiling.**
This means the auto-classifier has been wrong more often than right for that type. Check
your `classification_outcomes` rows for that type — look at `confidence` values alongside
`user_accepted`. If confidence is consistently high but `user_accepted` is false, your
capture vocabulary for that type may be ambiguous or your type definitions may overlap. A
revised `{types}` list or a clearer user context string usually resolves this.
