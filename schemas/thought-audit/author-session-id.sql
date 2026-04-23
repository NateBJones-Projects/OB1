-- ============================================================
-- author_session_id — multi-participant attribution helper
--
-- This is a CONVENTION, not a schema change. It lives entirely in
-- the existing thoughts.metadata JSONB column. This file is two
-- small helper views/functions for querying by session, plus
-- documentation via COMMENT ON.
--
-- Convention:
--   thoughts.metadata.author_session_id — short opaque string
--     generated at session start by the capturing agent. Groups
--     all writes from the same live session (Claude Desktop chat,
--     a Codex run, a ChatGPT conversation, an import job).
--
--   thoughts.metadata.source — short hyphenated tag identifying
--     the agent or integration (e.g. "claude-code-live",
--     "chatgpt-api", "codex-cli").
--
-- Both fields are optional. Nothing breaks if they are missing —
-- this is purely additive.
-- ============================================================

-- Helper view: flatten author_session_id / source out of metadata
-- for the common "what did this session do" query. Safe to create
-- more than once.
CREATE OR REPLACE VIEW thought_provenance AS
SELECT
  t.id,
  t.created_at,
  t.updated_at,
  (t.metadata ->> 'source')            AS source,
  (t.metadata ->> 'author_session_id') AS author_session_id,
  t.content
FROM public.thoughts t;

COMMENT ON VIEW thought_provenance IS
  'Convenience projection that surfaces metadata.source and metadata.author_session_id as top-level columns. Read-only; no effect on the underlying thoughts table.';

-- Helper RPC: list all thoughts in a given session, newest first.
CREATE OR REPLACE FUNCTION thoughts_by_session(p_session_id TEXT)
RETURNS TABLE (
  id                UUID,
  created_at        TIMESTAMPTZ,
  source            TEXT,
  content           TEXT
)
LANGUAGE sql
STABLE
AS $$
  SELECT
    t.id,
    t.created_at,
    (t.metadata ->> 'source') AS source,
    t.content
  FROM public.thoughts t
  WHERE (t.metadata ->> 'author_session_id') = p_session_id
  ORDER BY t.created_at DESC;
$$;

COMMENT ON FUNCTION thoughts_by_session(TEXT) IS
  'Return all thoughts tagged with metadata.author_session_id = p_session_id, newest first. Used to reconstruct the writes from a single agent session.';
