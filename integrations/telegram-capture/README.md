# Telegram Capture Integration

## What It Does

Adds Telegram as a quick-capture interface for your Open Brain. Send a message to your bot from your phone — it gets embedded, classified, and stored as a thought, with a confirmation reply showing how it was categorised.

Optionally supports **two-way conversation**: an agent can send a prompt and the next reply from your Telegram chat is routed back to a `telegram_pending_replies` table, allowing autonomous agents (like a property management agent) to ask questions and await your response asynchronously.

## Prerequisites

- A working Open Brain setup (follow the [Getting Started guide](../../docs/01-getting-started.md) through Step 4)
- A Telegram account and access to [@BotFather](https://t.me/BotFather)

## Cost

Telegram is free. The Edge Function uses the same OpenRouter credits from your Open Brain setup — embeddings ~$0.02/million tokens, metadata extraction ~$0.15/million input tokens. For 20 thoughts/day, expect $0.10–0.30/month.

---

## Credential Tracker

```text
TELEGRAM CAPTURE -- CREDENTIAL TRACKER
---------------------------------------

FROM YOUR OPEN BRAIN SETUP
  OpenRouter API key:    ____________

TELEGRAM
  Bot username:          @___________
  Bot token:             ____________  (from BotFather)
  Your chat ID:          ____________  (see Step 2)

GENERATED DURING SETUP
  Edge Function URL:     https://____________.supabase.co/functions/v1/telegram-capture

---------------------------------------
```

---

## Step 1: Create Your Telegram Bot

1. Open Telegram and search for **[@BotFather](https://t.me/BotFather)**
2. Send `/newbot`
3. Choose a name (e.g. "My Brain") and a username ending in `bot` (e.g. `myopenbrain_bot`)
4. Copy the **bot token** — it looks like `1234567890:ABCdef...`
5. Save it in your credential tracker above

---

## Step 2: Get Your Chat ID

You need to restrict the bot to only accept messages from you.

1. Start a conversation with your new bot — open it in Telegram and press **Start**
2. Send any message (e.g. "hello")
3. Open this URL in your browser (replace `YOUR_BOT_TOKEN`):
   ```
   https://api.telegram.org/botYOUR_BOT_TOKEN/getUpdates
   ```
4. Find `"chat": {"id": XXXXXXX}` in the response — that number is your chat ID
5. Save it in your credential tracker above

---

## Step 3: Deploy the Edge Function

### Verify Supabase CLI

```bash
supabase --version
```

### Log In and Link (if not already done)

```bash
supabase login
supabase link --project-ref YOUR_PROJECT_REF
```

### Create the Function

```bash
supabase functions new telegram-capture
```

Open `supabase/functions/telegram-capture/index.ts` and replace its entire contents with:

```typescript
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const OPENROUTER_API_KEY = Deno.env.get("OPENROUTER_API_KEY")!;
const TELEGRAM_BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN")!;
const TELEGRAM_ALLOWED_CHAT_ID = Deno.env.get("TELEGRAM_ALLOWED_CHAT_ID")!;

const OPENROUTER_BASE = "https://openrouter.ai/api/v1";
const TELEGRAM_API = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}`;
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

async function getEmbedding(text: string): Promise<number[]> {
  const r = await fetch(`${OPENROUTER_BASE}/embeddings`, {
    method: "POST",
    headers: { "Authorization": `Bearer ${OPENROUTER_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: "openai/text-embedding-3-small", input: text }),
  });
  const d = await r.json();
  return d.data[0].embedding;
}

async function extractMetadata(text: string): Promise<Record<string, unknown>> {
  const r = await fetch(`${OPENROUTER_BASE}/chat/completions`, {
    method: "POST",
    headers: { "Authorization": `Bearer ${OPENROUTER_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "openai/gpt-4o-mini",
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: `Extract metadata from the user's captured thought. Return JSON with:
- "people": array of people mentioned (empty if none)
- "action_items": array of implied to-dos (empty if none)
- "dates_mentioned": array of dates YYYY-MM-DD (empty if none)
- "topics": array of 1-3 short topic tags (always at least one)
- "type": one of "observation", "task", "idea", "reference", "person_note"
Only extract what's explicitly there.`,
        },
        { role: "user", content: text },
      ],
    }),
  });
  const d = await r.json();
  try { return JSON.parse(d.choices[0].message.content); }
  catch { return { topics: ["uncategorized"], type: "observation" }; }
}

async function sendReply(chatId: number, text: string, replyToMessageId?: number): Promise<void> {
  const body: Record<string, unknown> = { chat_id: chatId, text };
  if (replyToMessageId) body.reply_to_message_id = replyToMessageId;
  await fetch(`${TELEGRAM_API}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

Deno.serve(async (req: Request): Promise<Response> => {
  // Only accept POST
  if (req.method !== "POST") return new Response("ok", { status: 200 });

  let body: Record<string, unknown>;
  try { body = await req.json(); }
  catch { return new Response("bad request", { status: 400 }); }

  const message = body.message as Record<string, unknown> | undefined;
  if (!message) return new Response("ok", { status: 200 });

  const chat = message.chat as Record<string, unknown>;
  const chatId = chat?.id as number;
  const messageId = message.message_id as number;
  const updateId = body.update_id as number;
  const text = message.text as string | undefined;

  // Security: only accept messages from your own chat
  if (String(chatId) !== TELEGRAM_ALLOWED_CHAT_ID) {
    return new Response("ok", { status: 200 });
  }

  // Skip commands (e.g. /start)
  if (!text || text.startsWith("/")) return new Response("ok", { status: 200 });

  // Deduplicate: Telegram may retry deliveries
  const { data: existing } = await supabase
    .from("thoughts")
    .select("id")
    .contains("metadata", { telegram_update_id: updateId })
    .limit(1);
  if (existing && existing.length > 0) return new Response("ok", { status: 200 });

  // Check if this is a reply to a pending agent prompt
  const replyToMessage = message.reply_to_message as Record<string, unknown> | undefined;
  if (replyToMessage) {
    const agentMessageId = replyToMessage.message_id as number;
    const { data: pending } = await supabase
      .from("telegram_pending_replies")
      .select("id, context")
      .eq("agent_message_id", agentMessageId)
      .eq("status", "pending")
      .limit(1);

    if (pending && pending.length > 0) {
      // Route reply back to the pending request — the agent polling this table will pick it up
      await supabase
        .from("telegram_pending_replies")
        .update({ reply_text: text, status: "received", received_at: new Date().toISOString() })
        .eq("id", pending[0].id);

      await sendReply(chatId, "Got it.", messageId);
      return new Response("ok", { status: 200 });
    }
  }

  // Otherwise: capture as a thought
  try {
    const [embedding, metadata] = await Promise.all([
      getEmbedding(text),
      extractMetadata(text),
    ]);

    const { error } = await supabase.from("thoughts").insert({
      content: text,
      embedding,
      metadata: { ...metadata, source: "telegram", telegram_update_id: updateId },
    });

    if (error) {
      await sendReply(chatId, `Failed to capture: ${error.message}`, messageId);
      return new Response("error", { status: 500 });
    }

    const meta = metadata as Record<string, unknown>;
    let confirmation = `Captured as *${meta.type || "thought"}*`;
    if (Array.isArray(meta.topics) && meta.topics.length > 0)
      confirmation += ` — ${(meta.topics as string[]).join(", ")}`;
    if (Array.isArray(meta.people) && meta.people.length > 0)
      confirmation += `\nPeople: ${(meta.people as string[]).join(", ")}`;
    if (Array.isArray(meta.action_items) && meta.action_items.length > 0)
      confirmation += `\nActions: ${(meta.action_items as string[]).join("; ")}`;

    await sendReply(chatId, confirmation, messageId);
    return new Response("ok", { status: 200 });
  } catch (err) {
    console.error("Function error:", err);
    return new Response("error", { status: 500 });
  }
});
```

### Set Your Secrets

```bash
supabase secrets set OPENROUTER_API_KEY=your-openrouter-key-here
supabase secrets set TELEGRAM_BOT_TOKEN=your-bot-token-here
supabase secrets set TELEGRAM_ALLOWED_CHAT_ID=your-chat-id-here
```

> `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are automatically available inside Edge Functions.

### Deploy

```bash
supabase functions deploy telegram-capture --no-verify-jwt
```

Copy the Edge Function URL — it looks like:
`https://YOUR_PROJECT_REF.supabase.co/functions/v1/telegram-capture`

---

## Step 4: Register the Webhook with Telegram

Tell Telegram to send updates to your Edge Function:

```bash
curl -X POST "https://api.telegram.org/botYOUR_BOT_TOKEN/setWebhook" \
  -H "Content-Type: application/json" \
  -d '{"url": "https://YOUR_PROJECT_REF.supabase.co/functions/v1/telegram-capture"}'
```

You should see `{"ok":true,"result":true}`.

To verify the webhook is registered:
```bash
curl "https://api.telegram.org/botYOUR_BOT_TOKEN/getWebhookInfo"
```

---

## Step 5: Test It

Send a message to your bot in Telegram:

```
Sarah mentioned she's thinking about leaving her job to start a consulting business
```

You should get a reply within a few seconds:

```
Captured as person_note — career, consulting
People: Sarah
Actions: Check in with Sarah about consulting plans
```

Then check Supabase → Table Editor → thoughts to confirm the row is there.

---

## Optional: Two-Way Conversation (Agent Prompt & Reply)

For autonomous agents that need to send a prompt and await your response, this integration includes a `telegram_pending_replies` table pattern.

### Create the Table

Run in Supabase SQL Editor:

```sql
CREATE TABLE telegram_pending_replies (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  context     TEXT,              -- what the agent was asking about
  prompt_text TEXT NOT NULL,     -- the message sent to you
  agent_message_id BIGINT,       -- Telegram message_id of the agent's prompt
  reply_text  TEXT,              -- your reply (filled in by the webhook)
  status      TEXT NOT NULL DEFAULT 'pending', -- pending | received | expired
  created_at  TIMESTAMPTZ DEFAULT now(),
  received_at TIMESTAMPTZ
);
```

### How It Works

1. An agent sends a prompt to Telegram via the Bot API and records the `message_id`
2. It inserts a row into `telegram_pending_replies` with `status='pending'` and `agent_message_id`
3. When you **reply to that specific message** in Telegram, the webhook detects it's a reply to a pending prompt and updates the row with `reply_text` + `status='received'`
4. The agent polls `telegram_pending_replies` for its row until it appears (or expires)

### Send a Prompt (from your agent)

```typescript
// POST to Telegram to send a prompt
const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ chat_id: YOUR_CHAT_ID, text: "How are you feeling? (1-5)" }),
});
const msg = await res.json();
const agentMessageId = msg.result.message_id;

// Record as pending
await supabase.from("telegram_pending_replies").insert({
  context: "midday_checkin",
  prompt_text: "How are you feeling? (1-5)",
  agent_message_id: agentMessageId,
});

// Poll for reply (up to 2 minutes)
const deadline = Date.now() + 120_000;
while (Date.now() < deadline) {
  await new Promise(r => setTimeout(r, 5000));
  const { data } = await supabase
    .from("telegram_pending_replies")
    .select("reply_text, status")
    .eq("agent_message_id", agentMessageId)
    .single();
  if (data?.status === "received") {
    console.log("Reply:", data.reply_text);
    break;
  }
}
```

---

## Expected Outcome

Every message you send to your bot is automatically:
- Embedded with a 1536-dimensional vector for semantic search
- Classified by type (observation, task, idea, reference, person_note)
- Tagged with topics, people, action items, and dates
- Stored in your `thoughts` table
- Confirmed with a reply showing the extracted metadata

Optional two-way conversation lets autonomous agents send prompts and collect your replies asynchronously via Supabase — no long-polling, no timeouts.

---

## Troubleshooting

### Bot doesn't reply

Check Edge Function logs: Supabase dashboard → Edge Functions → telegram-capture → Logs. Most likely the bot token or chat ID is wrong.

### Webhook not receiving updates

```bash
curl "https://api.telegram.org/botYOUR_BOT_TOKEN/getWebhookInfo"
```

If `url` is empty, re-run the `setWebhook` command. If there's a `last_error_message`, that's what's failing.

### Duplicate thoughts appearing

The function deduplicates on `telegram_update_id`. If you see duplicates from before this was deployed, they're historical — new messages won't duplicate.

### Two-way replies not being routed

You must **reply to the specific message** (long-press → Reply in Telegram), not just send a new message. The webhook checks `reply_to_message.message_id` to match pending requests.

---

*Part of the [Open Brain project](https://github.com/NateBJones-Projects/OB1)*
