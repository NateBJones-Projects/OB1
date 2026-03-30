# Slack Capture Integration

## What It Does

Adds Slack as a quick-capture interface for your Open Brain. Type a thought in a Slack channel, it gets automatically embedded, classified, and stored — with a threaded confirmation reply showing how your message was categorized.

## Prerequisites

- A working Open Brain setup (follow the [Getting Started guide](../../docs/01-getting-started.md) through Step 4 — you need the Supabase database, OpenRouter API key, and Supabase CLI installed)
- A Slack workspace (free tier works)

## Cost

Slack is free. The Edge Function uses the same OpenRouter credits from your main Open Brain setup — embeddings cost ~$0.02 per million tokens, metadata extraction ~$0.15 per million input tokens. For 20 thoughts/day, expect roughly $0.10–0.30/month in API costs.

---

## Credential Tracker

Copy this block into a text editor and fill it in as you go.

```text
SLACK CAPTURE -- CREDENTIAL TRACKER
--------------------------------------

FROM YOUR OPEN BRAIN SETUP
  OpenRouter API key:    ____________

SLACK WORKSPACE INFO
  Workspace name/URL:    ____________

GENERATED DURING SETUP
  Channel name:          ____________
  Channel ID (Step 1):   C____________
  Bot OAuth Token:       xoxb-____________
  Edge Function URL:     https://____________.supabase.co/functions/v1/ingest-thought

--------------------------------------
```

---

## Step 1: Create Your Slack Capture Channel

1. If you don't have a Slack workspace, create one at slack.com (free tier works)
2. Click the **+** next to Channels → **Create new channel**
3. Name it "capture" (or brain, inbox, whatever feels natural)
4. Make it **Private** (recommended — this is personal)
5. Get the Channel ID: right-click channel → View channel details → scroll to bottom (starts with C)
6. Save the Channel ID — you'll need it in Step 3

---

## Step 2: Create the Slack App

This is the bridge between Slack and your database.

### Create the App

1. Go to api.slack.com/apps → **Create New App** → **From scratch**
2. App Name: "Open Brain", select your workspace
3. Click **Create App**

### Set Permissions

1. Left sidebar → **OAuth & Permissions**
2. Scroll to **Scopes → Bot Token Scopes**
3. Add: `channels:history`, `groups:history`, `chat:write`
4. Scroll up → **Install to Workspace** → Allow
5. Copy the **Bot User OAuth Token** (starts with `xoxb-`) — save it for Step 3

### Add App to Channel

In Slack, open your capture channel and type: `/invite @Open Brain`

> Don't set up Event Subscriptions yet — you need the Edge Function URL first (Step 3).

---

## Step 3: Deploy the Edge Function

This is the brains of the operation. One function receives messages from Slack, generates an embedding, extracts metadata, stores everything in Supabase, and replies with a confirmation.

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
const SLACK_BOT_TOKEN = Deno.env.get("SLACK_BOT_TOKEN")!;
const SLACK_CAPTURE_CHANNEL = Deno.env.get("SLACK_CAPTURE_CHANNEL")!;

const OPENROUTER_BASE = "https://openrouter.ai/api/v1";
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

async function replyInSlack(channel: string, threadTs: string, text: string): Promise<void> {
  await fetch("https://slack.com/api/chat.postMessage", {
    method: "POST",
    headers: { "Authorization": `Bearer ${SLACK_BOT_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ channel, thread_ts: threadTs, text }),
  });
}

Deno.serve(async (req: Request): Promise<Response> => {
  try {
    const body = await req.json();
    if (body.type === "url_verification") {
      return new Response(JSON.stringify({ challenge: body.challenge }), {
        headers: { "Content-Type": "application/json" },
      });
    }
    const event = body.event;
    if (!event || event.type !== "message" || event.subtype || event.bot_id
        || event.channel !== SLACK_CAPTURE_CHANNEL) {
      return new Response("ok", { status: 200 });
    }
    const messageText: string = event.text;
    const channel: string = event.channel;
    const messageTs: string = event.ts;
    if (!messageText || messageText.trim() === "") return new Response("ok", { status: 200 });

    // Deduplicate: Slack retries webhooks if response takes >3s, so check if we already captured this message
    const { data: existing } = await supabase
      .from("thoughts")
      .select("id")
      .contains("metadata", { slack_ts: messageTs })
      .limit(1);
    if (existing && existing.length > 0) return new Response("ok", { status: 200 });

    const [embedding, metadata] = await Promise.all([
      getEmbedding(messageText),
      extractMetadata(messageText),
    ]);

    const { error } = await supabase.from("thoughts").insert({
      content: messageText,
      embedding,
      metadata: { ...metadata, source: "slack", slack_ts: messageTs },
    });

    if (error) {
      console.error("Supabase insert error:", error);
      await replyInSlack(channel, messageTs, `Failed to capture: ${error.message}`);
      return new Response("error", { status: 500 });
    }

    const meta = metadata as Record<string, unknown>;
    let confirmation = `Captured as *${meta.type || "thought"}*`;
    if (Array.isArray(meta.topics) && meta.topics.length > 0)
      confirmation += ` - ${meta.topics.join(", ")}`;
    if (Array.isArray(meta.people) && meta.people.length > 0)
      confirmation += `\nPeople: ${meta.people.join(", ")}`;
    if (Array.isArray(meta.action_items) && meta.action_items.length > 0)
      confirmation += `\nAction items: ${meta.action_items.join("; ")}`;

    await replyInSlack(channel, messageTs, confirmation);
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
supabase secrets set SLACK_BOT_TOKEN=xoxb-your-slack-bot-token-here
supabase secrets set SLACK_CAPTURE_CHANNEL=C0your-channel-id-here
```

Replace the values with:
- Your OpenRouter API key from the main guide (Step 4)
- Your Slack Bot OAuth Token from Step 2 above
- Your Slack Channel ID from Step 1 above

> SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are automatically available inside Edge Functions — you don't need to set them.

> **If you ever rotate your OpenRouter key:** you must re-run `supabase secrets set OPENROUTER_API_KEY=...` with the new key. This Edge Function reads the key from Supabase secrets at runtime — updating it on openrouter.ai alone won't propagate here. See the [FAQ on key rotation](../../docs/03-faq.md#api-key-rotation) for the full checklist.

### Deploy

```bash
supabase functions deploy ingest-thought --no-verify-jwt
```

> Copy the Edge Function URL immediately after deployment! It looks like: `https://YOUR_PROJECT_REF.supabase.co/functions/v1/ingest-thought`

Save this URL — you'll need it in Step 4.

---

## Step 4: Connect Slack to the Edge Function

1. Go to api.slack.com/apps → select your Open Brain app
2. Left sidebar → **Event Subscriptions** → toggle **Enable Events ON**
3. Paste your Edge Function URL in the **Request URL** field
4. Wait for the green checkmark — Verified
5. Under **Subscribe to bot events**, add both: `message.channels` and `message.groups`
6. Click **Save Changes** (reinstall if prompted)

> **You need both events.** Slack treats public and private channels as separate entity types. Public channels fire `message.channels`, private channels fire `message.groups`. If you only add one, messages in the other channel type will silently fail — no error, just nothing happens. Add both so you're covered regardless of how your capture channel is configured.

---

## Step 5: Test It

Go to your capture channel in Slack and type:

```text
Sarah mentioned she's thinking about leaving her job to start a consulting business
```

Wait 5–10 seconds. You should see a threaded reply:

```text
Captured as person_note — career, consulting
People: Sarah
Action items: Check in with Sarah about consulting plans
```

Then open Supabase dashboard → Table Editor → thoughts. You should see one row with your message, an embedding, and metadata.

---

## Expected Outcome

Every message you post in your Slack capture channel automatically gets:
- Embedded with a 1536-dimensional vector for semantic search
- Classified by type (observation, task, idea, reference, person_note)
- Tagged with topics, people, action items, and dates (where applicable)
- Stored in your Supabase `thoughts` table
- Confirmed with a threaded reply showing the extracted metadata

You can now search for these thoughts using any MCP-connected AI (Claude Desktop, ChatGPT, Claude Code, etc.) via the Open Brain MCP server from the main guide.

---

## Troubleshooting

### Slack says "Request URL not verified"

Your Edge Function isn't deployed or isn't reachable. Run the deploy command again and check the output for errors.

```bash
supabase functions deploy ingest-thought --no-verify-jwt
```

### Messages aren't triggering the function

Check Event Subscriptions — make sure both `message.channels` and `message.groups` are listed (public channels use the first, private channels use the second — you need both). Verify the app is invited to the channel. Confirm the channel ID in your secrets matches the actual channel.

### Slack creates duplicate database entries

Slack retries webhook delivery if it doesn't get a response within 3 seconds. The Edge Function includes built-in deduplication — it checks for existing rows with the same `slack_ts` before processing. If you're still seeing duplicates, make sure you're on the latest version of the code (see Step 3) and have redeployed.

### Function runs but nothing in the database

Check Edge Function logs: Supabase dashboard → Edge Functions → ingest-thought → Logs. Most likely the OpenRouter key is wrong or has no credits.

```bash
supabase secrets list
```

### No confirmation reply in Slack

The bot token might be wrong, or `chat:write` scope wasn't added. Go to your Slack app → OAuth & Permissions and verify. If you added the scope after installing, you need to reinstall the app.

### Metadata extraction seems off

That's normal — the LLM is making its best guess with limited context. The metadata is a convenience layer on top of semantic search, not the primary retrieval mechanism. The embedding handles fuzzy matching regardless.

---

## What You Just Built

You now have a Slack channel that acts as a direct write path into your Open Brain. Type anything — meeting notes, random ideas, observations, reminders — and it's automatically embedded, classified, and searchable from any AI tool connected to your MCP server.

This is one of many possible capture interfaces. Your Open Brain MCP server also includes a `capture_thought` tool, which means any MCP-connected AI (Claude Desktop, ChatGPT, Claude Code, Cursor) can write directly to your brain without switching apps. Slack is just the dedicated inbox.

---

*Built by Nate B. Jones — part of the [Open Brain project](https://github.com/NateBJones-Projects/OB1)*
