# Embedding Utils Primitive

## What This Is

Two functions used in every capture integration:

- **`getEmbedding(text)`** — generates a 1536-dim vector via OpenRouter (`openai/text-embedding-3-small`)
- **`extractMetadata(text)`** — extracts people, action items, dates, topics, and type via GPT-4o-mini

These were previously copy-pasted into each integration (Slack, Discord, etc.). This is the canonical version. When updating, update here and propagate to integrations.

## Used In

- `server/index.ts` (MCP server — `capture_thought`)
- `integrations/slack-capture/` (Edge Function)
- `integrations/telegram-capture/` (Edge Function)
- `integrations/discord-capture/` (Edge Function)

## The Code

Copy this block into any Supabase Edge Function that needs to embed and classify text:

```typescript
const OPENROUTER_BASE = "https://openrouter.ai/api/v1";

async function getEmbedding(text: string): Promise<number[]> {
  const r = await fetch(`${OPENROUTER_BASE}/embeddings`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${Deno.env.get("OPENROUTER_API_KEY")}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "openai/text-embedding-3-small",
      input: text,
    }),
  });
  if (!r.ok) {
    const msg = await r.text().catch(() => "");
    throw new Error(`OpenRouter embeddings failed: ${r.status} ${msg}`);
  }
  const d = await r.json();
  return d.data[0].embedding;
}

async function extractMetadata(text: string): Promise<Record<string, unknown>> {
  const r = await fetch(`${OPENROUTER_BASE}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${Deno.env.get("OPENROUTER_API_KEY")}`,
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
```

## Notes

- Both functions require `OPENROUTER_API_KEY` to be set as a Supabase secret
- `getEmbedding` throws on HTTP error — wrap the caller in try/catch
- `extractMetadata` never throws — falls back to `{ topics: ["uncategorized"], type: "observation" }` on any parse failure
- The metadata prompt is intentionally conservative ("only extract what's explicitly there") — don't tighten it without testing across diverse inputs
