# Sensitivity Tiers

Three-tier content sensitivity classification for Open Brain thoughts. Automatically detects sensitive content using regex pattern matching and tags thoughts as `restricted`, `personal`, or `standard`.

## What It Does

Adds a `sensitivity_tier` column to your `thoughts` table and provides a reusable detection function. When capturing or ingesting thoughts, run the detector to classify content before storage. Query-side, filter with `WHERE sensitivity_tier != 'restricted'` to hide sensitive content by default.

**Restricted tier** (highest priority, short-circuits):
- Social Security Numbers (e.g., `123-45-6789`)
- Passport numbers
- Bank account and routing numbers
- API keys and tokens (`sk-`, `pk_live_`, `ghp_`, `AKIA`, etc.)
- Passwords in key-value format
- Credit card numbers

**Personal tier** (collected, all matches returned):
- Medication dosages (e.g., `50 mg`)
- Drug names (common prescriptions)
- Health measurements (glucose, A1C, blood pressure, etc.)
- Medical conditions and diagnoses
- Financial details (salary, net worth, portfolio values)
- Dollar amounts over $100

**Standard tier** (default):
- Everything that doesn't match restricted or personal patterns.

## Prerequisites

- A working Open Brain setup with the `thoughts` table
- Access to Supabase SQL Editor (for running the migration)

### Credential Tracker

No credentials needed. This primitive is pure pattern matching with no external API calls.

## Steps

### Step 1: Run the migration

Open your Supabase SQL Editor and run the contents of `migration.sql`:

```sql
ALTER TABLE thoughts
ADD COLUMN IF NOT EXISTS sensitivity_tier TEXT NOT NULL DEFAULT 'standard';

CREATE INDEX IF NOT EXISTS idx_thoughts_sensitivity_tier
ON thoughts (sensitivity_tier);

ALTER TABLE thoughts
ADD CONSTRAINT chk_sensitivity_tier
CHECK (sensitivity_tier IN ('standard', 'personal', 'restricted'));
```

> [!TIP]
> All existing thoughts default to `standard`. Run the backfill (Step 3) to classify them.

### Step 2: Integrate the detection function

Import and use `detectSensitivity()` in your capture/ingest pipeline:

**Deno (Edge Functions):**
```typescript
import patternsJson from "./sensitivity-patterns.json" with { type: "json" };
import { detectSensitivity, compilePatterns } from "./detect-sensitivity.ts";

const patterns = compilePatterns(patternsJson);

// In your capture handler:
const result = detectSensitivity(thoughtContent, patterns);
// result = { tier: "restricted", reasons: ["ssn_pattern"] }
// Store result.tier in the sensitivity_tier column
```

**Node.js:**
```javascript
import { readFileSync } from "fs";
import { detectSensitivity, compilePatterns } from "./detect-sensitivity.ts";

const patternsJson = JSON.parse(readFileSync("./sensitivity-patterns.json", "utf-8"));
const patterns = compilePatterns(patternsJson);

const result = detectSensitivity(thoughtContent, patterns);
```

### Step 3: Backfill existing thoughts (optional)

To classify thoughts already in your database, run a backfill script that:

1. Fetches all thoughts where `sensitivity_tier = 'standard'`
2. Runs `detectSensitivity()` on each thought's content
3. Updates any that match `personal` or `restricted` patterns

Example backfill loop:

```typescript
const { data: thoughts } = await supabase
  .from("thoughts")
  .select("id, content")
  .eq("sensitivity_tier", "standard");

for (const t of thoughts) {
  const result = detectSensitivity(t.content, patterns);
  if (result.tier !== "standard") {
    await supabase
      .from("thoughts")
      .update({ sensitivity_tier: result.tier })
      .eq("id", t.id);
  }
}
```

### Step 4: Filter queries

Add sensitivity filtering to your search and browse queries:

```sql
-- Hide restricted content (safe default for all user-facing queries)
SELECT * FROM thoughts WHERE sensitivity_tier != 'restricted';

-- Show everything (admin/unlocked mode)
SELECT * FROM thoughts;
```

If using the REST API or MCP tools, pass `exclude_restricted=true` as a query parameter.

## Expected Outcome

After running the migration and backfill:

- All thoughts have a `sensitivity_tier` value (`standard`, `personal`, or `restricted`)
- Queries with `WHERE sensitivity_tier != 'restricted'` exclude sensitive content
- New thoughts captured through your pipeline are automatically classified on ingest
- No external API calls or LLM needed — classification is instant regex matching

## Customizing Patterns

Edit `sensitivity-patterns.json` to add or modify detection rules. Each pattern has:

| Field | Description |
|-------|-------------|
| `pattern` | JavaScript regex pattern string |
| `flags` | Regex flags (e.g., `"i"` for case-insensitive) |
| `label` | Human-readable label returned in `reasons` array |

> [!WARNING]
> Test new patterns against your existing data before deploying. Overly broad patterns can misclassify standard content as restricted.

## Troubleshooting

1. **Migration fails with "column already exists"** — The `IF NOT EXISTS` clause handles this. If you see an error, check if `sensitivity_tier` already exists with a different type. Drop and recreate if needed.

2. **Backfill misses some content** — The regex patterns cover common formats but are not exhaustive. Review `restricted` and `personal` tagged thoughts periodically and add new patterns to `sensitivity-patterns.json` as needed.

3. **Check constraint error on insert** — Ensure your capture code only writes `standard`, `personal`, or `restricted` to the `sensitivity_tier` column. The constraint rejects any other value.
