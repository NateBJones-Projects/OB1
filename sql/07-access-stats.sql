-- =============================================================
-- Access Stats for Knowledge Lint
-- Run AFTER the base OB1 schema (steps 01-05)
-- Run: Supabase SQL Editor → New query → paste and Run
-- =============================================================

CREATE TABLE access_stats (
  thought_id UUID PRIMARY KEY REFERENCES thoughts(id) ON DELETE CASCADE,
  access_count INTEGER DEFAULT 0,
  last_accessed TIMESTAMPTZ DEFAULT now(),
  last_reviewed TIMESTAMPTZ,
  archived_at TIMESTAMPTZ
);

ALTER TABLE access_stats ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access" ON access_stats FOR ALL
  USING (auth.role() = 'service_role');
GRANT ALL ON TABLE access_stats TO service_role;
