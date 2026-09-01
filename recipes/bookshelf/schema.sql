-- Bookshelf Extension
-- Run this entire file at once in Supabase SQL Editor.

-- ============================================================
-- Shared trigger function (must come first)
-- ============================================================

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- Reading List (intake queue for books, articles, podcasts, videos)
-- ============================================================

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
    SELECT * FROM reading_list
    WHERE status = 'reading'
    ORDER BY started_date DESC;

-- ============================================================
-- Bookshelf (deep reading — notes, quotes, reviews)
-- ============================================================

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
