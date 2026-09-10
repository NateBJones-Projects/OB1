---
name: mbti-guru-hermes
version: 1.0.0
description: >
  MBTI engine for conversation within the agent-onboarding meta-skill.
  Administers the full MBTI Guru test in conversation — A/B questions, scoring
  identical to the original, descriptions of all 16 types.
  4 versions: Quick (70q), Standard (93q), Extended (144q), Professional (200q).
tags: [mbti, guru, personality, test, conversation, stage-1c, meta-skill]
---

# MBTI Guru Hermes — Typing Engine for Conversation

## Purpose

This skill enables the agent to administer the full MBTI Guru test
directly in conversation. The agent asks each question in A/B format,
accumulates responses by dimension (E/I, S/N, T/F, J/P), calculates
the type using scoring identical to the original Guru, and records
the result in `user_mbti` in Supabase.

## Skill Files

| File | Role |
|------|------|
| `questions.py` | 200 questions in English (4 versions: 70, 93, 144, 200) |
| `scorer.py` | Scoring identical to the original MBTI Guru |
| `types.py` | 16 types with full descriptions in English |
| `run_test.py` | Autonomous module for execution |

---

## PART 1 — CONVERSATIONAL FLOW

### 1. Introduction

```
You: "Do you know MBTI? Do you know your type?"
```

**If they know:** ask for their type and validate with 4 quick questions
(one per dimension).

**If they don't know:** explain the 4 dimensions and offer the 4 versions:

```
"MBTI has 4 dimensions:
• Energy: Extraversion (E) vs Introversion (I)
• Information: Sensing (S) vs Intuition (N)
• Decision: Thinking (T) vs Feeling (F)
• Structure: Judging (J) vs Perceiving (P)

There are 16 personality types in total.

MBTI Guru offers 4 test versions:
1. Quick — 70 questions (~10 min)
2. Standard — 93 questions (~15 min)
3. Extended — 144 questions (~25 min)
4. Professional — 200 questions (~35 min)

Which one would you like?"
```

### 2. Test Administration

**Each question:**
```
Question X/N:
[A] <option A>
[B] <option B>

Reply A or B:
```

**Wait for response.** Only proceed after receiving A or B.
If ambiguous: "Reply only A or B."

**Store internally:**
```python
answers = [(1, "A"), (2, "B"), ...]  # (question_id, selected_option)
```

### 3. Finalization

After the last question:

```python
type_code, scores = calculate_type(answers)
```

Display result:
```
=== MBTI RESULT ===
Your type: {type_code} — {name}

Dimensions:
• E/I: {score_EI}% ({pref}) — {clarity_level}
• S/N: {score_SN}% ({pref}) — {clarity_level}
• T/F: {score_TF}% ({pref}) — {clarity_level}
• J/P: {score_JP}% ({pref}) — {clarity_level}
```

### 4. Registration

```python
import requests

# Register in user_mbti
requests.post(f"{SUPABASE_URL}/rest/v1/user_mbti", headers={
    "apikey": SUPABASE_SERVICE_ROLE_KEY,
    "Authorization": f"Bearer {SUPABASE_SERVICE_ROLE_KEY}"
}, json={
    "ei": type_code[0],
    "sn": type_code[1],
    "tf": type_code[2],
    "jp": type_code[3],
    "mbti_type": type_code,
    "mbti_name": tdata.get("name"),
    "ei_score": scores["ei"],
    "sn_score": scores["sn"],
    "tf_score": scores["tf"],
    "jp_score": scores["jp"],
    "ei_clarity": clarity["ei"],
    "sn_clarity": clarity["sn"],
    "tf_clarity": clarity["tf"],
    "jp_clarity": clarity["jp"],
    "source": "quick_test|standard_test|extended_test|professional_test"
})
```

---

## PART 2 — SCORING ENGINE

### How scoring works

Each dimension has N questions. Each answer scores toward one pole.

```python
def calculate_type(answers, all_questions):
    """
    Answers: list of (question_id, "A"|"B")
    Questions: dict of {id: {"dimension": "EI", "option_a": "...", "option_b": "..."}}
    
    Returns: (type_code, scores_dict)
    """
    dimensions = {"EI": {"E": 0, "I": 0},
                  "SN": {"S": 0, "N": 0},
                  "TF": {"T": 0, "F": 0},
                  "JP": {"J": 0, "P": 0}}
    
    for q_id, choice in answers:
        q = all_questions[q_id]
        dim = q["dimension"]
        pole = q[f"option_{choice.lower()}_pole"]
        dimensions[dim][pole] += 1
    
    type_code = ""
    scores = {}
    for dim, (p1, p2) in [("EI", ("E", "I")), ("SN", ("S", "N")),
                           ("TF", ("T", "F")), ("JP", ("J", "P"))]:
        total = dimensions[dim][p1] + dimensions[dim][p2]
        if total == 0:
            type_code += "X"
            scores[dim.lower()] = 50
        else:
            pct_p1 = (dimensions[dim][p1] / total) * 100
            type_code += p1 if pct_p1 >= 50 else p2
            scores[dim.lower()] = pct_p1 if pct_p1 >= 50 else 100 - pct_p1
    
    return type_code, scores

def calculate_clarity(scores):
    """Clarity = abs(score - 50) * 2. 0=ambiguous, 100=crystal."""
    return {dim: abs(score - 50) * 2 for dim, score in scores.items()}
```

### Clarity levels

| Clarity | Level |
|---------|-------|
| 0-20 | Slight preference (ambiguous) |
| 20-40 | Moderate preference |
| 40-60 | Clear preference |
| 60-80 | Very clear preference |
| 80-100 | Dominant preference |
