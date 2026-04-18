async function setWebhook() {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  const appUrl = process.env.APP_URL;

  if (!token) {
    console.error("TELEGRAM_BOT_TOKEN is required");
    process.exit(1);
  }
  if (!appUrl) {
    console.error("APP_URL is required (your Vercel deployment URL)");
    process.exit(1);
  }

  const webhookUrl = `${appUrl}/api/telegram`;
  const apiUrl = `https://api.telegram.org/bot${token}/setWebhook`;

  const body: Record<string, string> = { url: webhookUrl };
  if (secret) body.secret_token = secret;

  const res = await fetch(apiUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  const data = await res.json();
  if (data.ok) {
    console.log(`Webhook set: ${webhookUrl}`);
    if (secret) console.log("Secret token configured.");
  } else {
    console.error("Failed to set webhook:", data);
    process.exit(1);
  }
}

setWebhook();
