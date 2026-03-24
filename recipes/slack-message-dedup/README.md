# Slack Message Deduplication Pattern

![Category](https://img.shields.io/badge/Category-Recipe-4CAF50?style=for-the-badge)
![Difficulty](https://img.shields.io/badge/Difficulty-Beginner-2196F3?style=for-the-badge)
![Time](https://img.shields.io/badge/Estimated_Time-15_Minutes-FF9800?style=for-the-badge)

## What It Does

Prevents duplicate thought ingestion when Slack delivers the same webhook event more than once. Uses the Slack message timestamp (`slack_ts`) stored inside the `thoughts` table's jsonb `metadata` column as a natural idempotency key — if a thought with that timestamp already exists, the function skips processing and returns `200` immediately.

## When to Use This

Use this pattern if:
- You're ingesting thoughts from Slack via webhooks
- You're experiencing duplicate rows in your `thoughts` table
- You want to avoid burning API credits on retry events

This pattern is NOT needed if:
- You're using Slack's Socket Mode (it has built-in dedup)
- Your ingestion source already provides idempotency (like email Message-IDs)

## Why This Matters

Slack's Events API makes no guarantee of exactly-once delivery. Network hiccups, retries, and edge function cold starts can all cause the same message to arrive multiple times. Without dedup, a single Slack message could generate duplicate rows in `thoughts`, duplicate `action_items`, and duplicate `people` entries — polluting your Open Brain data with noise that's hard to clean up after the fact.

## Prerequisites

- Working Open Brain setup (core `thoughts` table with a jsonb `metadata` column)
- A Supabase Edge Function that ingests thoughts from Slack (like `ingest-thought`)
- Slack Events API webhook delivering messages to your edge function

## How It Works

![Step 1](https://img.shields.io/badge/Step_1-Store_the_Slack_Timestamp-1E88E5?style=for-the-badge)

When a thought is first written to the database, the Slack message timestamp is embedded in the `metadata` jsonb column alongside extracted metadata:

```ts
await supabase.from("thoughts").insert({
  content: messageText,
  embedding,
  domain,
  status: "active",
  source: "slack",
  metadata: { ...extractedMetadata, slack_ts: messageTs },
});
```

✅ **Done when:** New thoughts include `slack_ts` in their `metadata` column. You can verify with:

```sql
select id, metadata->>'slack_ts' as slack_ts from thoughts order by created_at desc limit 5;
```

---

![Step 2](https://img.shields.io/badge/Step_2-Check_Before_Processing-1E88E5?style=for-the-badge)

Before doing any expensive work (embedding generation, LLM metadata extraction, database writes), the handler calls `alreadyProcessed()` to check if a thought with this `slack_ts` already exists:

```ts
async function alreadyProcessed(slackTs: string): Promise<boolean> {
  const { data, error } = await supabase
    .from("thoughts")
    .select("id")
    .eq("metadata->>slack_ts", slackTs)
    .limit(1);

  if (error) {
    console.error("Idempotency check error:", error);
    return false; // fail-open: don't silently drop messages
  }

  return data !== null && data.length > 0;
}
```

> [!IMPORTANT]
> The function **fails open** — if the database query errors, it returns `false` (not a duplicate) so messages are never silently dropped. This is a deliberate design choice: a rare duplicate row is less harmful than a lost thought.

✅ **Done when:** Your handler calls `alreadyProcessed()` before any processing logic and skips duplicates.

---

![Step 3](https://img.shields.io/badge/Step_3-Place_It_in_the_Handler-1E88E5?style=for-the-badge)

The dedup check runs in the request handler **after** all cheap filtering but **before** any expensive operations:

**1. Understand the placement order:**

```
1. Slack URL verification (instant)
2. Filter bot messages, empty text, wrong channel (instant)
3. Parse commands (instant)
4. ⬇️ DEDUP CHECK ← here
5. Generate embedding (API call — costs money)
6. Extract metadata via LLM (API call — costs money)
7. Write to thoughts, people, action_items (DB writes)
```

**2. Add the check in your handler:**

```ts
// In your Deno.serve handler, after filtering:
const isDuplicate = await alreadyProcessed(messageTs);
if (isDuplicate) {
  console.log(`Skipping duplicate message: ${messageTs}`);
  return new Response("ok", { status: 200 });
}
```

> [!TIP]
> Placing the check after command parsing but before embedding/LLM calls means you avoid burning OpenRouter API credits on duplicate events while still keeping the check lightweight (one indexed DB query).

✅ **Done when:** Duplicate Slack events are logged and skipped, and your OpenRouter usage doesn't spike from retries.

## Expected Outcome

When a duplicate Slack event arrives, you should see `Skipping duplicate message: <timestamp>` in your edge function logs. The function returns `200` immediately without generating embeddings, calling the LLM, or writing any database rows. Your `thoughts` table will contain exactly one row per Slack message.

**Verify it's working:** Run this query to confirm you have exactly one row per unique `slack_ts`:

```sql
select metadata->>'slack_ts' as slack_ts, count(*)
from thoughts
where source = 'slack'
group by metadata->>'slack_ts'
having count(*) > 1;
```

If the query returns no rows, dedup is working correctly. If it returns rows, you have duplicates that were created before implementing this pattern.

## Troubleshooting

**Duplicates are still appearing:** Check that `slack_ts` is actually being stored in the metadata column. Run the following query — if the values are `null`, the insert step isn't including `slack_ts` in the metadata object:

```sql
select metadata->>'slack_ts' from thoughts order by created_at desc limit 5;
```

**The dedup check is slow:** The jsonb arrow query (`metadata->>slack_ts`) can be slow on large tables without an index. Add a GIN index on the metadata column:

```sql
create index if not exists idx_thoughts_metadata on thoughts using gin (metadata);
```

**Messages are being dropped (not processed at all):** Check your edge function logs for `Idempotency check error:` — this means the dedup query itself is failing. The function fails open by design, so if you're seeing dropped messages, the issue is elsewhere in your pipeline.

## Files

| File | Purpose |
|------|---------|
| `index.ts` | Reference implementation showing the dedup helper function and handler placement pattern |
| `README.md` | This guide |
| `metadata.json` | Contribution metadata for the OB1 repo |
