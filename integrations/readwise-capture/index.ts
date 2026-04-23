// readwise-capture / index.ts
//
// Supabase Edge Function that receives Readwise highlight webhooks,
// embeds the highlight text, and inserts it into the `thoughts` table
// with source_type='readwise'. Uses a write-through cache in the
// `readwise_books` table so highlights can carry book title/author
// without one Readwise API call per highlight.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const OPENROUTER_API_KEY = Deno.env.get("OPENROUTER_API_KEY")!;
const READWISE_ACCESS_TOKEN = Deno.env.get("READWISE_ACCESS_TOKEN")!;
const READWISE_WEBHOOK_SECRET = Deno.env.get("READWISE_WEBHOOK_SECRET")!;

const OPENROUTER_BASE = "https://openrouter.ai/api/v1";
const READWISE_BASE = "https://readwise.io/api/v2";
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

interface HighlightEvent {
  id: number;
  text: string;
  note: string;
  location: number | null;
  location_type: string;
  highlighted_at: string | null;
  url: string | null;
  color: string;
  updated: string;
  book_id: number;
  tags: Array<{ id: number; name: string }>;
  event_type: string;
  secret: string;
}

interface ReadwiseBook {
  id: number;
  title: string;
  author: string | null;
  category: string;
  source: string | null;
  source_url: string | null;
  cover_image_url: string | null;
  num_highlights: number;
  last_highlight_at: string | null;
  tags: Array<{ id: number; name: string }>;
}

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

async function fetchBook(bookId: number): Promise<ReadwiseBook | null> {
  const r = await fetch(`${READWISE_BASE}/books/${bookId}/`, {
    headers: { "Authorization": `Token ${READWISE_ACCESS_TOKEN}` },
  });
  if (!r.ok) {
    console.error(`Readwise book fetch failed (${bookId}): ${r.status}`);
    return null;
  }
  return await r.json();
}

async function resolveBook(bookId: number): Promise<ReadwiseBook | null> {
  const { data: cached } = await supabase
    .from("readwise_books")
    .select("book_id, title, author, category, source")
    .eq("book_id", bookId)
    .maybeSingle();

  if (cached) {
    return {
      id: cached.book_id,
      title: cached.title,
      author: cached.author,
      category: cached.category,
      source: cached.source,
      source_url: null,
      cover_image_url: null,
      num_highlights: 0,
      last_highlight_at: null,
      tags: [],
    };
  }

  const book = await fetchBook(bookId);
  if (!book) return null;

  await supabase.from("readwise_books").upsert({
    book_id: book.id,
    title: book.title,
    author: book.author,
    category: book.category,
    source: book.source,
    source_url: book.source_url,
    cover_image_url: book.cover_image_url,
    num_highlights: book.num_highlights,
    last_highlight_at: book.last_highlight_at,
    tags: book.tags ?? [],
    updated_at: new Date().toISOString(),
  });

  return book;
}

Deno.serve(async (req: Request): Promise<Response> => {
  try {
    // Readwise's "Test Webhook" button hits the URL with an empty body
    // (and some infra health checks probe with GET). Respond 200 so the
    // webhook setup flow can pass without us pretending to process
    // missing data.
    if (req.method === "GET") {
      return new Response("readwise-capture is live", { status: 200 });
    }

    const bodyText = await req.text();
    if (!bodyText) {
      return new Response("ok (empty body)", { status: 200 });
    }

    let body: any;
    try {
      body = JSON.parse(bodyText);
    } catch {
      console.error("Invalid JSON body:", bodyText.slice(0, 500));
      return new Response("invalid json", { status: 400 });
    }

    // Readwise echoes the webhook secret in the payload; reject anything
    // that doesn't match our configured value.
    if (body.secret !== READWISE_WEBHOOK_SECRET) {
      return new Response("unauthorized", { status: 401 });
    }

    // This function only handles highlight-created events. Any other
    // event type (Reader document events, tag updates, etc.) is ignored
    // so subscribing to more events on the Readwise side won't break us.
    if (body.event_type !== "readwise.highlight.created") {
      return new Response("ignored", { status: 200 });
    }

    const event = body as HighlightEvent;

    // Deduplicate: if Readwise retries the webhook we mustn't create
    // two thoughts. Filter on source_type first so the query uses the
    // idx_thoughts_source_type index from enhanced-thoughts.
    const { data: existing } = await supabase
      .from("thoughts")
      .select("id")
      .eq("source_type", "readwise")
      .contains("metadata", { readwise_highlight_id: event.id })
      .limit(1);
    if (existing && existing.length > 0) {
      return new Response("duplicate", { status: 200 });
    }

    const book = await resolveBook(event.book_id);

    const noteSuffix = event.note ? `\n\n— ${event.note}` : "";
    const content = `${event.text}${noteSuffix}`;
    const embedding = await getEmbedding(content);

    const { error } = await supabase.from("thoughts").insert({
      content,
      embedding,
      source_type: "readwise",
      type: "reference",
      metadata: {
        source: "readwise",
        readwise_highlight_id: event.id,
        readwise_book_id: event.book_id,
        book_title: book?.title ?? null,
        book_author: book?.author ?? null,
        book_category: book?.category ?? null,
        highlighted_at: event.highlighted_at,
        note: event.note,
        location: event.location,
        location_type: event.location_type,
        color: event.color,
        url: event.url,
        tags: event.tags?.map((t) => t.name) ?? [],
      },
    });

    if (error) {
      console.error("Supabase insert error:", error);
      return new Response("error", { status: 500 });
    }

    if (book) {
      await supabase.rpc("increment_book_highlight_count", {
        p_book_id: event.book_id,
        p_highlighted_at: event.highlighted_at,
      });
    }

    return new Response("ok", { status: 200 });
  } catch (err) {
    console.error("Function error:", err);
    return new Response("error", { status: 500 });
  }
});
