import { Hono } from "hono";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPTransport } from "@hono/mcp";
import { z } from "zod";
import { createClient } from "@supabase/supabase-js";

// ✏️ CHANGE THIS LINE PER USER
const USER_ID =  Deno.env.get("DEFAULT_USER_ID");

const app = new Hono();

app.get("*", (c) => c.json({ status: "ok", service: "Bookshelf", version: "1.0.0" }));

app.post("*", async (c) => {
  if (!c.req.header("accept")?.includes("text/event-stream")) {
    const headers = new Headers(c.req.raw.headers);
    headers.set("Accept", "application/json, text/event-stream");
    const patched = new Request(c.req.raw.url, {
      method: c.req.raw.method,
      headers,
      body: c.req.raw.body,
      // @ts-ignore -- duplex required for streaming body in Deno
      duplex: "half",
    });
    Object.defineProperty(c.req, "raw", { value: patched, writable: true });
  }

  const key = c.req.query("key") || c.req.header("x-access-key");
  const expected = Deno.env.get("MCP_ACCESS_KEY");
  if (!key || key !== expected) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const server = new McpServer({ name: "bookshelf", version: "1.0.0" });

  // Internal helper — find a book by partial title match
  async function findBook(title: string) {
    const { data, error } = await supabase
      .from("books")
      .select("id, title, dud, dud_reason")
      .eq("user_id", USER_ID)
      .ilike("title", `%${title}%`)
      .limit(1)
      .single();
    if (error) throw new Error(`Book not found: "${title}". Use add_book first.`);
    return data;
  }

  // Tool 1: add_book
  server.tool(
    "add_book",
    "Add a book to your reading library",
    {
      title: z.string().describe("Book title"),
      author: z.string().describe("Author name"),
      tags: z.array(z.string()).optional().describe("Topics/themes e.g. ['leadership', 'creativity', 'management']"),
      summary: z.string().optional().describe("Why you want to read it or what it's about"),
    },
    async (args) => {
      const { data, error } = await supabase
        .from("books")
        .insert({
          user_id: USER_ID,
          title: args.title,
          author: args.author,
          tags: args.tags || [],
          summary: args.summary || null,
        })
        .select()
        .single();
      if (error) throw new Error(`Failed to add book: ${error.message}`);
      return { content: [{ type: "text", text: JSON.stringify({ success: true, book: data }, null, 2) }] };
    }
  );

  // Tool 2: append_book_note
  server.tool(
    "append_book_note",
    "Add a note to a book — summary, insight, open question, action item, or connection to another idea",
    {
      book_title: z.string().describe("Book title (partial match ok)"),
      chapter: z.string().optional().describe("Chapter name e.g. 'Ch 8 - Candor'"),
      note_type: z.enum(["summary", "insight", "question", "action", "connection"]).describe("Type of note"),
      content: z.string().describe("The note"),
    },
    async (args) => {
      const book = await findBook(args.book_title);
      const { data, error } = await supabase
        .from("book_notes")
        .insert({
          book_id: book.id,
          user_id: USER_ID,
          chapter: args.chapter || null,
          note_type: args.note_type,
          content: args.content,
        })
        .select()
        .single();
      if (error) throw new Error(`Failed to append note: ${error.message}`);
      return { content: [{ type: "text", text: JSON.stringify({ success: true, note: data }, null, 2) }] };
    }
  );

  // Tool 3: capture_quote
  server.tool(
    "capture_quote",
    "Save a verbatim quote from a book with your personal reaction or interpretation",
    {
      book_title: z.string().describe("Book title (partial match ok)"),
      chapter: z.string().optional().describe("Chapter name e.g. 'Ch 8 - Candor'"),
      page_number: z.number().optional().describe("Page number"),
      quote: z.string().describe("Verbatim quote"),
      personal_take: z.string().optional().describe("Your reaction or interpretation"),
      tags: z.array(z.string()).optional().describe("Tags e.g. ['vulnerability', 'feedback']"),
    },
    async (args) => {
      const book = await findBook(args.book_title);
      const { data, error } = await supabase
        .from("book_quotes")
        .insert({
          book_id: book.id,
          user_id: USER_ID,
          chapter: args.chapter || null,
          page_number: args.page_number || null,
          quote: args.quote,
          personal_take: args.personal_take || null,
          tags: args.tags || [],
        })
        .select()
        .single();
      if (error) throw new Error(`Failed to capture quote: ${error.message}`);
      return { content: [{ type: "text", text: JSON.stringify({ success: true, quote: data }, null, 2) }] };
    }
  );

  // Tool 4: get_book_dossier
  server.tool(
    "get_book_dossier",
    "Get a book's full record — metadata, all notes, and all quotes. Optionally filter notes by type.",
    {
      book_title: z.string().describe("Book title (partial match ok)"),
      note_type: z.enum(["summary", "insight", "question", "action", "connection"]).optional().describe("Filter notes by type — e.g. 'question' to surface all open questions"),
    },
    async (args) => {
      const book = await findBook(args.book_title);

      let notesQuery = supabase
        .from("book_notes")
        .select("*")
        .eq("book_id", book.id)
        .eq("user_id", USER_ID)
        .order("created_at", { ascending: true });

      if (args.note_type) {
        notesQuery = notesQuery.eq("note_type", args.note_type);
      }

      const [{ data: fullBook }, { data: notes }, { data: quotes }] = await Promise.all([
        supabase.from("books").select("*").eq("id", book.id).single(),
        notesQuery,
        supabase
          .from("book_quotes")
          .select("*")
          .eq("book_id", book.id)
          .eq("user_id", USER_ID)
          .order("created_at", { ascending: true }),
      ]);

      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            success: true,
            book: fullBook,
            notes: notes || [],
            quotes: quotes || [],
            note_count: notes?.length || 0,
            quote_count: quotes?.length || 0,
          }, null, 2),
        }],
      };
    }
  );

  // Tool 5: update_reading_status
  server.tool(
    "update_reading_status",
    "Update a book's reading status, rating, summary, or mark it as a dud",
    {
      book_title: z.string().describe("Book title (partial match ok)"),
      status: z.enum(["unread", "reading", "completed", "abandoned"]).optional(),
      started_at: z.string().optional().describe("Date started (YYYY-MM-DD)"),
      completed_at: z.string().optional().describe("Date completed (YYYY-MM-DD)"),
      overall_rating: z.number().min(1).max(5).optional().describe("Rating 1-5"),
      summary: z.string().optional().describe("Overall takeaway or review"),
      dud: z.boolean().optional().describe("Mark as a dud — won't be recommended but stays in library with context"),
      dud_reason: z.string().optional().describe("Why it was a dud e.g. 'woo woo nonsense', 'too basic'"),
    },
    async (args) => {
      const book = await findBook(args.book_title);
      const updates: Record<string, any> = {};
      if (args.status !== undefined) updates.status = args.status;
      if (args.started_at !== undefined) updates.started_at = args.started_at;
      if (args.completed_at !== undefined) updates.completed_at = args.completed_at;
      if (args.overall_rating !== undefined) updates.overall_rating = args.overall_rating;
      if (args.summary !== undefined) updates.summary = args.summary;
      if (args.dud !== undefined) updates.dud = args.dud;
      if (args.dud_reason !== undefined) updates.dud_reason = args.dud_reason;

      const { data, error } = await supabase
        .from("books")
        .update(updates)
        .eq("id", book.id)
        .eq("user_id", USER_ID)
        .select()
        .single();
      if (error) throw new Error(`Failed to update book: ${error.message}`);
      return { content: [{ type: "text", text: JSON.stringify({ success: true, book: data }, null, 2) }] };
    }
  );

  // Tool 6: search_books
  server.tool(
    "search_books",
    "Search your library by topic, problem, or keyword across titles, authors, tags, summaries, notes, and quotes. Duds are surfaced separately with context.",
    {
      query: z.string().describe("Topic, problem, keyword, or book title — e.g. 'getting buy-in from leadership' or 'Creativity Inc'"),
      tags: z.array(z.string()).optional().describe("Narrow by tags e.g. ['leadership']"),
    },
    async (args) => {
      let booksQuery = supabase
        .from("books")
        .select("*")
        .eq("user_id", USER_ID)
        .or(`title.ilike.%${args.query}%,author.ilike.%${args.query}%,summary.ilike.%${args.query}%`);

      if (args.tags && args.tags.length > 0) {
        booksQuery = booksQuery.contains("tags", args.tags);
      }

      const [
        { data: bookMatches },
        { data: noteMatches },
        { data: quoteMatches },
      ] = await Promise.all([
        booksQuery,
        supabase
          .from("book_notes")
          .select("book_id, content, note_type, chapter")
          .eq("user_id", USER_ID)
          .ilike("content", `%${args.query}%`),
        supabase
          .from("book_quotes")
          .select("book_id, quote, personal_take, chapter")
          .eq("user_id", USER_ID)
          .or(`quote.ilike.%${args.query}%,personal_take.ilike.%${args.query}%`),
      ]);

      const existingIds = new Set(bookMatches?.map((b: any) => b.id) || []);
      const additionalIds = [
        ...new Set([
          ...(noteMatches?.map((n: any) => n.book_id) || []),
          ...(quoteMatches?.map((q: any) => q.book_id) || []),
        ]),
      ].filter((id) => !existingIds.has(id));

      let additionalBooks: any[] = [];
      if (additionalIds.length > 0) {
        const { data } = await supabase
          .from("books")
          .select("*")
          .eq("user_id", USER_ID)
          .in("id", additionalIds);
        additionalBooks = data || [];
      }

      const allBooks = [...(bookMatches || []), ...additionalBooks];
      const duds = allBooks.filter((b: any) => b.dud);
      const results = allBooks.filter((b: any) => !b.dud);

      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            success: true,
            query: args.query,
            result_count: results.length,
            results,
            dud_count: duds.length,
            duds: duds.map((d: any) => ({
              title: d.title,
              author: d.author,
              dud_reason: d.dud_reason,
            })),
          }, null, 2),
        }],
      };
    }
  );

  // Tool 7: add_to_reading_list
  server.tool(
    "add_to_reading_list",
    "Add a book, article, podcast, or video to your reading queue",
    {
      title: z.string().describe("Title"),
      author: z.string().optional().describe("Author or creator"),
      type: z.enum(["book", "article", "podcast", "video"]).optional().describe("Type (default: book)"),
      url: z.string().optional().describe("Link to the item"),
      tags: z.array(z.string()).optional().describe("Topics e.g. ['leadership', 'creativity']"),
      review_notes: z.string().optional().describe("Why you want to read/watch this"),
    },
    async (args) => {
      const { data, error } = await supabase
        .from("reading_list")
        .insert({
          user_id: USER_ID,
          title: args.title,
          author: args.author || null,
          type: args.type || "book",
          url: args.url || null,
          tags: args.tags || [],
          review_notes: args.review_notes || null,
        })
        .select()
        .single();
      if (error) throw new Error(`Failed to add to reading list: ${error.message}`);
      return { content: [{ type: "text", text: JSON.stringify({ success: true, item: data }, null, 2) }] };
    }
  );

  // Tool 8: browse_reading_list
  server.tool(
    "browse_reading_list",
    "Browse your reading queue — filter by status, type, or tags. Use this to decide what to read next.",
    {
      status: z.enum(["want_to_read", "reading", "finished", "abandoned"]).optional().describe("Filter by status (omit for all)"),
      type: z.enum(["book", "article", "podcast", "video"]).optional().describe("Filter by type"),
      tags: z.array(z.string()).optional().describe("Filter by tags"),
    },
    async (args) => {
      let query = supabase
        .from("reading_list")
        .select("*")
        .eq("user_id", USER_ID)
        .order("created_at", { ascending: false });

      if (args.status) query = query.eq("status", args.status);
      if (args.type) query = query.eq("type", args.type);
      if (args.tags && args.tags.length > 0) query = query.contains("tags", args.tags);

      const { data, error } = await query;
      if (error) throw new Error(`Failed to browse reading list: ${error.message}`);
      return { content: [{ type: "text", text: JSON.stringify({ success: true, count: data.length, items: data }, null, 2) }] };
    }
  );

  // Tool 9: start_reading
  server.tool(
    "start_reading",
    "Move a book from your reading list into the bookshelf — creates a bookshelf entry linked to the reading list item",
    {
      reading_list_title: z.string().describe("Title from your reading list (partial match ok)"),
      tags: z.array(z.string()).optional().describe("Bookshelf tags (inherits reading list tags if omitted)"),
      started_at: z.string().optional().describe("Date started (YYYY-MM-DD), defaults to today"),
    },
    async (args) => {
      // Find reading list entry
      const { data: rlItem, error: rlError } = await supabase
        .from("reading_list")
        .select("*")
        .eq("user_id", USER_ID)
        .ilike("title", `%${args.reading_list_title}%`)
        .limit(1)
        .single();
      if (rlError) throw new Error(`Not found in reading list: "${args.reading_list_title}"`);

      const today = new Date().toISOString().split("T")[0];

      // Create bookshelf entry
      const { data: book, error: bookError } = await supabase
        .from("books")
        .insert({
          user_id: USER_ID,
          title: rlItem.title,
          author: rlItem.author || "",
          tags: args.tags || (Array.isArray(rlItem.tags) ? rlItem.tags : []),
          status: "reading",
          started_at: args.started_at || today,
          reading_list_id: rlItem.id,
        })
        .select()
        .single();
      if (bookError) throw new Error(`Failed to create bookshelf entry: ${bookError.message}`);

      // Update reading list status
      await supabase
        .from("reading_list")
        .update({ status: "reading", started_date: args.started_at || today })
        .eq("id", rlItem.id);

      return {
        content: [{
          type: "text",
          text: JSON.stringify({ success: true, message: `Started reading "${rlItem.title}"`, book }, null, 2),
        }],
      };
    }
  );

  // Tool 10: finish_reading
  server.tool(
    "finish_reading",
    "Mark a book as finished — updates the bookshelf and syncs rating and review back to your reading list",
    {
      book_title: z.string().describe("Book title in your bookshelf (partial match ok)"),
      overall_rating: z.number().min(1).max(5).optional().describe("Rating 1-5"),
      summary: z.string().optional().describe("Overall takeaway or review"),
      dud: z.boolean().optional().describe("Mark as a dud"),
      dud_reason: z.string().optional().describe("Why it was a dud"),
      finished_date: z.string().optional().describe("Date finished (YYYY-MM-DD), defaults to today"),
    },
    async (args) => {
      const book = await findBook(args.book_title);
      const today = new Date().toISOString().split("T")[0];

      // Update bookshelf
      const bookUpdates: Record<string, any> = {
        status: "completed",
        completed_at: args.finished_date || today,
      };
      if (args.overall_rating !== undefined) bookUpdates.overall_rating = args.overall_rating;
      if (args.summary !== undefined) bookUpdates.summary = args.summary;
      if (args.dud !== undefined) bookUpdates.dud = args.dud;
      if (args.dud_reason !== undefined) bookUpdates.dud_reason = args.dud_reason;

      const { data: updatedBook, error: bookError } = await supabase
        .from("books")
        .update(bookUpdates)
        .eq("id", book.id)
        .eq("user_id", USER_ID)
        .select()
        .single();
      if (bookError) throw new Error(`Failed to update bookshelf: ${bookError.message}`);

      // Sync back to reading list if linked
      if (updatedBook.reading_list_id) {
        const rlUpdates: Record<string, any> = {
          status: "finished",
          finished_date: args.finished_date || today,
        };
        if (args.overall_rating !== undefined) rlUpdates.rating = args.overall_rating;
        if (args.summary !== undefined) rlUpdates.review_notes = args.summary;

        await supabase
          .from("reading_list")
          .update(rlUpdates)
          .eq("id", updatedBook.reading_list_id);
      }

      return {
        content: [{
          type: "text",
          text: JSON.stringify({ success: true, message: `Finished "${updatedBook.title}"`, book: updatedBook }, null, 2),
        }],
      };
    }
  );

  const transport = new StreamableHTTPTransport();
  await server.connect(transport);
  return transport.handleRequest(c);
});

Deno.serve(app.fetch);
