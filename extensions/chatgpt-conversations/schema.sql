-- ============================================
-- ChatGPT Conversations Extension — RPC Functions
-- ============================================
-- This extension adds search capabilities to the chatgpt_conversations
-- table created by the ChatGPT Import recipe.
--
-- Prerequisites:
--   1. Run recipes/chatgpt-conversation-import/schema.sql first
--      (creates the chatgpt_conversations table)
--   2. Then run this file to add the search function
-- ============================================

-- ----------------------------------------
-- RPC: match_conversations
-- ----------------------------------------
-- Semantic search over conversation 128w summary embeddings.
-- Follows the same pattern as match_thoughts in the core schema.
-- Scoped to a single user via p_user_id (NULL = no filter, for single-user setups).

CREATE OR REPLACE FUNCTION match_conversations(
    query_embedding vector(1536),
    match_threshold float DEFAULT 0.5,
    match_count int DEFAULT 10,
    p_user_id uuid DEFAULT NULL
)
RETURNS TABLE (
    id uuid,
    chatgpt_id text,
    title text,
    conversation_type text,
    create_time timestamptz,
    summary_8w text,
    summary_16w text,
    summary_32w text,
    summary_64w text,
    summary_128w text,
    key_topics text[],
    people_mentioned text[],
    conversation_url text,
    similarity float
)
LANGUAGE plpgsql
AS $$
BEGIN
    RETURN QUERY
    SELECT
        c.id, c.chatgpt_id, c.title, c.conversation_type, c.create_time,
        c.summary_8w, c.summary_16w, c.summary_32w, c.summary_64w, c.summary_128w,
        c.key_topics, c.people_mentioned, c.conversation_url,
        (1 - (c.embedding <=> query_embedding))::float AS similarity
    FROM chatgpt_conversations c
    WHERE 1 - (c.embedding <=> query_embedding) >= match_threshold
      AND (p_user_id IS NULL OR c.user_id = p_user_id)
    ORDER BY c.embedding <=> query_embedding
    LIMIT match_count;
END;
$$;

-- Grant execute on the RPC function to service_role
GRANT EXECUTE ON FUNCTION match_conversations(vector, float, int, uuid) TO service_role;
