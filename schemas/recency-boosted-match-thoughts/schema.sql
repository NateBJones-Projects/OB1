-- ============================================================
-- match_thoughts_recency — recency-boosted variant of match_thoughts
--
-- Problem:
--   The core match_thoughts RPC (from the getting-started guide)
--   ranks purely by cosine similarity. For a growing Open Brain,
--   this means very old thoughts that happen to be vector-nearest
--   outrank newer, arguably more relevant thoughts of similar
--   quality. For an evergreen personal memory that can stay as-is,
--   but for an active task-tracking or daily-context brain, a
--   gentle recency preference produces visibly better results.
--
-- Solution:
--   A separate RPC, match_thoughts_recency, that returns the same
--   columns as match_thoughts but blends similarity with an
--   exponential recency decay. The ORIGINAL match_thoughts is
--   NOT replaced — callers opt into the new variant by name.
--
-- Formula:
--   recency_factor = exp(-age_days / half_life_days)
--   final_score    = similarity * (1 - recency_weight)
--                  + recency_factor * recency_weight
--
-- Defaults are deliberately backward-compatible:
--   recency_weight  = 0    → final_score = similarity (identical ranking)
--   half_life_days  = 90   → ignored while recency_weight = 0
--
-- Set recency_weight to e.g. 0.2 for a gentle nudge toward recent
-- thoughts, 0.5 for an even blend, 1.0 for pure recency ranking.
--
-- This file only adds a new function. No existing columns or
-- functions are altered. Safe to run more than once.
-- ============================================================

SET search_path TO public, extensions;

CREATE OR REPLACE FUNCTION match_thoughts_recency(
  query_embedding  vector(1536),
  match_threshold  float   DEFAULT 0.7,
  match_count      int     DEFAULT 10,
  filter           jsonb   DEFAULT '{}'::jsonb,
  recency_weight   float   DEFAULT 0.0,    -- 0 = disabled (same as match_thoughts)
  half_life_days   float   DEFAULT 90.0    -- only consulted when recency_weight > 0
)
RETURNS TABLE (
  id          uuid,
  content     text,
  metadata    jsonb,
  similarity  float,
  created_at  timestamptz
)
LANGUAGE plpgsql
STABLE
PARALLEL SAFE
AS $$
BEGIN
  -- Clamp inputs to sensible ranges. The CREATE OR REPLACE will not
  -- recurse, but an over-eager caller passing recency_weight = 5.0
  -- should not blow up the ranking — cap it at 1.0.
  IF recency_weight < 0.0 THEN recency_weight := 0.0; END IF;
  IF recency_weight > 1.0 THEN recency_weight := 1.0; END IF;
  IF half_life_days <= 0.0 THEN half_life_days := 90.0; END IF;

  RETURN QUERY
  SELECT
    t.id,
    t.content,
    t.metadata,
    -- Blended score: similarity * (1 - w) + recency_factor * w
    -- recency_factor = exp(-age_days / half_life_days)
    -- age_days comes from extract(epoch) converted to days.
    (
      (1 - (t.embedding <=> query_embedding)) * (1.0 - recency_weight)
      +
      exp(
        -GREATEST(
          extract(epoch FROM (now() - t.created_at)) / 86400.0,
          0.0
        ) / half_life_days
      ) * recency_weight
    )::float AS similarity,
    t.created_at
  FROM public.thoughts t
  WHERE
    -- Threshold gates on the RAW cosine similarity so its semantics
    -- stay consistent with the core match_thoughts RPC. Without this,
    -- a high recency weight would let completely irrelevant recent
    -- thoughts surface.
    (1 - (t.embedding <=> query_embedding)) >= match_threshold
    -- Metadata containment filter — empty '{}' matches everything.
    AND (filter = '{}'::jsonb OR t.metadata @> filter)
  ORDER BY
    -- Order by the same blended score returned in the similarity
    -- column, so the client gets results ranked exactly as the
    -- similarity value implies.
    (
      (1 - (t.embedding <=> query_embedding)) * (1.0 - recency_weight)
      +
      exp(
        -GREATEST(
          extract(epoch FROM (now() - t.created_at)) / 86400.0,
          0.0
        ) / half_life_days
      ) * recency_weight
    ) DESC
  LIMIT match_count;
END;
$$;

COMMENT ON FUNCTION match_thoughts_recency(vector(1536), float, int, jsonb, float, float) IS
  'Recency-boosted nearest-neighbor search. Blended score = similarity * (1 - recency_weight) + exp(-age_days/half_life_days) * recency_weight. recency_weight defaults to 0 (pure similarity, identical to match_thoughts). half_life_days defaults to 90. Threshold is applied on raw cosine similarity before the blend. Returns the same columns as match_thoughts.';
