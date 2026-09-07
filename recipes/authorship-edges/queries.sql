-- queries.sql — the "what I said vs. what a machine generated" query layer.
--
-- These read the attribution that the authorship layer records in two places:
--   1. thought_entities author edges  -> the structural "I authored this" link
--   2. metadata.attribution            -> the per-thought label (self/other/mixed/machine/unknown)
--
-- Replace :self_entity_id with your entities.id (the value getSelfEntityId() resolved).

-- 1) Everything you authored or participated in, via the author edge.
SELECT t.id, left(t.content, 120) AS preview, te.mention_role, t.created_at
FROM thoughts t
JOIN thought_entities te ON te.thought_id = t.id
WHERE te.entity_id = :self_entity_id
  AND te.mention_role IN ('author', 'participant')
ORDER BY t.created_at DESC;

-- 2) Things YOU actually said (excludes anything a device/model generated).
SELECT id, left(content, 120) AS preview, metadata->>'attribution' AS attribution, created_at
FROM thoughts
WHERE metadata->>'attribution' IN ('self', 'mixed')
ORDER BY created_at DESC;

-- 3) Machine-generated atoms only (device summaries, extracted action items, titles).
SELECT id, left(content, 120) AS preview, metadata->>'generator' AS generator, created_at
FROM thoughts
WHERE metadata->>'attribution' = 'machine'
ORDER BY created_at DESC;

-- 4) Attribution breakdown across the brain.
SELECT metadata->>'attribution' AS attribution, count(*)
FROM thoughts
WHERE metadata ? 'attribution'
GROUP BY 1
ORDER BY 2 DESC;

-- 5) Optional convenience view: your own speech, ready to query/join.
CREATE OR REPLACE VIEW v_my_speech AS
SELECT *
FROM thoughts
WHERE metadata->>'attribution' IN ('self', 'mixed');

-- 6) Optional: filter a semantic-search result set down to your own words by
--    excluding machine-generated rows (drop them, or down-rank in your app):
--    ... FROM match_thoughts(:embedding, ...) m
--    WHERE m.metadata->>'attribution' IS DISTINCT FROM 'machine';
