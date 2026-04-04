-- 01-schema-extensions.sql
-- Adds serial_id surrogate key and REST API columns to the thoughts table.
-- Idempotent: safe to run multiple times on both UUID and BIGSERIAL id variants.

-- Step 1: Add serial_id column if it doesn't exist
ALTER TABLE thoughts ADD COLUMN IF NOT EXISTS serial_id BIGINT;

-- Step 2: Backfill serial_id based on the type of thoughts.id
DO $$
DECLARE
  v_data_type TEXT;
  v_max BIGINT;
BEGIN
  -- Detect the data type of thoughts.id
  SELECT data_type INTO v_data_type
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name = 'thoughts'
    AND column_name = 'id';

  IF v_data_type IN ('integer', 'bigint') THEN
    -- Integer-based id: copy directly
    UPDATE thoughts SET serial_id = id WHERE serial_id IS NULL;
  ELSE
    -- UUID-based id: assign deterministic sequential numbers
    WITH numbered AS (
      SELECT id, ROW_NUMBER() OVER (ORDER BY created_at, id) AS rn
      FROM thoughts
      WHERE serial_id IS NULL
    )
    UPDATE thoughts t
    SET serial_id = (
      SELECT n.rn + COALESCE((SELECT MAX(serial_id) FROM thoughts WHERE serial_id IS NOT NULL), 0)
      FROM numbered n
      WHERE n.id = t.id
    )
    WHERE t.serial_id IS NULL;
  END IF;

  -- Step 3: Create sequence and wire it up
  IF NOT EXISTS (
    SELECT 1 FROM pg_class WHERE relname = 'thoughts_serial_id_seq' AND relkind = 'S'
  ) THEN
    CREATE SEQUENCE thoughts_serial_id_seq;
  END IF;

  SELECT COALESCE(MAX(serial_id), 0) INTO v_max FROM thoughts;
  PERFORM setval('thoughts_serial_id_seq', GREATEST(v_max, 1));

  -- Set column default to use the sequence
  ALTER TABLE thoughts ALTER COLUMN serial_id SET DEFAULT nextval('thoughts_serial_id_seq');
END $$;

-- Step 4: Add UNIQUE constraint (idempotent via IF NOT EXISTS on the index)
CREATE UNIQUE INDEX IF NOT EXISTS idx_thoughts_serial_id_unique ON thoughts (serial_id);

-- Step 5: Ensure NOT NULL
ALTER TABLE thoughts ALTER COLUMN serial_id SET NOT NULL;

-- Step 6: Add additional columns
ALTER TABLE thoughts ADD COLUMN IF NOT EXISTS type TEXT DEFAULT 'idea';
ALTER TABLE thoughts ADD COLUMN IF NOT EXISTS importance SMALLINT DEFAULT 3;
ALTER TABLE thoughts ADD COLUMN IF NOT EXISTS quality_score NUMERIC(5,2) DEFAULT 50;
ALTER TABLE thoughts ADD COLUMN IF NOT EXISTS sensitivity_tier TEXT DEFAULT 'standard';
ALTER TABLE thoughts ADD COLUMN IF NOT EXISTS source_type TEXT DEFAULT 'mcp';
ALTER TABLE thoughts ADD COLUMN IF NOT EXISTS content_fingerprint TEXT;
ALTER TABLE thoughts ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();

-- Step 7: Add indexes
CREATE INDEX IF NOT EXISTS idx_thoughts_type ON thoughts (type);
CREATE INDEX IF NOT EXISTS idx_thoughts_importance ON thoughts (importance);
CREATE INDEX IF NOT EXISTS idx_thoughts_sensitivity ON thoughts (sensitivity_tier);
CREATE INDEX IF NOT EXISTS idx_thoughts_fingerprint ON thoughts (content_fingerprint);
CREATE INDEX IF NOT EXISTS idx_thoughts_serial_id ON thoughts (serial_id);

-- Step 8: Grant permissions
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.thoughts TO service_role;
GRANT USAGE, SELECT ON SEQUENCE thoughts_serial_id_seq TO service_role;
