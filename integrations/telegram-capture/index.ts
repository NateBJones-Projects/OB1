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
- "type": one of "idea", "task", "person_note", "reference", "decision", "lesson", "meeting", "journal"
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
