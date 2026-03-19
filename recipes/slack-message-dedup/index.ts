/**
 * Slack Message Deduplication Pattern — extracted from ingest-thought/index.ts
 *
 * Problem: Slack can deliver the same webhook event multiple times (retries,
 * network hiccups). Without dedup, one Slack message could create duplicate
 * rows in the `thoughts` table.
 *
 * Solution: Before processing, query the `thoughts` table to see if a row
 * already exists whose `metadata->>slack_ts` matches the incoming event's
 * timestamp. If it does, skip processing and return 200 immediately.
 *
 * Key details:
 *   Table:  public.thoughts
 *   Field:  metadata  (jsonb column) → nested key "slack_ts"
 *   Query:  .eq("metadata->>slack_ts", slackTs)
 *   Stored: metadata is written as { ...extractedMetadata, slack_ts: messageTs }
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// ─── Idempotency helper ────────────────────────────────────────────────
// Checks the `thoughts` table for an existing row with this slack_ts
// inside the jsonb `metadata` column.

async function alreadyProcessed(slackTs: string): Promise<boolean> {
  const { data, error } = await supabase
    .from("thoughts")
    .select("id")
    .eq("metadata->>slack_ts", slackTs)
    .limit(1);

  if (error) {
    console.error("Idempotency check error:", error);
    return false; // fail-open: process the message rather than silently drop it
  }

  return data !== null && data.length > 0;
}

// ─── Where it sits in the request handler ──────────────────────────────
// This runs AFTER basic event filtering (bot messages, empty text, wrong
// channel, commands) but BEFORE the expensive work (embedding, LLM
// extraction, database writes).

Deno.serve(async (req: Request): Promise<Response> => {
  const body = await req.json();

  // ... (Slack URL verification, event filtering, command parsing omitted) ...

  const messageTs: string = body.event.ts;

  // ⬇️ DEDUP CHECK — the key line
  const isDuplicate = await alreadyProcessed(messageTs);
  if (isDuplicate) {
    console.log(`Skipping duplicate message: ${messageTs}`);
    return new Response("ok", { status: 200 });
  }

  // ... (proceed to embedding, metadata extraction, thought insert) ...

  // When the thought IS written, slack_ts is stored in the metadata column:
  //
  //   await supabase.from("thoughts").insert({
  //     content: messageText,
  //     embedding,
  //     domain,
  //     status: "active",
  //     source: "slack",
  //     metadata: { ...extractedMetadata, slack_ts: messageTs },  // ← stored here
  //   });

  return new Response("ok", { status: 200 });
});
