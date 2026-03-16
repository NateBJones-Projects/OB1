# Telegram Capture Integration

## What It Does

Adds Telegram as a quick-capture interface for your Open Brain. Send a thought from your phone (or desktop), it gets automatically embedded, classified, and stored — with a reply confirming how your message was categorized.

This is especially useful for mobile capture. Telegram is lightweight, fast, and works offline (messages queue until you have signal). Combined with Telegram's built-in voice-to-text, you can speak thoughts into your brain without opening a laptop.

## Prerequisites

- A working Open Brain setup (follow the [Getting Started guide](../../docs/01-getting-started.md) through Step 4 — you need the Supabase database, OpenRouter API key, and Supabase CLI installed)
- A Telegram account (free)

## Cost

Telegram is free. The Edge Function uses the same OpenRouter credits from your main Open Brain setup — embeddings cost ~$0.02 per million tokens, metadata extraction ~$0.15 per million input tokens. For 20 thoughts/day, expect roughly $0.10–0.30/month in API costs.

---

## Credential Tracker

Copy this block into a text editor and fill it in as you go.

```text
TELEGRAM CAPTURE -- CREDENTIAL TRACKER
--------------------------------------

FROM YOUR OPEN BRAIN SETUP
  OpenRouter API key:    ____________

TELEGRAM INFO
  Bot Token (Step 1):    ____________
  Your Chat ID (Step 2): ____________

GENERATED DURING SETUP
  Edge Function URL:     https://____________.supabase.co/functions/v1/ingest-thought

--------------------------------------
```

---

## Step 1: Create a Telegram Bot

Telegram bots are free and take about 60 seconds to create.

1. Open Telegram and search for **@BotFather** (the official bot for creating bots)
2. Send `/newbot`
3. Choose a name (e.g., "My Brain")
4. Choose a username (must end in `bot`, e.g., `myopenbrain_bot`)
5. BotFather will reply with your **Bot Token** — it looks like `123456789:ABCdefGHIjklMNOpqrsTUVwxyz`
6. Save the Bot Token — you'll need it in Step 3

> **Keep this token private.** Anyone with it can control your bot.

---

## Step 2: Get Your Chat ID

The Edge Function needs to know which chat to listen to. This prevents random people from writing to your brain.

1. Open Telegram and send any message to your new bot (e.g., "hello")
2. Open this URL in your browser (replace `YOUR_BOT_TOKEN` with the token from Step 1):
   ```
   https://api.telegram.org/botYOUR_BOT_TOKEN/getUpdates
   ```
3. Look for `"chat":{"id":1234567890}` in the JSON response — that number is your Chat ID
4. Save the Chat ID — you'll need it in Step 3

> **Tip:** If the response is empty (`{"ok":true,"result":[]}`), send another message to your bot and refresh the page.

---

## Step 3: Deploy the Edge Function

This is the brains of the operation. One function receives messages from Telegram, generates an embedding, extracts metadata, stores everything in Supabase, and replies with a confirmation.

> **New to the terminal?** The "terminal" is the text-based command line on your computer. On Mac, open the app called **Terminal** (search for it in Spotlight). On Windows, open **PowerShell**. Everything below gets typed there, not in your browser.

### Verify Supabase CLI

Make sure you completed Step 7 of the main guide (Supabase CLI installation). Verify it's working:

```bash
supabase --version
```

If that command fails, go back to the [Getting Started guide](../../docs/01-getting-started.md) Step 7 and install the CLI first.

### Log In and Link (if not already done)

```bash
supabase login
supabase link --project-ref YOUR_PROJECT_REF
```

Replace `YOUR_PROJECT_REF` with the project ref from your Supabase dashboard URL: `supabase.com/dashboard/project/THIS_PART`.

### Create the Function

```bash
supabase functions new ingest-thought
```

Open `supabase/functions/ingest-thought/index.ts` and replace its entire contents with:

```typescript
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const OPENROUTER_API_KEY = Deno.env.get("OPENROUTER_API_KEY")!;
const TELEGRAM_BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN")!;
const TELEGRAM_CAPTURE_CHAT_ID = Deno.env.get("TELEGRAM_CAPTURE_CHAT_ID")!;

const OPENROUTER_BASE = "https://openrouter.ai/api/v1";
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

async function getEmbedding(text: string): Promise<number[]> {
  const r = await fetch(`${OPENROUTER_BASE}/embeddings`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENROUTER_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "openai/text-embedding-3-small",
      input: text,
    }),
  });
  const d = await r.json();
  return d.data[0].embedding;
}

async function extractMetadata(
  text: string
): Promise<Record<string, unknown>> {
  const r = await fetch(`${OPENROUTER_BASE}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENROUTER_API_KEY}`,
      "Content-Type": "application/json",
    },
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
  try {
    return JSON.parse(d.choices[0].message.content);
  } catch {
    return { topics: ["uncategorized"], type: "observation" };
  }
}

async function replyInTelegram(
  chatId: string,
  replyToMessageId: number,
  text: string
): Promise<void> {
  await fetch(
    `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        reply_to_message_id: replyToMessageId,
        text,
        allow_sending_without_reply: true,
      }),
    }
  );
}

Deno.serve(async (req: Request): Promise<Response> => {
  try {
    if (req.method !== "POST") {
      return new Response(JSON.stringify({ error: "Method not allowed" }), {
        status: 405,
        headers: { "Content-Type": "application/json" },
      });
    }

    const body = await req.json();

    // Telegram sends message or channel_post
    const message = body.message ?? body.channel_post;
    if (!message) {
      return new Response("ok", { status: 200 });
    }

    const text: string = (message.text ?? message.caption ?? "").trim();
    const chatId: string = String(message.chat?.id ?? "");
    const messageId: number = message.message_id;

    // Security: only accept messages from your personal chat
    if (chatId !== TELEGRAM_CAPTURE_CHAT_ID) {
      return new Response("ok", { status: 200 });
    }

    // Skip empty messages
    if (!text) {
      return new Response("ok", { status: 200 });
    }

    // Embed and extract metadata in parallel
    const [embedding, metadata] = await Promise.all([
      getEmbedding(text),
      extractMetadata(text),
    ]);

    // Store in Supabase
    const { error } = await supabase.from("thoughts").insert({
      content: text,
      embedding,
      metadata: {
        ...metadata,
        source: "telegram",
        telegram_chat_id: chatId,
        telegram_message_id: messageId,
      },
    });

    if (error) {
      console.error("Supabase insert error:", error);
      await replyInTelegram(
        chatId,
        messageId,
        `Failed to capture: ${error.message}`
      );
      return new Response("error", { status: 500 });
    }

    // Send confirmation reply
    const meta = metadata as Record<string, unknown>;
    let confirmation = `Captured as *${meta.type || "thought"}*`;
    if (Array.isArray(meta.topics) && meta.topics.length > 0)
      confirmation += ` — ${meta.topics.join(", ")}`;
    if (Array.isArray(meta.people) && meta.people.length > 0)
      confirmation += `\nPeople: ${meta.people.join(", ")}`;
    if (Array.isArray(meta.action_items) && meta.action_items.length > 0)
      confirmation += `\nAction items: ${meta.action_items.join("; ")}`;

    await replyInTelegram(chatId, messageId, confirmation);
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
supabase secrets set TELEGRAM_BOT_TOKEN=your-telegram-bot-token-here
supabase secrets set TELEGRAM_CAPTURE_CHAT_ID=your-chat-id-here
```

Replace the values with:
- Your OpenRouter API key from the main guide (Step 4)
- Your Telegram Bot Token from Step 1 above
- Your Chat ID from Step 2 above

> SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are automatically available inside Edge Functions — you don't need to set them.

### Deploy

```bash
supabase functions deploy ingest-thought --no-verify-jwt
```

> Copy the Edge Function URL immediately after deployment! It looks like: `https://YOUR_PROJECT_REF.supabase.co/functions/v1/ingest-thought`

Save this URL — you'll need it in Step 4.

---

## Step 4: Set the Webhook

This tells Telegram where to send messages. Run this command (replace both placeholders):

```bash
curl "https://api.telegram.org/botYOUR_BOT_TOKEN/setWebhook?url=https://YOUR_PROJECT_REF.supabase.co/functions/v1/ingest-thought"
```

You should see `{"ok":true,"result":true,"description":"Webhook was set"}`.

> **Unlike Slack, Telegram uses a simple URL webhook — no event subscription UI needed.** One curl command and you're done.

---

## Step 5: Test It

Open Telegram and send a message to your bot:

```text
Sarah mentioned she's thinking about leaving her job to start a consulting business
```

Wait 5–10 seconds. You should see a reply:

```text
Captured as person_note — career, consulting
People: Sarah
Action items: Check in with Sarah about consulting plans
```

Then open Supabase dashboard → Table Editor → thoughts. You should see one row with your message, an embedding, and metadata.

---

## Expected Outcome

Every message you send to your Telegram bot automatically gets:
- Embedded with a 1536-dimensional vector for semantic search
- Classified by type (observation, task, idea, reference, person_note)
- Tagged with topics, people, action items, and dates (where applicable)
- Stored in your Supabase `thoughts` table
- Confirmed with a reply message showing the extracted metadata

You can now search for these thoughts using any MCP-connected AI (Claude Desktop, ChatGPT, Claude Code, Cursor) via the Open Brain MCP server from the main guide.

---

## Troubleshooting

### Webhook not working

Verify the webhook is set correctly:

```bash
curl "https://api.telegram.org/botYOUR_BOT_TOKEN/getWebhookInfo"
```

Check the `url` field matches your Edge Function URL and `last_error_message` is empty. If there's an error, redeploy the function and set the webhook again.

### Messages aren't triggering the function

Make sure the Chat ID in your secrets matches the actual chat. The function silently ignores messages from other chats for security. Verify with:

```bash
supabase secrets list
```

### Bot replies "Failed to capture"

Check Edge Function logs for the actual error:

```bash
supabase functions logs ingest-thought
```

Most likely the OpenRouter API key is wrong or has no credits.

### No reply from the bot, but thought appears in database

The Telegram Bot Token might have been set incorrectly, or there's a network issue between Supabase and Telegram's API. Check the Edge Function logs. The thought was captured successfully — the reply is just a convenience.

### Metadata extraction seems off

That's normal — the LLM is making its best guess with limited context. The metadata is a convenience layer on top of semantic search, not the primary retrieval mechanism. The embedding handles fuzzy matching regardless.

### Voice messages

Telegram's built-in voice-to-text transcription works before your message hits the Edge Function. If you send a voice message *with transcription enabled in Telegram settings*, the transcribed text gets captured as a thought. Without transcription, the bot receives no text and silently skips it.

---

## What You Just Built

You now have a Telegram bot that acts as a direct write path into your Open Brain. Type anything — meeting notes, random ideas, observations, reminders — and it's automatically embedded, classified, and searchable from any AI tool connected to your MCP server.

The key advantage over the [Slack integration](../slack-capture/) is **mobile-first capture**. Telegram is lightweight, works with spotty connections, and supports voice-to-text — making it ideal for capturing thoughts on the go.

Your Open Brain MCP server also includes a `capture_thought` tool, which means any MCP-connected AI (Claude Desktop, ChatGPT, Claude Code, Cursor) can write directly to your brain without switching apps. Telegram is just the mobile inbox.

---

*Built by Alan Shurafa — part of the [Open Brain project](https://github.com/NateBJones-Projects/OB1)*
