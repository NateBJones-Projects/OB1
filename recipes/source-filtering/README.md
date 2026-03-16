# Source Filtering

> Filter and search thoughts by source, backfill metadata for early imports.

## What It Does

Source filtering lets you scope `search_thoughts`, `list_thoughts`, and `thought_stats` to a single source type (e.g., `mcp`, `gmail`, `chatgpt`, `obsidian`). The backfill script adds structured metadata (type, topics, people, sentiment) to thoughts that were imported without LLM extraction — like bulk email imports that went straight into Supabase.

## Prerequisites

- Working Open Brain setup ([guide](../../docs/01-getting-started.md))
- Deno 1.40+ (for backfill script only)
- Supabase project URL and service role key
- OpenRouter API key (for backfill script only)

## Credential Tracker

Copy this block into a text editor and fill it in as you go.

```text
SOURCE FILTERING -- CREDENTIAL TRACKER
--------------------------------------

FROM YOUR OPEN BRAIN SETUP
  Supabase Project URL:        ____________
  Supabase Service Role Key:   ____________

FOR BACKFILL ONLY
  OpenRouter API Key:          ____________

--------------------------------------
```

## Steps

1. Check your sources
2. Use source filtering
3. Check if you need backfill
4. Set up environment variables for backfill
5. Run the backfill
6. Verify

### Step 1: Check your sources

Run this query in the Supabase SQL Editor to see what sources exist in your brain:

```sql
SELECT metadata->>'source' AS source, COUNT(*) AS count
FROM thoughts
GROUP BY metadata->>'source'
ORDER BY count DESC;
```

You'll see something like:

| source   | count |
|----------|-------|
| gmail    | 1200  |
| mcp      | 180   |
| chatgpt  | 50    |
| *null*   | 15    |

### Step 2: Use source filtering

Source filtering works with three MCP tools. Pass the `source` parameter to scope results:

**search_thoughts** — semantic search within a single source:

```
"Search my gmail thoughts for conversations about the product roadmap"
→ search_thoughts({ query: "product roadmap", source: "gmail" })
```

**list_thoughts** — recent thoughts from a specific source:

```
"Show me my last 10 ChatGPT thoughts"
→ list_thoughts({ limit: 10, source: "chatgpt" })
```

**thought_stats** — stats scoped to a source:

```
"How many gmail thoughts do I have?"
→ thought_stats({ source: "gmail" })
```

Without the `source` parameter, all three tools return results across all sources (existing behavior).

### Step 3: Check if you need backfill

If you imported thoughts without going through `capture_thought` (e.g., bulk email import via direct Supabase insert), those thoughts may be missing LLM-extracted metadata like `type`, `topics`, and `people`. Check:

```sql
SELECT COUNT(*) AS missing_metadata
FROM thoughts
WHERE metadata->>'type' IS NULL;
```

If this returns 0, you're done — skip to Step 6. If it returns a number, continue to Step 4.

### Step 4: Set up environment variables for backfill

```bash
export SUPABASE_URL="https://your-project.supabase.co"
export SUPABASE_SERVICE_ROLE_KEY="your-service-role-key"
export OPENROUTER_API_KEY="your-openrouter-key"
```

### Step 5: Run the backfill

Start with a dry run to see what would be updated:

```bash
deno run --allow-net --allow-env backfill-metadata.ts --dry-run --limit=10
```

Then run a small live batch:

```bash
deno run --allow-net --allow-env backfill-metadata.ts --limit=10
```

If that looks good, run the full backfill:

```bash
deno run --allow-net --allow-env backfill-metadata.ts --limit=1000
```

You can also scope the backfill to a specific source:

```bash
deno run --allow-net --allow-env backfill-metadata.ts --source=gmail --limit=500
```

### Step 6: Verify

Run `thought_stats` (or `thought_stats({ source: "gmail" })`) — the output should now include a "By source:" breakdown and "By type:" categories for backfilled thoughts.

You can also verify in SQL:

```sql
SELECT metadata->>'type' AS type, COUNT(*)
FROM thoughts
WHERE metadata->>'type' IS NOT NULL
GROUP BY metadata->>'type'
ORDER BY count DESC;
```

## Expected Outcome

- `thought_stats` shows a "By source:" section with counts per source
- `search_thoughts` with `source: "gmail"` returns only Gmail-sourced thoughts
- `search_thoughts` without `source` returns thoughts from all sources
- Backfilled thoughts now have `type`, `topics`, `people`, `sentiment`, and `action_items` in their metadata

## Troubleshooting

**Thoughts have `null` source**
Some early thoughts were captured before source tracking was added. You can backfill the source field manually:

```sql
UPDATE thoughts SET metadata = metadata || '{"source": "mcp"}'::jsonb
WHERE metadata->>'source' IS NULL;
```

**Backfill says "Found 0 thought(s) missing metadata"**
All your thoughts already have LLM-extracted metadata. This happens if everything was imported through `capture_thought`, which extracts metadata automatically.

**Rate limiting from OpenRouter**
The script batches requests (default 10 concurrent) with a 500ms pause between batches. If you hit rate limits, reduce the batch size:

```bash
deno run --allow-net --allow-env backfill-metadata.ts --batch-size=3
```

**Source strings are case-sensitive**
`source: "Gmail"` won't match `source: "gmail"`. Sources are stored lowercase. If you have mixed-case sources from a custom import, normalize them:

```sql
UPDATE thoughts SET metadata = jsonb_set(metadata, '{source}', to_jsonb(LOWER(metadata->>'source')))
WHERE metadata->>'source' IS DISTINCT FROM LOWER(metadata->>'source');
```
