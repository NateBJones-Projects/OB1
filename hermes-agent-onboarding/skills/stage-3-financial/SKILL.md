---
name: stage-3-financial
version: 1.0.0
description: >
  Stage 3 of the meta-skill agent-onboarding. Financial profile based on MBTI +
  bank CSV import + goal setting + strategies adapted to
  personality type.
tags: [financial, mbti, csv, goals, stage-3, meta-skill]
---

# Stage 3 — Financial Profile

## Purpose

This stage builds the user's financial profile from 4 layers:
1. **Data import** (bank CSV → Supabase)
2. **MBTI × Finance profile** (financial behavior by personality type)
3. **Financial goals** (short, medium, and long term)
4. **Adapted strategies** tailored to profile + goals

## Skill Files

| File | Function |
|------|---------|
| `mbti_financial_profiles.py` | 16 MBTI financial profiles in English with assess_financial_personality() |
| `csv_importer.py` | Bank CSV importer with automatic format detection |

---

## PART 1 — CONVERSATIONAL FLOW

### 3A: CSV Import

```
"Would you like me to analyze your bank statements?
I can read CSVs from Nubank, Itaú, Inter, Caixa, and generic formats.

If you want to:
1. Export your statement as CSV
2. Send me the file (or paste the content)
3. I'll show a preview and you confirm before importing"
```

**Preview mode always first:**

```
Detected format: Nubank
Period: 01/01/2026 to 01/31/2026
Transactions: 45
  Income: R$ 8,500.00
  Expenses: R$ 5,230.00
  Period balance: R$ 3,270.00

Detected categories:
  Food: 12 transactions
  Transportation: 8 transactions
  Subscriptions: 4 transactions

Import? (y/N):
```

### 3B: MBTI × Finance Profile

After MBTI is registered (from Stage 1C), ask:

```
"Your MBTI type is {type_code} — {name}.
Would you like me to analyze how this influences your finances?

I can show you:
• Your financial profile based on MBTI
• Strengths and weaknesses with money
• How you tend to save, spend, and invest
• Specific recommendations for your type

Shall we?"
```

Use `mbti_financial_profiles.py`:

```python
from mbti_financial_profiles import get_financial_profile, assess_financial_personality

profile = get_financial_profile(type_code)
# profile contains: strengths, weaknesses, saving_style, spending_style, risk_profile

# After asking 4 calibration questions:
observations = assess_financial_personality(answers, type_code)
```

### 3C: Goals

```
"Let's set your financial goals. Think about:
1. Short-term (6 months from now)
2. Medium-term (2 years from now)
3. Long-term (5+ years from now)

What would you like to achieve in each timeframe?"
```

Register via API:

```python
requests.post(f"{SUPABASE_URL}/rest/v1/finance_goals",
  headers={"apikey": SUPABASE_SERVICE_ROLE_KEY, ...},
  json={"name": "...", "target_amount": ..., "target_date": "...",
        "goal_type": "purchase|emergency_fund|debt_payoff|...",
        "priority": 1-5})
```

### 3D: Adapted Strategies

Combine MBTI profile + goals into actionable recommendations:
- Automated saving rules
- Investment allocation suggestions
- Emergency fund targets
- Spending guardrails (e.g., "sleep on it" rule for ENFPs)

---

## PART 2 — CSV IMPORTER (csv_importer.py)

### Format Detection

```python
def detect_format(headers):
    """Detect bank format from CSV header line."""
    patterns = {
        "nubank": ["date", "value", "category", "title"],
        "inter": ["data", "lançamento", "débito", "crédito", "saldo"],
        "itau": ["data", "descrição", "valor"],
        "caixa": ["data", "histórico", "valor"],
    }
    # Match by normalized header intersection
    ...
```

### Auto-categorization

```python
CATEGORY_KEYWORDS = {
    "food": ["supermercado", "restaurante", "padaria", "acougue",
             "feira", "ifood", "uber eats"],
    "transport": ["uber", "99taxi", "gasolina", "pedagio",
                  "estacionamento", "metro"],
    "subscriptions": ["netflix", "spotify", "prime video", "disney+"],
    "housing": ["aluguel", "condominio", "agua", "luz", "energia"],
    ...
}
```

---

## PART 3 — MBTI FINANCIAL PROFILES (mbti_financial_profiles.py)

### Structure

```python
FINANCIAL_PROFILES = {
    "ENFJ": {
        "name": "The Mentor",
        "strengths": [
            "Generous with time and resources for causes they believe in",
            "Motivated by collaborative financial goals"
        ],
        "weaknesses": [
            "May overspend on people/relationships",
            "Can neglect personal financial planning"
        ],
        "saving_style": "Group goal saver",
        "spending_style": "Value-driven spender",
        "risk_profile": "Moderate",
    },
    "INTJ": {
        "name": "The Strategist",
        "strengths": [
            "Excellent long-term financial planning",
            "Systematic approach to wealth building"
        ],
        "weaknesses": [
            "May over-optimize and miss spontaneous opportunities",
            "Can be rigid with financial plans"
        ],
        "saving_style": "Systematic optimizer",
        "spending_style": "Purposeful spender",
        "risk_profile": "Moderate to high",
    },
    # ... all 16 types
}
```
