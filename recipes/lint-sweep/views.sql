-- lint-sweep views.sql
--
-- OPTIONAL: SQL views that let you run the Tier 1 checks directly in
-- Supabase Studio or psql without installing the Node.js script. Apply
-- once; they become queryable read-only views over `public.thoughts`
-- (and optionally `public.entities` / `public.thought_entities`).
--
-- Safety: VIEWS ONLY. No destructive DDL, no data modification. Run in
-- the Supabase SQL editor as the project owner. To remove a view later,
-- use "DROP VIEW IF EXISTS <view_name> CASCADE;" from the SQL editor.

-- 1. Orphans by tag — thoughts with no topics, tags, or people in metadata
CREATE OR REPLACE VIEW lint_orphans_by_tag AS
SELECT
  id,
  created_at,
  importance,
  left(content, 160) AS preview,
  source_type
FROM public.thoughts
WHERE COALESCE(jsonb_array_length(metadata->'topics'), 0) = 0
  AND COALESCE(jsonb_array_length(metadata->'tags'),   0) = 0
  AND COALESCE(jsonb_array_length(metadata->'people'), 0) = 0
ORDER BY id DESC;

COMMENT ON VIEW lint_orphans_by_tag IS
  'Lint: thoughts with no topics/tags/people tags in metadata.';

-- 2. Over-tagged thoughts — usually import noise
CREATE OR REPLACE VIEW lint_over_tagged AS
SELECT
  id,
  created_at,
  jsonb_array_length(metadata->'tags') AS tag_count,
  left(content, 160) AS preview
FROM public.thoughts
WHERE COALESCE(jsonb_array_length(metadata->'tags'), 0) > 10
ORDER BY tag_count DESC;

COMMENT ON VIEW lint_over_tagged IS
  'Lint: thoughts with more than 10 tags — commonly import noise.';

-- 3. Empty-content thoughts — captured but never populated
CREATE OR REPLACE VIEW lint_empty_content AS
SELECT id, created_at, source_type, importance
FROM public.thoughts
WHERE content IS NULL
   OR btrim(content) = ''
ORDER BY id DESC;

COMMENT ON VIEW lint_empty_content IS 'Lint: thoughts with empty content.';

-- 4. Very long content — usually unchunked dumps
CREATE OR REPLACE VIEW lint_very_long AS
SELECT
  id,
  created_at,
  length(content) AS chars,
  left(content, 200) AS preview
FROM public.thoughts
WHERE length(content) > 20000
ORDER BY chars DESC;

COMMENT ON VIEW lint_very_long IS
  'Lint: thoughts over 20k characters — usually unchunked dumps.';

-- 5. Low-signal noise — importance <= 2 and content under 40 chars
CREATE OR REPLACE VIEW lint_low_signal AS
SELECT id, created_at, importance, content
FROM public.thoughts
WHERE importance IS NOT NULL
  AND importance <= 2
  AND length(COALESCE(btrim(content), '')) < 40
ORDER BY id DESC;

COMMENT ON VIEW lint_low_signal IS
  'Lint: importance <= 2 AND content under 40 chars.';

-- 6. Duplicate fingerprint groups — only meaningful if content_fingerprint
--    is populated (see recipes/content-fingerprint-dedup). Safe to create
--    even if the column is missing — the view definition will fail, but
--    you can skip this one.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = 'thoughts'
      AND column_name  = 'content_fingerprint'
  ) THEN
    EXECUTE $v$
      CREATE OR REPLACE VIEW lint_exact_duplicates AS
      SELECT
        content_fingerprint,
        count(*)       AS copies,
        array_agg(id ORDER BY id) AS ids
      FROM public.thoughts
      WHERE content_fingerprint IS NOT NULL
      GROUP BY content_fingerprint
      HAVING count(*) > 1
      ORDER BY copies DESC;

      COMMENT ON VIEW lint_exact_duplicates IS
        'Lint: fingerprint collisions — rows with identical content_fingerprint.';
    $v$;
  END IF;
END $$;

-- 7. High-importance thoughts with no graph links. Requires the
--    public.thought_entities table from the `entity-extraction` schema
--    (see PRs #197 and #199), NOT the `ob-graph` recipe (which uses
--    different table names: graph_nodes / graph_edges). Skipped silently
--    when `thought_entities` is missing.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name   = 'thought_entities'
  ) THEN
    EXECUTE $v$
      CREATE OR REPLACE VIEW lint_high_importance_isolated AS
      SELECT
        t.id,
        t.created_at,
        t.importance,
        left(t.content, 200) AS preview
      FROM public.thoughts t
      LEFT JOIN public.thought_entities te ON te.thought_id = t.id
      WHERE t.importance >= 4
        AND te.thought_id IS NULL
      ORDER BY t.importance DESC, t.id DESC;

      COMMENT ON VIEW lint_high_importance_isolated IS
        'Lint: importance >= 4 thoughts with zero entity links.';
    $v$;
  END IF;
END $$;
