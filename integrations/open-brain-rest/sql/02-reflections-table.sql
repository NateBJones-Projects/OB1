-- 02-reflections-table.sql
-- Creates the reflections table for storing structured reasoning about thoughts.
-- All foreign keys reference thoughts(serial_id), not thoughts(id).

CREATE TABLE IF NOT EXISTS reflections (
  id BIGSERIAL PRIMARY KEY,
  thought_id BIGINT NOT NULL REFERENCES thoughts(serial_id) ON DELETE CASCADE,
  trigger_context TEXT NOT NULL,
  options JSONB NOT NULL DEFAULT '[]'::jsonb,
  factors JSONB NOT NULL DEFAULT '[]'::jsonb,
  conclusion TEXT NOT NULL DEFAULT '',
  confidence NUMERIC(3,2) DEFAULT 0.5,
  reflection_type TEXT NOT NULL DEFAULT 'general',
  embedding vector(1536),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_reflections_thought_id ON reflections (thought_id);
CREATE INDEX IF NOT EXISTS idx_reflections_reflection_type ON reflections (reflection_type);
CREATE INDEX IF NOT EXISTS idx_reflections_created_at ON reflections (created_at);

-- Permissions
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.reflections TO service_role;
GRANT USAGE, SELECT ON SEQUENCE reflections_id_seq TO service_role;
