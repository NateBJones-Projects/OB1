# Bookshelf

> A personal reading CRM — track books, log chapter notes by type, capture verbatim quotes, and search your library by topic or problem.

Most reading systems just store a list. This one gives your AI something to work with. Books get notes tagged by type (`insight`, `question`, `action`, `connection`), verbatim quotes with your personal reaction, and an honest dud flag so you remember why you abandoned something. A lightweight reading queue sits alongside the deep library — queue items bridge into the bookshelf when you start reading, and sync back when you finish.

## What It Does

Deploys a Supabase Edge Function with 10 MCP tools for managing a personal reading library. Supports per-user isolation so multiple people can share an Open Brain instance with completely separate bookshelves.

**Tools:**

| Tool | What it does |
|---|---|
| `add_book` | Add a book to your library |
| `append_book_note` | Log a note by type: `summary`, `insight`, `question`, `action`, or `connection` |
| `capture_quote` | Save a verbatim quote with your personal take |
| `get_book_dossier` | Pull a book's full record — metadata, all notes, all quotes. Optionally filter notes by type. |
| `update_reading_status` | Update status, rating, summary, or mark as a dud |
| `search_books` | Search across titles, authors, tags, summaries, notes, and quotes. Duds surface separately with context. |
| `add_to_reading_list` | Add a book, article, podcast, or video to your reading queue |
| `browse_reading_list` | Browse your queue filtered by status, type, or tags |
| `start_reading` | Move an item from queue to bookshelf and mark it in-progress |
| `finish_reading` | Mark a book complete and sync rating/review back to the reading list |

## Prerequisites

- Working Open Brain setup ([guide](../../docs/01-getting-started.md))
- `MCP_ACCESS_KEY` already set as a Supabase secret (from your core setup)
- Your user UUID stored as a Supabase secret (e.g. `DEFAULT_USER_ID`)

## Credential Tracker

Copy this block into a text editor and fill it in as you go.

```text
BOOKSHELF -- CREDENTIAL TRACKER
--------------------------------------

FROM YOUR OPEN BRAIN SETUP
  Supabase Project URL:      ____________  (Settings → API → Project URL)
  MCP_ACCESS_KEY:            ____________  (already set in your secrets)
  User UUID secret name:     ____________  (e.g. DEFAULT_USER_ID)

GENERATED DURING SETUP
  Function name:             ____________  (e.g. bookshelf-mcp)
  Function URL:              ____________  (shown after deploy)

--------------------------------------
```

## Steps

### 1 — Run the schema

In Supabase dashboard → **SQL Editor** → **New query**, paste the entire contents of `schema.sql` and click **Run**.

<details>
<summary>📋 <strong>SQL: Full bookshelf schema</strong> (click to expand)</summary>

```sql
-- Shared trigger function (safe to run even if it already exists)
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

-- Reading list (intake queue)
CREATE TABLE reading_list (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL,
    title TEXT NOT NULL,
    author TEXT,
    type TEXT DEFAULT 'book' CHECK (type IN ('book', 'article', 'podcast', 'video')),
    status TEXT DEFAULT 'want_to_read' CHECK (status IN ('want_to_read', 'reading', 'finished', 'abandoned')),
    rating SMALLINT CHECK (rating >= 1 AND rating <= 5 OR rating IS NULL),
    review_notes TEXT,
    url TEXT,
    started_date DATE,
    finished_date DATE,
    tags JSONB DEFAULT '[]'::jsonb,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    CONSTRAINT finished_after_started CHECK (
        finished_date IS NULL OR started_date IS NULL OR finished_date >= started_date
    )
);

CREATE INDEX idx_reading_list_user_status ON reading_list(user_id, status);
CREATE INDEX idx_reading_list_user_type ON reading_list(user_id, type);
CREATE INDEX idx_reading_list_user_rating ON reading_list(user_id, rating);
CREATE INDEX idx_reading_list_tags ON reading_list USING GIN (tags);
CREATE INDEX idx_reading_list_finished ON reading_list(finished_date DESC) WHERE finished_date IS NOT NULL;

ALTER TABLE reading_list ENABLE ROW LEVEL SECURITY;
CREATE POLICY reading_list_user_policy ON reading_list
    FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP TRIGGER IF EXISTS update_reading_list_updated_at ON reading_list;
CREATE TRIGGER update_reading_list_updated_at
    BEFORE UPDATE ON reading_list
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE OR REPLACE VIEW currently_reading AS
    SELECT * FROM reading_list WHERE status = 'reading' ORDER BY started_date DESC;

-- Books (deep reading library)
CREATE TABLE books (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL,
    reading_list_id UUID REFERENCES reading_list(id) ON DELETE SET NULL,
    title TEXT NOT NULL,
    author TEXT NOT NULL,
    tags TEXT[] DEFAULT '{}',
    status TEXT DEFAULT 'unread' CHECK (status IN ('unread', 'reading', 'completed', 'abandoned')),
    started_at DATE,
    completed_at DATE,
    overall_rating INTEGER CHECK (overall_rating >= 1 AND overall_rating <= 5 OR overall_rating IS NULL),
    summary TEXT,
    dud BOOLEAN DEFAULT false,
    dud_reason TEXT,
    created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

CREATE TABLE book_notes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    book_id UUID REFERENCES books(id) ON DELETE CASCADE NOT NULL,
    user_id UUID NOT NULL,
    chapter TEXT,
    note_type TEXT CHECK (note_type IN ('summary', 'insight', 'question', 'action', 'connection')),
    content TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

CREATE TABLE book_quotes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    book_id UUID REFERENCES books(id) ON DELETE CASCADE NOT NULL,
    user_id UUID NOT NULL,
    chapter TEXT,
    page_number INTEGER,
    quote TEXT NOT NULL,
    personal_take TEXT,
    tags TEXT[] DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

CREATE INDEX idx_books_user_id ON books(user_id);
CREATE INDEX idx_books_user_status ON books(user_id, status);
CREATE INDEX idx_books_user_tags ON books USING GIN (tags);
CREATE INDEX idx_book_notes_book_id ON book_notes(book_id);
CREATE INDEX idx_book_notes_type ON book_notes(book_id, note_type);
CREATE INDEX idx_book_quotes_book_id ON book_quotes(book_id);
CREATE INDEX idx_book_quotes_tags ON book_quotes USING GIN (tags);

ALTER TABLE books ENABLE ROW LEVEL SECURITY;
ALTER TABLE book_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE book_quotes ENABLE ROW LEVEL SECURITY;

CREATE POLICY books_user_policy ON books
    FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY book_notes_user_policy ON book_notes
    FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY book_quotes_user_policy ON book_quotes
    FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP TRIGGER IF EXISTS update_books_updated_at ON books;
CREATE TRIGGER update_books_updated_at
    BEFORE UPDATE ON books
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Permissions for service_role (required on newer Supabase projects)
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.reading_list TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.books TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.book_notes TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.book_quotes TO service_role;
```

</details>

✅ **Done when:** The query completes with no errors. You can verify in **Table Editor** — you should see `reading_list`, `books`, `book_notes`, and `book_quotes`.

### 2 — Create the Edge Function

In Supabase dashboard → **Edge Functions** → **Deploy a new function**.

Name it whatever you like — one function per person who will use it:
- Your function: `bookshelf-mcp`
- Additional users: `bookshelf-[name]-mcp`

### 3 — Paste the files

In the function editor, add two files:

**`index.ts`** — paste the contents of `index.ts` from this directory.

The function reads your UUID from a Supabase secret:
```typescript
const USER_ID = Deno.env.get("DEFAULT_USER_ID");
```

If you followed the standard Open Brain setup, `DEFAULT_USER_ID` is already set. For additional users, set a new secret with their UUID (e.g. `DONNA_USER_ID`) and update line 8 accordingly:
```typescript
const USER_ID = Deno.env.get("DONNA_USER_ID");
```

To generate a UUID for a new user:
```bash
uuidgen | tr '[:upper:]' '[:lower:]'
```

**`deno.json`** — paste the contents of `deno.json` from this directory. No changes needed.

> [!IMPORTANT]
> Both files must be present. Without `deno.json`, the function will fail to bundle with a "relative import path not prefixed" error.

### 4 — Disable JWT verification

In the function's **Details** tab, turn off **Verify JWT**. The function handles its own auth via `MCP_ACCESS_KEY`.

> [!CAUTION]
> This step is easy to miss and will cause all requests to return 401 with no helpful error message.

### 5 — Deploy

Click **Deploy**. Verify by opening the function URL in a browser — you should see:
```json
{ "status": "ok", "service": "Bookshelf", "version": "1.0.0" }
```

✅ **Done when:** The health check returns the JSON above. If it spins or times out, delete the function and create a fresh one — do not re-deploy into the same slot.

### 6 — Connect to Claude

Add a custom connector in Claude:
- **Desktop:** Settings → Connectors → Add custom connector
- **Web:** Settings → Connectors → Add custom connector

Fill in:
- **Name:** `Bookshelf` (or `Bookshelf - [Name]` for shared setups)
- **URL:** `https://YOUR_PROJECT_REF.supabase.co/functions/v1/bookshelf-mcp?key=YOUR_MCP_ACCESS_KEY`

No OAuth. The key is embedded in the URL.

✅ **Done when:** The connector shows as connected and you can ask Claude "add a book called Thinking in Systems by Donella Meadows" and it confirms the insert.

## Adding More Users

Each person gets their own function with their own UUID secret. Repeat Steps 2–6:

1. Add their UUID as a Supabase secret (e.g. `DONNA_USER_ID`)
2. Create a new function (e.g. `bookshelf-donna-mcp`)
3. Paste the same `index.ts` and `deno.json`, update line 8 to their secret name
4. Disable JWT, deploy, give them their own connection URL

Each user's books, notes, and quotes are fully isolated — they only see their own data.

## Expected Outcome

Once connected, you can have natural conversations with Claude about your reading:

- *"Add Creativity Inc by Ed Catmull to my bookshelf with tags leadership and culture"*
- *"Log an insight from chapter 8 of Creativity Inc about psychological safety"*
- *"What open questions do I have across all my leadership books?"*
- *"Search for anything I've read about getting buy-in from skeptical teams"*
- *"Mark Thinking Fast and Slow as a dud — too dense, never finished it"*
- *"Add The Great Alone to my reading list"*
- *"I just started reading Atomic Habits — move it from my queue to my bookshelf"*

## Troubleshooting

**Issue: Function spins or times out on the health check URL**
Solution: Delete the function entirely and create a fresh one with a new name. The Supabase dashboard can get into a bad state from failed deploys — re-deploying into the same slot doesn't always clear it.

**Issue: 401 error when connecting from Claude**
Solution: Check two things in order: (1) Is JWT verification turned off in the function's Details tab? (2) Is the `?key=` value in your connector URL exactly matching the `MCP_ACCESS_KEY` secret?

**Issue: "Book not found" error when logging notes or quotes**
Solution: The note and quote tools look up books by partial title match. The book must already exist via `add_book` before you can attach notes or quotes to it. Use `search_books` to confirm the exact title as stored.

**Issue: Schema errors on tables that already exist**
Solution: The `update_updated_at_column()` trigger function uses `CREATE OR REPLACE` and is safe to re-run. If individual `CREATE TABLE` statements fail because tables already exist, you can run just the missing portions or use `CREATE TABLE IF NOT EXISTS` in a one-off query.

**Issue: Permission denied errors from the edge function**
Solution: Run the GRANT statements at the bottom of the schema SQL. Newer Supabase projects do not automatically grant CRUD permissions to `service_role` on new tables.

---

As you add more MCP tools across extensions, your AI's context fills up. See the [MCP Tool Audit & Optimization Guide](../../docs/05-tool-audit.md) for how to manage your tool surface area.
