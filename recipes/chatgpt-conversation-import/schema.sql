-- ============================================
-- ChatGPT Conversations — OB1 Extension Schema
-- ============================================
-- Opt-in table for storing conversation-level summaries
-- with pyramid detail levels. Used with --store-conversations.
--
-- Enables:
--   - Temporal browsing ("what was I working on in October?")
--   - Source attribution ("show me the conversation behind this decision")
--   - Smarter re-imports (content_hash change detection)
--
-- Prerequisites:
--   - pgvector extension must be enabled (standard on Supabase)
--   - Run this in your Supabase SQL Editor before using --store-conversations
-- ============================================

-- ----------------------------------------
-- Conversation history table
-- ----------------------------------------
-- Each row = one ChatGPT conversation with pyramid summaries.
-- Thoughts in the thoughts table link back here via
-- metadata.chatgpt_conversation_id = chatgpt_id.

CREATE TABLE IF NOT EXISTS chatgpt_conversations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES auth.users(id) DEFAULT auth.uid(),  -- NULL allowed for service_role inserts; set USER_ID env var for multi-tenant

    -- ChatGPT identifiers
    chatgpt_id TEXT UNIQUE,                 -- Original ChatGPT conversation ID
    title TEXT,
    create_time TIMESTAMPTZ,
    update_time TIMESTAMPTZ,

    -- Conversation metadata
    model_slug TEXT,                        -- Primary model used (e.g. gpt-4o, gpt-5-2-thinking)
    message_count INTEGER,
    conversation_type TEXT,                 -- LLM-classified: product_research, technical_architecture, etc.

    -- Pyramid summaries (progressive disclosure)
    --   8w:  List/timeline label
    --  16w:  One-sentence card title with key outcome
    --  32w:  Dashboard card preview (1-2 sentences)
    --  64w:  Short paragraph with reasoning and alternatives
    -- 128w:  Full summary — embedded for semantic search
    summary_8w TEXT,
    summary_16w TEXT,
    summary_32w TEXT,
    summary_64w TEXT,
    summary_128w TEXT,

    -- Searchable metadata (extracted by LLM)
    key_topics TEXT[],
    people_mentioned TEXT[],

    -- Export-native metadata (free, no LLM cost)
    voice TEXT,                             -- Voice persona (opaque string), NULL for typed conversations
    gizmo_id TEXT,                          -- Custom GPT identifier
    gizmo_type TEXT,                        -- "gpt" (public) or "snorlax" (Projects)
    conversation_origin TEXT,               -- e.g. "apple" for iOS/macOS
    conversation_url TEXT,                  -- https://chatgpt.com/c/{chatgpt_id}

    -- Processing metadata
    content_hash TEXT,                      -- SHA-256 of conversation content for re-import change detection
    import_batch TEXT,                      -- Groups conversations from the same import run
    processed_at TIMESTAMPTZ DEFAULT now(),

    -- Embedding of the 128w summary (for conversation-level semantic search)
    embedding vector(1536)
);

COMMENT ON TABLE chatgpt_conversations IS 'ChatGPT conversation summaries with pyramid detail levels. Populated by import-chatgpt.py --store-conversations.';

-- ----------------------------------------
-- Row Level Security
-- ----------------------------------------

ALTER TABLE chatgpt_conversations ENABLE ROW LEVEL SECURITY;

CREATE POLICY chatgpt_conversations_user_policy ON chatgpt_conversations
    FOR ALL
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

-- ----------------------------------------
-- GRANT permissions to service_role
-- ----------------------------------------
-- Supabase no longer auto-grants CRUD on new projects.

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.chatgpt_conversations TO service_role;

-- ----------------------------------------
-- Indexes for performance
-- ----------------------------------------

-- Semantic search over conversation summaries (128w embedding)
CREATE INDEX IF NOT EXISTS idx_chatgpt_conv_embedding
    ON chatgpt_conversations USING hnsw (embedding vector_cosine_ops);

-- Filter by conversation type (product_research, technical_architecture, etc.)
CREATE INDEX IF NOT EXISTS idx_chatgpt_conv_type
    ON chatgpt_conversations (conversation_type);

-- Temporal browsing: "what was I working on in October?"
CREATE INDEX IF NOT EXISTS idx_chatgpt_conv_create_time
    ON chatgpt_conversations (create_time DESC);

-- Topic-based filtering and search
CREATE INDEX IF NOT EXISTS idx_chatgpt_conv_topics
    ON chatgpt_conversations USING GIN (key_topics);

-- User isolation for multi-tenant queries
CREATE INDEX IF NOT EXISTS idx_chatgpt_conv_user
    ON chatgpt_conversations (user_id);

-- ----------------------------------------
-- Verification
-- ----------------------------------------
-- Run this to confirm the table was created:
--
-- SELECT table_name FROM information_schema.tables
-- WHERE table_name = 'chatgpt_conversations';
--
-- Check indexes:
-- SELECT indexname FROM pg_indexes
-- WHERE tablename = 'chatgpt_conversations';
