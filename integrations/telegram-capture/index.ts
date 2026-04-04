import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const OPENROUTER_API_KEY = Deno.env.get("OPENROUTER_API_KEY")!;
const TELEGRAM_BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN")!;
const TELEGRAM_ALLOWED_CHAT_ID = Deno.env.get("TELEGRAM_ALLOWED_CHAT_ID")!;

const OPENROUTER_BASE = "https://openrouter.ai/api/v1";
const TELEGRAM_API = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}`;
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// --- Helpers ---

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
  const body: Record<string, unknown> = { chat_id: chatId, text, parse_mode: "Markdown" };
  if (replyToMessageId) body.reply_to_message_id = replyToMessageId;
  await fetch(`${TELEGRAM_API}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

// --- Command handler ---

const HELP_TEXT = `*Available commands*

*OB1 — instant*
/search <query> — semantic search your brain
/thoughts \\[n\\] — recent n thoughts (default 5)
/stats — brain statistics

*Property Agent — ≤1 min*
/status — agent status
/trigger \\[type\\] — fire a session
  types: morning, checkin, evening, property\\-check, manual
/resume — clear paused/killed flags
/maintenance <address> — <issue> — log a maintenance task

/help — this message

_Any other message is captured as a thought._`;

async function handleCommand(
  command: string,
  args: string,
  chatId: number,
  messageId: number
): Promise<void> {
  switch (command) {

    case "help":
      await sendReply(chatId, HELP_TEXT, messageId);
      break;

    case "search": {
      if (!args) { await sendReply(chatId, "Usage: /search <query>", messageId); break; }
      try {
        const embedding = await getEmbedding(args);
        const { data, error } = await supabase.rpc("match_thoughts", {
          query_embedding: embedding,
          match_threshold: 0.5,
          match_count: 5,
          filter: {},
        });
        if (error || !data?.length) {
          await sendReply(chatId, `No results for "${args}"`, messageId);
        } else {
          const results = (data as { content: string; metadata: Record<string, unknown>; created_at: string; similarity: number }[])
            .map((t, i) => {
              const m = t.metadata || {};
              const date = new Date(t.created_at).toLocaleDateString("en-GB");
              const topics = Array.isArray(m.topics) ? (m.topics as string[]).join(", ") : "";
              const snippet = t.content.length > 120 ? t.content.substring(0, 120) + "…" : t.content;
              return `${i + 1}\\. \\[${date}\\]${topics ? ` _(${topics})_` : ""}\n${snippet}`;
            }).join("\n\n");
          await sendReply(chatId, `Found ${data.length} result(s) for "${args}":\n\n${results}`, messageId);
        }
      } catch (e: unknown) {
        await sendReply(chatId, `Search failed: ${(e as Error).message}`, messageId);
      }
      break;
    }

    case "thoughts": {
      const limit = Math.min(parseInt(args) || 5, 10);
      const { data, error } = await supabase
        .from("thoughts")
        .select("content, metadata, created_at")
        .order("created_at", { ascending: false })
        .limit(limit);
      if (error || !data?.length) {
        await sendReply(chatId, "No thoughts found.", messageId);
      } else {
        const results = (data as { content: string; metadata: Record<string, unknown>; created_at: string }[])
          .map((t, i) => {
            const date = new Date(t.created_at).toLocaleDateString("en-GB");
            const snippet = t.content.length > 100 ? t.content.substring(0, 100) + "…" : t.content;
            return `${i + 1}\\. \\[${date}\\] ${snippet}`;
          }).join("\n\n");
        await sendReply(chatId, `Last ${data.length} thought(s):\n\n${results}`, messageId);
      }
      break;
    }

    case "stats": {
      const { count } = await supabase.from("thoughts").select("*", { count: "exact", head: true });
      const { data } = await supabase.from("thoughts").select("metadata").order("created_at", { ascending: false });
      const types: Record<string, number> = {};
      const topics: Record<string, number> = {};
      for (const r of data || []) {
        const m = (r.metadata || {}) as Record<string, unknown>;
        if (m.type) types[m.type as string] = (types[m.type as string] || 0) + 1;
        if (Array.isArray(m.topics))
          for (const t of m.topics) topics[t as string] = (topics[t as string] || 0) + 1;
      }
      const fmt = (o: Record<string, number>) =>
        Object.entries(o).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([k, v]) => `  ${k}: ${v}`).join("\n");
      await sendReply(chatId,
        `*Brain stats*\nTotal: ${count}\n\n*Types:*\n${fmt(types)}\n\n*Top topics:*\n${fmt(topics)}`,
        messageId
      );
      break;
    }

    case "maintenance": {
      if (!args) {
        await sendReply(chatId,
          "Usage: `/maintenance <address> — <issue>`\nExample: `/maintenance 14 High St CO3 5AB — boiler not working`",
          messageId
        );
        break;
      }
      const { error } = await supabase.from("telegram_commands").insert({
        command: "maintenance",
        args,
        chat_id: chatId,
        message_id: messageId,
        status: "pending",
      });
      if (error) {
        await sendReply(chatId, `Failed to queue: ${error.message}`, messageId);
      } else {
        await sendReply(chatId, `Maintenance task queued — logging within 1 min:\n_${args}_`, messageId);
      }
      break;
    }

    case "status":
    case "trigger":
    case "resume": {
      const { error } = await supabase.from("telegram_commands").insert({
        command,
        args: args || null,
        chat_id: chatId,
        message_id: messageId,
        status: "pending",
      });
      if (error) {
        await sendReply(chatId, `Failed to queue command: ${error.message}`, messageId);
      } else {
        const msg = command === "trigger"
          ? `Session _"${args || "manual"}"_ queued — starting within 1 min.`
          : `/${command} queued — processing within 1 min.`;
        await sendReply(chatId, msg, messageId);
      }
      break;
    }

    default:
      await sendReply(chatId, `Unknown command: /${command}\n\nTry /help`, messageId);
  }
}

// --- Main webhook handler ---

Deno.serve(async (req: Request): Promise<Response> => {
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
  if (String(chatId) !== TELEGRAM_ALLOWED_CHAT_ID) return new Response("ok", { status: 200 });
  if (!text) return new Response("ok", { status: 200 });

  // Route commands
  if (text.startsWith("/")) {
    const [rawCmd, ...rest] = text.split(" ");
    const command = rawCmd.slice(1).toLowerCase().replace(/@.*$/, ""); // strip @botname suffix
    const args = rest.join(" ").trim();
    await handleCommand(command, args, chatId, messageId);
    return new Response("ok", { status: 200 });
  }

  // Deduplicate
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
      .select("id")
      .eq("agent_message_id", agentMessageId)
      .eq("status", "pending")
      .limit(1);
    if (pending && pending.length > 0) {
      await supabase
        .from("telegram_pending_replies")
        .update({ reply_text: text, status: "received", received_at: new Date().toISOString() })
        .eq("id", pending[0].id);
      await sendReply(chatId, "Got it.", messageId);
      return new Response("ok", { status: 200 });
    }
  }

  // Capture as thought
  try {
    const [embedding, metadata] = await Promise.all([getEmbedding(text), extractMetadata(text)]);
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
    if (Array.isArray(meta.topics) && meta.topics.length)
      confirmation += ` — ${(meta.topics as string[]).join(", ")}`;
    if (Array.isArray(meta.people) && meta.people.length)
      confirmation += `\nPeople: ${(meta.people as string[]).join(", ")}`;
    if (Array.isArray(meta.action_items) && meta.action_items.length)
      confirmation += `\nActions: ${(meta.action_items as string[]).join("; ")}`;
    await sendReply(chatId, confirmation, messageId);
    return new Response("ok", { status: 200 });
  } catch (err) {
    console.error("Function error:", err);
    return new Response("error", { status: 500 });
  }
});
