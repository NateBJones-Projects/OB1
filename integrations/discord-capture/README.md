# Discord Capture

> **Add Discord as a quick-capture interface for your Open Brain.** Type `/capture` in any channel, or right-click an existing message and choose "Capture to Open Brain" — either way it's embedded, classified, and stored, with an ephemeral confirmation back in Discord.

---

## What It Does

Runs a Supabase Edge Function as a Discord **Interactions** endpoint. Two capture paths, both handled by the same function:

1. **`/capture <text>` slash command** — type a new thought directly into any channel the bot can see.
2. **"Capture to Open Brain" message command** — right-click (desktop) or long-press (mobile) any existing message → **Apps** → captures that message's content as-is.

Both become a `thoughts` row with an embedding (`openai/text-embedding-3-small`) and LLM-extracted metadata (people, topics, action items, dates, type), plus Discord-specific metadata (guild, channel, author, message/interaction id). The bot replies with an ephemeral confirmation (visible only to you) so you know capture succeeded.

> [!NOTE]
> **This is not passive channel monitoring like Slack Capture.** Discord's Interactions webhook only fires for commands — it never delivers ordinary channel messages to an HTTP endpoint. Reading every message as it's posted requires a persistent Gateway (WebSocket) connection, which a stateless Supabase Edge Function cannot hold open. The slash command + message command combo above is the pattern that actually fits this architecture, and it's also lower-noise: nothing gets captured unless you deliberately trigger it.

---

## Prerequisites

- A working Open Brain setup (Supabase project with the `thoughts` table and pgvector)
- A Discord account with **Manage Server** permission on the server you'll install this to
- Discord Developer Portal access (free)
- An [OpenRouter](https://openrouter.ai) API key
- Supabase CLI installed and logged in
- Shell access with `curl`

**Cost**: Discord is free. OpenRouter embedding + classification is the same as slack-capture and telegram-capture, roughly **$0.10–0.30/month** for 20 captures per day.

---

## Credential Tracker

Fill these in as you go, you'll need all of them by Step 5:

| Credential | Where it comes from | Value |
|---|---|---|
| `DISCORD_PUBLIC_KEY` | Developer Portal → General Information (Step 1) | |
| `DISCORD_APPLICATION_ID` | Developer Portal → General Information (Step 1) | |
| `DISCORD_BOT_TOKEN` | Developer Portal → Bot tab (Step 1) | |
| Server (guild) ID | Right-click server icon in Discord (Step 7) | |
| `OPENROUTER_API_KEY` | [openrouter.ai/keys](https://openrouter.ai/keys) | |
| `SUPABASE_URL` | Auto-injected by Supabase | (skip) |
| `SUPABASE_SERVICE_ROLE_KEY` | Auto-injected by Supabase | (skip) |

---

## Steps

### Step 1 — Create the Discord application

1. Go to [discord.com/developers/applications](https://discord.com/developers/applications) → **New Application**.
2. Name it "Open Brain" (or anything you like) → **Create**.
3. On the **General Information** page, copy **Application ID** and **Public Key** into your tracker.
4. Left sidebar → **Bot** → **Reset Token** (or **Add Bot** if prompted) → copy the token into your tracker as `DISCORD_BOT_TOKEN`.

> [!WARNING]
> The bot token is a credential. Don't paste it into chats, commits, or screenshots. The public key is not secret — it's used to *verify* requests came from Discord, not to authenticate as you.

✅ **Done when:** You have `DISCORD_PUBLIC_KEY`, `DISCORD_APPLICATION_ID`, and `DISCORD_BOT_TOKEN` saved in your tracker.

---

### Step 2 — Invite the app to your server

1. Left sidebar → **OAuth2** → **URL Generator**.
2. Under **Scopes**, check `applications.commands` and `bot`.
3. Under **Bot Permissions**, leave everything unchecked — no bot permissions are required. Interaction replies are authenticated by the interaction token, not by bot permissions.
4. Copy the generated URL at the bottom, open it in your browser, pick your server, and **Authorize**.

✅ **Done when:** The app shows up in your server's member/integrations list.

---

### Step 3 — Drop the function into your Supabase project

From the root of your Supabase project:

```bash
mkdir -p supabase/functions/discord-capture
```

Create `supabase/functions/discord-capture/index.ts` with the contents below:

```typescript
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import nacl from "https://esm.sh/tweetnacl@1.0.3";

// Supabase Edge Runtime global for background work after a response is sent.
// Not something you import — it's injected at runtime. Declared here only so
// your editor's TypeScript checker doesn't flag it as undefined.
declare const EdgeRuntime: { waitUntil(promise: Promise<unknown>): void };

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const OPENROUTER_API_KEY = Deno.env.get("OPENROUTER_API_KEY")!;
const DISCORD_PUBLIC_KEY = Deno.env.get("DISCORD_PUBLIC_KEY")!;
const DISCORD_APPLICATION_ID = Deno.env.get("DISCORD_APPLICATION_ID")!;

const OPENROUTER_BASE = "https://openrouter.ai/api/v1";
const DISCORD_API = "https://discord.com/api/v10";
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
  return bytes;
}

async function verifyDiscordRequest(rawBody: string, signature: string | null, timestamp: string | null): Promise<boolean> {
  if (!signature || !timestamp) return false;
  try {
    const message = new TextEncoder().encode(timestamp + rawBody);
    return nacl.sign.detached.verify(message, hexToBytes(signature), hexToBytes(DISCORD_PUBLIC_KEY));
  } catch {
    return false;
  }
}

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
        { role: "system", content: `Extract metadata from the user's captured thought. Return JSON with:
- "people": array of people mentioned (empty if none)
- "action_items": array of implied to-dos (empty if none)
- "dates_mentioned": array of dates YYYY-MM-DD (empty if none)
- "topics": array of 1-3 short topic tags (always at least one)
- "type": one of "observation", "task", "idea", "reference", "person_note"
Only extract what's explicitly there.` },
        { role: "user", content: text },
      ],
    }),
  });
  const d = await r.json();
  try { return JSON.parse(d.choices[0].message.content); }
  catch { return { topics: ["uncategorized"], type: "observation" }; }
}

function buildConfirmation(metadata: Record<string, unknown>): string {
  let line = `Captured as *${metadata.type || "thought"}*`;
  if (Array.isArray(metadata.topics) && metadata.topics.length > 0)
    line += ` - ${metadata.topics.join(", ")}`;
  if (Array.isArray(metadata.people) && metadata.people.length > 0)
    line += `\nPeople: ${metadata.people.join(", ")}`;
  if (Array.isArray(metadata.action_items) && metadata.action_items.length > 0)
    line += `\nAction items: ${metadata.action_items.join("; ")}`;
  return line;
}

// Discord gives you 3 seconds to ACK an interaction. Embedding + metadata
// extraction routinely takes longer, so we defer immediately and patch the
// real content in afterward via the follow-up webhook.
async function sendFollowup(interactionToken: string, content: string): Promise<void> {
  await fetch(`${DISCORD_API}/webhooks/${DISCORD_APPLICATION_ID}/${interactionToken}/messages/@original`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content }),
  });
}

async function processCapture(params: {
  text: string;
  dedupeKey: string | null;
  metadataExtra: Record<string, unknown>;
  interactionToken: string;
}): Promise<void> {
  const { text, dedupeKey, metadataExtra, interactionToken } = params;
  try {
    if (dedupeKey) {
      const { data: existing } = await supabase
        .from("thoughts")
        .select("id")
        .contains("metadata", { discord_message_id: dedupeKey })
        .limit(1);
      if (existing && existing.length > 0) {
        await sendFollowup(interactionToken, "Already captured this message.");
        return;
      }
    }

    const [embedding, metadata] = await Promise.all([getEmbedding(text), extractMetadata(text)]);

    const { error } = await supabase.from("thoughts").insert({
      content: text,
      embedding,
      metadata: { ...metadata, source: "discord", ...metadataExtra },
    });

    if (error) {
      console.error("Supabase insert error:", error);
      await sendFollowup(interactionToken, `Failed to capture: ${error.message}`);
      return;
    }

    await sendFollowup(interactionToken, buildConfirmation(metadata));
  } catch (err) {
    console.error("processCapture error:", err);
    await sendFollowup(interactionToken, "Failed to capture: unexpected error, check function logs.");
  }
}

Deno.serve(async (req: Request): Promise<Response> => {
  const rawBody = await req.text();
  const signature = req.headers.get("X-Signature-Ed25519");
  const timestamp = req.headers.get("X-Signature-Timestamp");

  if (!(await verifyDiscordRequest(rawBody, signature, timestamp))) {
    return new Response("invalid request signature", { status: 401 });
  }

  const interaction = JSON.parse(rawBody);

  // Discord's handshake check when you save the Interactions Endpoint URL.
  if (interaction.type === 1) {
    return new Response(JSON.stringify({ type: 1 }), { headers: { "Content-Type": "application/json" } });
  }

  if (interaction.type === 2) {
    const user = interaction.member?.user ?? interaction.user;
    const commonMeta = {
      guild_id: interaction.guild_id ?? null,
      channel_id: interaction.channel_id ?? interaction.channel?.id ?? null,
      author: user?.username ?? "unknown",
      discord_interaction_id: interaction.id,
    };

    // Chat input command: /capture text:<...>
    if (interaction.data.type === 1 && interaction.data.name === "capture") {
      const text = interaction.data.options?.find((o: { name: string }) => o.name === "text")?.value;
      if (!text || String(text).trim() === "") {
        return new Response(JSON.stringify({
          type: 4,
          data: { content: "Nothing to capture — pass some text.", flags: 64 },
        }), { headers: { "Content-Type": "application/json" } });
      }

      EdgeRuntime.waitUntil(processCapture({
        text,
        dedupeKey: null,
        metadataExtra: commonMeta,
        interactionToken: interaction.token,
      }));

      return new Response(JSON.stringify({ type: 5, data: { flags: 64 } }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    // Message context menu command: right-click a message -> Apps -> Capture to Open Brain
    if (interaction.data.type === 3 && interaction.data.name === "Capture to Open Brain") {
      const targetId = interaction.data.target_id;
      const targetMessage = interaction.data.resolved?.messages?.[targetId];
      const text = targetMessage?.content;

      if (!text || text.trim() === "") {
        return new Response(JSON.stringify({
          type: 4,
          data: { content: "That message has no text content to capture.", flags: 64 },
        }), { headers: { "Content-Type": "application/json" } });
      }

      EdgeRuntime.waitUntil(processCapture({
        text,
        dedupeKey: targetId,
        metadataExtra: { ...commonMeta, discord_message_id: targetId, author: targetMessage.author?.username ?? commonMeta.author },
        interactionToken: interaction.token,
      }));

      return new Response(JSON.stringify({ type: 5, data: { flags: 64 } }), {
        headers: { "Content-Type": "application/json" },
      });
    }
  }

  return new Response(JSON.stringify({ type: 4, data: { content: "Unknown interaction.", flags: 64 } }), {
    headers: { "Content-Type": "application/json" },
  });
});
```

✅ **Done when:** The file exists at `supabase/functions/discord-capture/index.ts` and saves without TypeScript errors in your editor.

---

### Step 4 — Set your secrets

```bash
supabase secrets set \
  DISCORD_PUBLIC_KEY="your-public-key-from-step-1" \
  DISCORD_APPLICATION_ID="your-application-id-from-step-1" \
  OPENROUTER_API_KEY="sk-or-v1-your-openrouter-key"
```

> `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are injected automatically by the Supabase runtime — you don't set those yourself. `DISCORD_BOT_TOKEN` isn't used by the function itself (interaction replies use the interaction token, not the bot token); you only need it in Step 7 to register commands.

✅ **Done when:** `supabase secrets list` shows `DISCORD_PUBLIC_KEY`, `DISCORD_APPLICATION_ID`, and `OPENROUTER_API_KEY`.

---

### Step 5 — Deploy the edge function

```bash
supabase functions deploy discord-capture --no-verify-jwt
```

> [!IMPORTANT]
> `--no-verify-jwt` is required. Discord won't send a Supabase JWT with its interaction calls. Authentication is handled inside the function by the Ed25519 signature check from Step 3 — you're not dropping auth, just moving it to where Discord actually puts it.

Your function URL will look like:

```
https://YOUR_PROJECT_REF.supabase.co/functions/v1/discord-capture
```

Keep it handy for Step 6.

✅ **Done when:** `supabase functions deploy` prints a success URL.

---

### Step 6 — Set the Interactions Endpoint URL

1. Developer Portal → your application → **General Information**.
2. Paste your function URL from Step 5 into **Interactions Endpoint URL**.
3. Click **Save Changes**.

Discord immediately sends a test `PING` to that URL and expects a signed `PONG` back before it will save. If your function isn't deployed yet, or `DISCORD_PUBLIC_KEY` doesn't match exactly, Discord will refuse to save and show a red error banner.

✅ **Done when:** Discord saves the URL with no error banner.

---

### Step 7 — Register the commands

You need your **Server (guild) ID** for this step: in Discord, enable Developer Mode (User Settings → Advanced → Developer Mode), then right-click your server icon → **Copy Server ID**.

Registering commands scoped to one guild makes them available instantly — global commands can take up to an hour to propagate, so use guild-scoped commands while testing.

**Register the slash command:**

```bash
curl -X POST "https://discord.com/api/v10/applications/YOUR_APPLICATION_ID/guilds/YOUR_GUILD_ID/commands" \
  -H "Authorization: Bot YOUR_BOT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"capture","description":"Capture a thought into Open Brain","type":1,"options":[{"name":"text","description":"What do you want to capture?","type":3,"required":true}]}'
```

**Register the message context menu command:**

```bash
curl -X POST "https://discord.com/api/v10/applications/YOUR_APPLICATION_ID/guilds/YOUR_GUILD_ID/commands" \
  -H "Authorization: Bot YOUR_BOT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"Capture to Open Brain","type":3}'
```

> [!NOTE]
> Message context menu commands (`type: 3`) can't have a `description` or `options` — Discord rejects the request if you include them. That's expected; the command's only input is the message you right-clicked.

Replace `YOUR_APPLICATION_ID`, `YOUR_GUILD_ID`, and `YOUR_BOT_TOKEN` with your real values (no angle brackets). Both calls should return `201 Created` with the command's JSON body.

✅ **Done when:** Both `/capture` (as a slash command) and "Capture to Open Brain" (under a message's **Apps** context menu) are visible in your server.

---

### Step 8 — Test it

**Slash command:** In any channel the bot can see, type `/capture` and fill in some text, e.g. "Sarah mentioned she's thinking about leaving her job to start a consulting business." Send it.

**Message command:** Right-click any existing message → **Apps** → **Capture to Open Brain**.

Either way, within a couple of seconds you should see an ephemeral reply (visible only to you):

```
Captured as person_note - career, consulting
People: Sarah
Action items: Check in with Sarah about consulting plans
```

Then confirm in Supabase:

```sql
select id, content, metadata->>'type' as type, metadata->'topics' as topics
from thoughts
where metadata->>'source' = 'discord'
order by created_at desc
limit 5;
```

✅ **Done when:** A new row appears with your message text, a populated embedding, and `metadata.source = 'discord'`.

---

## Expected Outcome

Every `/capture` invocation or "Capture to Open Brain" message command creates a `thoughts` row with an embedding, LLM-extracted metadata (type, topics, people, action items, dates), and Discord metadata (`source: "discord"`, `guild_id`, `channel_id`, `author`, plus `discord_message_id` for message-command captures or `discord_interaction_id` for slash-command captures). You get an ephemeral confirmation in Discord that only you can see. Re-running the message command on a message you already captured is a no-op — you'll get "Already captured this message" instead of a duplicate row.

---

## Troubleshooting

**"The specified interactions endpoint url could not be verified" when saving in the Developer Portal**
The signature check is failing, or the function isn't reachable yet. Confirm the function is deployed (Step 5) and that `DISCORD_PUBLIC_KEY` in your Supabase secrets matches the **Public Key** shown on the application's General Information page exactly (copy it again if unsure — it's not the same value as the bot token).

**Discord shows "This interaction failed" in the client**
The function didn't return a response within 3 seconds, or it threw before returning the deferred (`type: 5`) response. Check `supabase functions logs discord-capture` for the actual error — the deferred-ack path itself does almost no work, so a failure here usually means the signature check or JSON parsing blew up, not the embedding/metadata step.

**Command doesn't show up when you type `/`**
Guild-scoped commands (Step 7) usually appear within seconds; if you registered global commands instead (by omitting `/guilds/YOUR_GUILD_ID/` from the URL), allow up to an hour for propagation.

**Ephemeral reply stays "thinking…" and never resolves**
The follow-up `PATCH` to the webhook is failing. Check `supabase functions logs discord-capture` for errors from `sendFollowup` — common causes are an expired interaction token (tokens are valid for 15 minutes, so this shouldn't happen under normal use) or an OpenRouter failure that's caught but still slow. Confirm your OpenRouter key has credits.

**Duplicate thoughts from capturing the same message twice**
Only the message context-menu path dedupes (by `discord_message_id`) — this is deliberate, since two people invoking the message command on the same message should produce one thought, not two. The slash command has no natural "same message" to dedupe against, since each invocation is freeform text you typed.

---

## Tool Surface Area

This integration **does not register any new MCP tools**. It is a capture-only ingestion path: an inbound Discord Interactions webhook that writes to the existing `thoughts` table via a Supabase Edge Function.

| Component | Type | What it does |
|---|---|---|
| `discord-capture` Edge Function | Discord Interactions webhook (not an MCP server) | Verifies Discord's Ed25519 signature, handles the `/capture` slash command and the "Capture to Open Brain" message command, embeds the text via OpenRouter, extracts metadata, and inserts a row in `thoughts`. |
| `thoughts` table | Existing Open Brain primitive | No schema changes. Rows written here are consumed by whatever MCP tools (search, retrieval, summarization) you've already installed. |

**External services called:** `discord.com/api/v10` (signature-verified inbound interactions, plus outbound follow-up webhook calls) and `openrouter.ai/api/v1` (embedding + classification). Both outbound calls are HTTPS; no inbound ports beyond the Supabase function URL itself.

**Auditing:** Because this integration adds no MCP tools, there's no MCP tool surface to audit for it directly. If you're installing this alongside MCP servers that read from the `thoughts` table (such as thought-search tools), audit those servers per the [MCP Tool Audit & Optimization Guide](../../docs/05-tool-audit.md).

---

## Related

- [Slack Capture](../slack-capture/) — same pattern for Slack (passive channel monitoring, since Slack's Events API supports it)
- [Telegram Capture](../telegram-capture/) — same pattern for Telegram (passive chat monitoring via `setWebhook`)
- [MCP Tool Audit & Optimization Guide](../../docs/05-tool-audit.md) — recommended reading for any integration contributor
- [Contributing guide](../../CONTRIBUTING.md) — required reading before submitting changes
