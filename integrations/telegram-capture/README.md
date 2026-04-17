# Telegram Capture

> **Add Telegram as a quick-capture interface for your Open Brain.** Send a message to your bot (DM or a private group) and it's automatically embedded, classified, and stored, with a threaded confirmation back in the chat.

---

## What It Does

Runs a Supabase Edge Function as a Telegram bot webhook. Every text message sent to the configured chat becomes a `thoughts` row with an embedding (`openai/text-embedding-3-small`) and LLM-extracted metadata (people, topics, action items, dates, type). The bot replies in-thread with a confirmation so you know capture succeeded. Optional `UPDATE_ON_EDIT` support re-embeds edited messages in place.

---

## Prerequisites

- A working Open Brain setup (Supabase project with the `thoughts` table and pgvector)
- A Telegram account (the bot is free)
- An [OpenRouter](https://openrouter.ai) API key
- Supabase CLI installed and logged in
- Shell access with `curl` and `openssl`

**Cost**: Telegram is free. OpenRouter embedding + classification is the same as slack-capture, roughly **$0.10–0.30/month** for 20 captures per day.

---

## Credential Tracker

Fill these in as you go, you'll need all of them in Step 4:

| Credential | Where it comes from | Value |
|---|---|---|
| `TELEGRAM_BOT_TOKEN` | BotFather (Step 1) | |
| `TELEGRAM_CAPTURE_CHAT_ID` | `getUpdates` (Step 2) | |
| `TELEGRAM_WEBHOOK_SECRET` | Invent one in Step 4 | |
| `OPENROUTER_API_KEY` | [openrouter.ai/keys](https://openrouter.ai/keys) | |
| `SUPABASE_URL` | Auto-injected by Supabase | (skip) |
| `SUPABASE_SERVICE_ROLE_KEY` | Auto-injected by Supabase | (skip) |

---

## Steps

### Step 1 — Create a Telegram bot via BotFather

1. Open Telegram and start a chat with [@BotFather](https://t.me/BotFather).
2. Send `/newbot`.
3. Pick a display name, then a username. The username must end in `bot` (e.g. `my_open_brain_bot`).
4. BotFather replies with a token shaped like `123456789:ABCdefGhIJKlmnoPQRstUVwxYZ`.
5. Copy the token into your tracker as `TELEGRAM_BOT_TOKEN`.

> [!WARNING]
> The bot token is a credential. Don't paste it into chats, commits, or screenshots.

✅ **Done when:** You have a bot token and can open your bot's profile in Telegram.

---

### Step 2 — Find your capture `chat_id`

You need the numeric ID of the chat where captures will live. Pick one option below.

> [!WARNING]
> **`chat_id` is not your bot's ID.** If you looked up your bot with @IDBot or @userinfobot *from inside the bot's chat*, that returns the bot's user ID, which is the wrong number. In a DM with your bot, `chat_id` equals **your own** user ID (the human on the other side). For groups, it's the group's ID, a negative number.

**Option A — DM yourself (fastest, recommended)**

1. From your personal Telegram account (not via your bot), start a chat with [@userinfobot](https://t.me/userinfobot) and send any message.
2. @userinfobot replies with your user ID, a positive integer like `987654321`.
3. That number is your `TELEGRAM_CAPTURE_CHAT_ID`. Messages you DM to your bot will come in under this chat ID.

**Option B — Use `getUpdates` (works for DMs or groups)**

1. Open the chat where you want captures to happen (a DM with your bot, or a group the bot's in).
2. Send any message in that chat.
3. In a browser, visit (replace `YOUR_BOT_TOKEN` with your real token, no angle brackets):
   ```
   https://api.telegram.org/botYOUR_BOT_TOKEN/getUpdates
   ```
4. Find the first `"chat": { "id": ... }` block in the JSON. That number is your `TELEGRAM_CAPTURE_CHAT_ID`.
   - DM: positive integer, e.g. `987654321`
   - Group/supergroup: negative integer, e.g. `-1001234567890`

**Option C — Private group setup (if using a group)**

1. Create a Telegram group and add your bot as a member.
2. Disable Privacy Mode so the bot sees all messages, not only ones that @-mention it: message BotFather → `/mybots` → pick your bot → `Bot Settings` → `Group Privacy` → `Turn off`. Remove and re-add the bot afterward for the change to take effect.
3. Use Option B to read the group's `chat_id` from `getUpdates`.

> [!NOTE]
> Supergroup IDs start with `-100`. Keep the minus sign and the `100` — they're part of the value, not a formatting artifact.

✅ **Done when:** You have a numeric chat ID (positive for DM, negative for group) that is *not* the same as your bot's user ID.

---

### Step 3 — Drop the function into your Supabase project

From the root of your Supabase project:

```bash
mkdir -p supabase/functions/telegram-capture
```

Create `supabase/functions/telegram-capture/index.ts` with the contents below:

```typescript
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const OPENROUTER_API_KEY = Deno.env.get("OPENROUTER_API_KEY")!;
const TELEGRAM_BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN")!;
const TELEGRAM_CAPTURE_CHAT_ID = Deno.env.get("TELEGRAM_CAPTURE_CHAT_ID")!;
const TELEGRAM_WEBHOOK_SECRET = Deno.env.get("TELEGRAM_WEBHOOK_SECRET");
const UPDATE_ON_EDIT = Deno.env.get("UPDATE_ON_EDIT") === "true";

const OPENROUTER_BASE = "https://openrouter.ai/api/v1";
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

async function getEmbedding(text: string): Promise<number[]> {
  const r = await fetch(`${OPENROUTER_BASE}/embeddings`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${OPENROUTER_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ model: "openai/text-embedding-3-small", input: text }),
  });
  const d = await r.json();
  return d.data[0].embedding;
}

async function extractMetadata(text: string): Promise<Record<string, unknown>> {
  const r = await fetch(`${OPENROUTER_BASE}/chat/completions`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${OPENROUTER_API_KEY}`,
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
  try { return JSON.parse(d.choices[0].message.content); }
  catch { return { topics: ["uncategorized"], type: "observation" }; }
}

async function replyInTelegram(chatId: number, replyToMessageId: number, text: string): Promise<void> {
  await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      reply_to_message_id: replyToMessageId,
      text,
      parse_mode: "Markdown",
    }),
  });
}

function buildConfirmation(metadata: Record<string, unknown>, prefix: string): string {
  let line = `${prefix} *${metadata.type || "thought"}*`;
  if (Array.isArray(metadata.topics) && metadata.topics.length > 0)
    line += ` - ${metadata.topics.join(", ")}`;
  if (Array.isArray(metadata.people) && metadata.people.length > 0)
    line += `\nPeople: ${metadata.people.join(", ")}`;
  if (Array.isArray(metadata.action_items) && metadata.action_items.length > 0)
    line += `\nAction items: ${metadata.action_items.join("; ")}`;
  return line;
}

Deno.serve(async (req: Request): Promise<Response> => {
  try {
    // Verify the secret token Telegram echoes in this header. Prevents random
    // internet traffic from hitting the endpoint if anyone discovers the URL.
    if (TELEGRAM_WEBHOOK_SECRET) {
      const secret = req.headers.get("X-Telegram-Bot-Api-Secret-Token");
      if (secret !== TELEGRAM_WEBHOOK_SECRET) {
        return new Response("unauthorized", { status: 401 });
      }
    }

    const body = await req.json();
    const message = body.message ?? body.edited_message;
    const isEdit = !!body.edited_message;

    // Ignore edits/bots/non-text, and anything outside the configured chat.
    if (!message
        || message.from?.is_bot
        || !message.text
        || String(message.chat.id) !== TELEGRAM_CAPTURE_CHAT_ID) {
      return new Response("ok", { status: 200 });
    }

    const messageText: string = message.text;
    const chatId: number = message.chat.id;
    const messageId: number = message.message_id;

    if (messageText.trim() === "") return new Response("ok", { status: 200 });

    // Dedupe by (chat_id, message_id). Telegram retries aggressively on slow responses.
    const { data: existing } = await supabase
      .from("thoughts")
      .select("id")
      .contains("metadata", { telegram_chat_id: chatId, telegram_message_id: messageId })
      .limit(1);

    if (existing && existing.length > 0) {
      if (isEdit && UPDATE_ON_EDIT) {
        const [embedding, metadata] = await Promise.all([
          getEmbedding(messageText),
          extractMetadata(messageText),
        ]);
        const { error } = await supabase
          .from("thoughts")
          .update({
            content: messageText,
            embedding,
            metadata: {
              ...metadata,
              source: "telegram",
              telegram_chat_id: chatId,
              telegram_message_id: messageId,
              edited: true,
            },
          })
          .eq("id", existing[0].id);

        if (error) {
          console.error("Supabase update error:", error);
          await replyInTelegram(chatId, messageId, `Failed to update: ${error.message}`);
          return new Response("error", { status: 500 });
        }
        await replyInTelegram(chatId, messageId, buildConfirmation(metadata, "Updated as"));
      }
      // Retry duplicate, or edit with UPDATE_ON_EDIT off. Ack and move on.
      return new Response("ok", { status: 200 });
    }

    // Edit for a message we never captured (e.g. edited before first delivery). Skip.
    if (isEdit) return new Response("ok", { status: 200 });

    const [embedding, metadata] = await Promise.all([
      getEmbedding(messageText),
      extractMetadata(messageText),
    ]);

    const { error } = await supabase.from("thoughts").insert({
      content: messageText,
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
      await replyInTelegram(chatId, messageId, `Failed to capture: ${error.message}`);
      return new Response("error", { status: 500 });
    }

    await replyInTelegram(chatId, messageId, buildConfirmation(metadata, "Captured as"));
    return new Response("ok", { status: 200 });
  } catch (err) {
    console.error("Function error:", err);
    return new Response("error", { status: 500 });
  }
});
```

✅ **Done when:** The file exists at `supabase/functions/telegram-capture/index.ts` and saves without TypeScript errors in your editor.

---

### Step 4 — Set environment variables

**4a. Generate your webhook secret and write it down**

Run this to produce a random 64-character hex string:

```bash
openssl rand -hex 32
```

Copy the output into your credential tracker under `TELEGRAM_WEBHOOK_SECRET`. You will paste this exact value twice: once into Supabase here in Step 4b, and once into the `setWebhook` call in Step 6. They must match byte-for-byte.

> [!WARNING]
> **Do not use `$(openssl rand -hex 32)` inline inside the `supabase secrets set` command.** The shell will generate a value, pass it to Supabase, and throw it away — you'll never know what it was, and you'll have no way to tell Telegram what value to match. Always generate first, save the output, then paste it as a literal string.

**4b. Push all four secrets to Supabase**

Replace each placeholder with your real value (no angle brackets):

```bash
supabase secrets set \
  TELEGRAM_BOT_TOKEN="123456789:ABCdefGhIJKlmnoPQRstUVwxYZ" \
  TELEGRAM_CAPTURE_CHAT_ID="987654321" \
  TELEGRAM_WEBHOOK_SECRET="paste_the_hex_string_from_4a_here" \
  OPENROUTER_API_KEY="sk-or-v1-your-openrouter-key"
```

`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are injected automatically by the Supabase runtime, so you don't set those yourself.

> [!TIP]
> `TELEGRAM_WEBHOOK_SECRET` isn't something Telegram gives you — it's a value *you* invent and share between Supabase and Telegram. Telegram echoes it back in the `X-Telegram-Bot-Api-Secret-Token` header on every call, and the function rejects anything that doesn't match. That's how the function knows the request came from Telegram.

**4c. (Optional) Enable edit handling**

```bash
supabase secrets set UPDATE_ON_EDIT=true
```

When set, editing a captured Telegram message re-runs embedding and metadata extraction and updates the row in place rather than creating a duplicate.

✅ **Done when:** `supabase secrets list` shows all four required keys *and* you still have the hex value from 4a saved somewhere you can copy from.

---

### Step 5 — Deploy the edge function

```bash
supabase functions deploy telegram-capture --no-verify-jwt
```

> [!IMPORTANT]
> `--no-verify-jwt` is required. Telegram won't send a Supabase JWT with its webhook calls. Authentication is handled inside the function by the secret-token check from Step 4, so you're not actually dropping auth, just moving it.

Your function URL will look like:
```
https://YOUR_PROJECT_REF.supabase.co/functions/v1/telegram-capture
```

(where `YOUR_PROJECT_REF` is the subdomain of your actual Supabase project). Keep the full URL handy for Step 6.

✅ **Done when:** `supabase functions deploy` prints a success URL.

---

### Step 6 — Register the webhook with Telegram

**6a. Sanity-check your bot token**

Before the full registration, confirm the token itself works:

```bash
curl "https://api.telegram.org/botYOUR_BOT_TOKEN/getMe"
```

Replace `YOUR_BOT_TOKEN` with your real token (no angle brackets, no spaces). A working response looks like:

```json
{"ok":true,"result":{"id":123456789,"is_bot":true,"first_name":"YourBot","username":"your_bot"}}
```

If you get `{"ok":false,"error_code":404,"description":"Not Found"}`, the token is wrong, truncated, or still has placeholder characters in it. Fix that before moving on.

**6b. Call `setWebhook`**

Run this **on one line** (don't reformat with backslashes — those can break depending on your shell):

```bash
curl -X POST "https://api.telegram.org/botYOUR_BOT_TOKEN/setWebhook" -H "Content-Type: application/json" -d '{"url":"https://YOUR_PROJECT_REF.supabase.co/functions/v1/telegram-capture","secret_token":"YOUR_WEBHOOK_SECRET","allowed_updates":["message","edited_message"]}'
```

> [!IMPORTANT]
> **Three things to replace, everything else stays:**
> - `YOUR_BOT_TOKEN` → your real bot token from BotFather (the whole `123456789:ABC...` string)
> - `YOUR_PROJECT_REF` → the subdomain of your Supabase function URL. If your function lives at `https://abcdefg.supabase.co/functions/v1/telegram-capture`, then `abcdefg` is your project ref.
> - `YOUR_WEBHOOK_SECRET` → the hex value you generated in Step 4a and stored as `TELEGRAM_WEBHOOK_SECRET`. Must match exactly.
>
> The field names (`url`, `secret_token`, `allowed_updates`) are what Telegram's API looks for — leave those as written. Only change the *values* between the quotes.

Expected response:

```json
{"ok":true,"result":true,"description":"Webhook was set"}
```

**6c. Verify the webhook registered cleanly**

```bash
curl "https://api.telegram.org/botYOUR_BOT_TOKEN/getWebhookInfo"
```

Check the JSON response:

- `url` should show your full Supabase function URL
- `pending_update_count` should be `0`
- `last_error_message` field should be absent (if it's present, the webhook has been failing — read the message)

**Common errors and what they mean:**

| Response | Likely cause |
|---|---|
| `{"ok":false,"error_code":404,"description":"Not Found"}` | Bot token in the URL is wrong, truncated, or still has `<YOUR_TOKEN>`-style placeholder. |
| `curl: (3) URL rejected: Malformed input to a URL function` | URL contains angle brackets (`<...>`), a newline from a multi-line paste, or smart quotes (`"` vs `"`). |
| `{"ok":false,"error_code":400,"description":"Bad Request: bad webhook: ..."}` | `url` value in the JSON body is malformed or unreachable. Check your project ref. |
| `last_error_message: "Wrong response from the webhook: 401 Unauthorized"` | `secret_token` you sent here doesn't match `TELEGRAM_WEBHOOK_SECRET` on Supabase. |

✅ **Done when:** `getWebhookInfo` returns your URL with `pending_update_count: 0` and no `last_error_message`.

---

### Step 7 — Send a test message

Open the chat (DM or group) and send:

```
Remind me to follow up with Sam about the pricing draft by Friday
```

Within a couple seconds the bot should reply in-thread with something like:

```
Captured as *task* - followups, pricing
People: Sam
Action items: follow up with Sam about pricing draft
```

Then confirm in Supabase:

```sql
select id, content, metadata->>'type' as type, metadata->'topics' as topics
from thoughts
where metadata->>'source' = 'telegram'
order by created_at desc
limit 5;
```

✅ **Done when:** A new row appears with your message text, a populated embedding, and `metadata.source = 'telegram'`.

---

## Expected Outcome

Text messages sent to your configured chat are embedded, classified, and stored as `thoughts` rows, typically within two seconds. Each captured message gets a threaded confirmation listing its inferred type, topics, people, and action items. Duplicate webhook deliveries are silently deduped by `(telegram_chat_id, telegram_message_id)`. When `UPDATE_ON_EDIT=true`, editing a Telegram message updates the existing row in place. Non-text updates (stickers, photos without captions, join events, bot messages) are silently ignored.

---

## Troubleshooting

**Webhook returns 401 "unauthorized"**
The `secret_token` you passed to `setWebhook` doesn't match the `TELEGRAM_WEBHOOK_SECRET` environment variable. Re-run `setWebhook` with the correct value, or reset the secret via `supabase secrets set` and redeploy.

**No capture, no error, messages are just ignored**
Run `curl "https://api.telegram.org/botYOUR_BOT_TOKEN/getWebhookInfo"` (replace with your actual token, no angle brackets). If `pending_update_count` is climbing or `last_error_message` is populated, the function is erroring. Check logs with `supabase functions logs telegram-capture`. If the function is invoked but returns `200` without inserting, confirm `String(message.chat.id) === TELEGRAM_CAPTURE_CHAT_ID`. A common mistake is storing `1234567890` when the real group ID is `-1001234567890` (the minus sign and `100` prefix matter).

**Bot can't see messages in a group**
Non-admin bots only see messages that @-mention them. Either promote the bot to admin, or disable Privacy Mode via BotFather → `/mybots` → your bot → `Bot Settings` → `Group Privacy` → `Turn off`. After toggling, remove and re-add the bot for the change to take effect.

**Duplicate rows on every message**
Look at `metadata->>'telegram_message_id'` on the duplicates. If they're the same, the dedup query isn't matching, verify that `thoughts.metadata` is JSONB and that the `contains` filter works against it. If the IDs are different, something upstream is replaying messages, which is not Telegram's usual behavior.

**OpenRouter returns 401 or 429**
Grep `supabase functions logs telegram-capture` for those status codes. Regenerate the key or wait out the window. The function returns `500` to Telegram on OpenRouter failures, and Telegram will retry for up to 24 hours.

---

## Tool Surface Area

This integration **does not register any new MCP tools**. It is a capture-only ingestion path: an inbound webhook that writes to the existing `thoughts` table via a Supabase Edge Function.

| Component | Type | What it does |
|---|---|---|
| `telegram-capture` Edge Function | Supabase webhook (not an MCP server) | Receives `message` and `edited_message` updates from Telegram, embeds the text via OpenRouter, extracts metadata, and inserts/updates a row in `thoughts`. |
| `thoughts` table | Existing Open Brain primitive | No schema changes. Rows written here are consumed by whatever MCP tools (search, retrieval, summarization) you've already installed. |

**External services called:** `api.telegram.org` (webhook callback + send confirmation) and `openrouter.ai/api/v1` (embedding + classification). Both are outbound HTTPS; neither requires opening inbound ports beyond the Supabase function URL itself.

**Auditing:** Because this integration adds no MCP tools, there's no MCP tool surface to audit for it directly. If you're installing this alongside MCP servers that read from the `thoughts` table (such as thought-search tools), audit those servers per the [MCP Tool Audit & Optimization Guide](../../docs/05-tool-audit.md).

---

## Related

- [Slack Capture](../slack-capture/) — same pattern for Slack
- [Discord Capture](../discord-capture/) — same pattern for Discord
- [MCP Tool Audit & Optimization Guide](../../docs/05-tool-audit.md) — recommended reading for any integration contributor
- [Contributing guide](../../CONTRIBUTING.md) — required reading before submitting changes
