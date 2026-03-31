export const maxDuration = 15;

import { Bot, webhookCallback } from "grammy";
import { captureThought } from "@/lib/capture";
import { searchThoughts } from "@/lib/db";
import { generateEmbedding } from "@/lib/ai";

function createBot(): Bot {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new Error("TELEGRAM_BOT_TOKEN is required");

  const bot = new Bot(token);

  bot.command("start", (ctx) =>
    ctx.reply(
      "Open Brain connected.\n\nSend me any thought, note, or idea — I'll classify and store it.\n\nCommands:\n/search <query> — find related thoughts\n/start — show this message",
    ),
  );

  bot.command("search", async (ctx) => {
    const query = ctx.match;
    if (!query) {
      return ctx.reply("Usage: /search <query>");
    }

    const queryEmbedding = await generateEmbedding(query);
    const results = await searchThoughts(queryEmbedding, { limit: 5 });

    if (results.length === 0) {
      return ctx.reply("No matching thoughts found.");
    }

    const text = results
      .map(
        (t, i) =>
          `${i + 1}. [${t.metadata.type}] ${t.content.slice(0, 200)}${t.content.length > 200 ? "..." : ""}\n   (${Math.round((t.similarity ?? 0) * 100)}% match)`,
      )
      .join("\n\n");

    return ctx.reply(text);
  });

  bot.on("message:text", async (ctx) => {
    if (ctx.message.text.startsWith("/")) return;

    const result = await captureThought(ctx.message.text, "telegram");
    const topics = result.metadata.topics.join(", ") || "none";
    await ctx.reply(
      `Captured as ${result.metadata.type}\nTopics: ${topics}${
        result.metadata.action_items.length
          ? `\nAction items: ${result.metadata.action_items.join("; ")}`
          : ""
      }`,
    );
  });

  bot.on("message:photo", async (ctx) => {
    const caption = ctx.message.caption;
    if (!caption) {
      return ctx.reply("Send a caption with the photo to capture a thought.");
    }

    const result = await captureThought(caption, "telegram");
    await ctx.reply(`Captured caption as ${result.metadata.type}`);
  });

  return bot;
}

let bot: Bot | undefined;
function getBot(): Bot {
  if (!bot) bot = createBot();
  return bot;
}

export async function POST(req: Request) {
  const expectedSecret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (!expectedSecret) {
    return Response.json({ error: "Telegram webhook not configured" }, { status: 503 });
  }
  const secret = req.headers.get("x-telegram-bot-api-secret-token");
  if (secret !== expectedSecret) {
    return Response.json({ error: "Invalid webhook secret" }, { status: 401 });
  }

  const handler = webhookCallback(getBot(), "std/http");
  return handler(req);
}
