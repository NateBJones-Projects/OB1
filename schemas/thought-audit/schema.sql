-- ============================================================
-- Thought Audit — append-only log of every capture / update / delete
--
-- Rationale: once more than one participant writes to the same Open
-- Brain (Claude Desktop, Codex, ChatGPT via API, background workers),
-- "who changed what, and when" becomes an operational question.
-- This schema is the answer — an append-only table plus a metadata
-- convention (author_session_id) that ties related writes together.
--
-- All changes are additive. No existing thoughts columns are altered
-- or dropped. No existing functions are replaced.
--
-- Deliberate NON foreign key: thought_audit.thought_id has no FK
-- reference to thoughts(id). Audit rows MUST survive deletion of the
-- thought they describe — the delete itself is the most important
-- audit event to preserve.
--
-- Safe to run more than once (fully idempotent).
-- ============================================================

CREATE TABLE IF NOT EXISTS thought_audit (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),

  -- The affected thought's UUID. NOT a foreign key — audit rows must
  -- outlive the thoughts they describe (most importantly for delete
  -- events).
  thought_id        UUID        NOT NULL,

  -- Operation type. Constrained to the three mutation verbs.
  action            TEXT        NOT NULL
    CHECK (action IN ('capture', 'update', 'delete')),

  -- Source tag from metadata.source (or the request body) at the time
  -- of the mutation. Duplicated here so "what did claude-code-live
  -- change this week" queries work without joining on the (possibly
  -- deleted) thoughts row.
  --
  -- Source is an open string, not an enum — the convention used by the
  -- reference integrations is a short dotted tag. Examples in use:
  --   claude-desktop
  --   claude-code-live
  --   chatgpt-live
  --   chatgpt-api
  --   codex-cli
  --   ingest-worker
  -- Feel free to add your own. Keep them hyphen-separated lowercase.
  source            TEXT,

  -- Opaque participant session id. Enables "cluster all writes from
  -- this agent session" queries. NULL when the caller did not supply
  -- one (expected for legacy traffic and for tools that do not yet
  -- use the multi-participant convention).
  author_session_id TEXT,

  -- For `update`: a compact before/after diff of the content and
  -- metadata keys that actually changed.
  -- For `delete`: the full prior content preserved under
  --   diff.previous_content and prior metadata under
  --   diff.previous_metadata, so the row is recoverable from the
  --   audit trail alone.
  -- For `capture`: typically empty or a small metadata summary.
  diff              JSONB,

  -- Free-form contextual info (tool name, MCP client hint, extra
  -- tags). Optional — analytical use only.
  actor_context     JSONB,

  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Comments for dbdocs / Supabase UI
COMMENT ON TABLE thought_audit IS
  'Append-only audit log of every capture/update/delete on the thoughts table. thought_id is deliberately NOT an FK to thoughts(id) so audit rows survive deletion of their subject. Writes are fire-and-forget from the MCP server or ingest worker — failures here never block the main operation.';

COMMENT ON COLUMN thought_audit.thought_id IS
  'UUID of the affected thought. NOT a foreign key — audit rows outlive the thoughts they describe.';

COMMENT ON COLUMN thought_audit.action IS
  'Mutation verb: capture | update | delete.';

COMMENT ON COLUMN thought_audit.source IS
  'Source tag at time of mutation (e.g. claude-desktop, chatgpt-api, codex-cli). Duplicated from metadata.source so audit queries do not need to join thoughts.';

COMMENT ON COLUMN thought_audit.author_session_id IS
  'Opaque participant session identifier at time of mutation. NULL for legacy traffic that predates the multi-participant convention.';

COMMENT ON COLUMN thought_audit.diff IS
  'For update: before/after of changed fields. For delete: previous_content and previous_metadata preserved for recovery. For capture: post-insert metadata summary.';

COMMENT ON COLUMN thought_audit.actor_context IS
  'Optional free-form analytical metadata (tool name, MCP client hint, etc.).';

-- Indexes: the three most common audit access patterns.
CREATE INDEX IF NOT EXISTS thought_audit_thought_id_idx
  ON thought_audit (thought_id);

CREATE INDEX IF NOT EXISTS thought_audit_session_id_idx
  ON thought_audit (author_session_id)
  WHERE author_session_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS thought_audit_created_at_idx
  ON thought_audit (created_at DESC);

-- Match the project convention — service role bypasses RLS automatically.
ALTER TABLE thought_audit ENABLE ROW LEVEL SECURITY;

-- Supabase no longer auto-grants CRUD on new tables to service_role.
-- Grant explicitly so the MCP server can write audit rows.
GRANT SELECT, INSERT ON TABLE public.thought_audit TO service_role;

-- The audit table is append-only by intent. We do NOT grant UPDATE or
-- DELETE, so nothing — not even a buggy Edge Function — can rewrite
-- history. If you need to prune old rows, do it explicitly from a
-- migration after a conscious decision.
