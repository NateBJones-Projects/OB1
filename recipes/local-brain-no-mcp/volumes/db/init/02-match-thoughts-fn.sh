#!/bin/bash
# local-brain-no-mcp -- match_thoughts RPC (idempotent)
#
# Mirrors the canonical match_thoughts signature so PostgREST exposes
# `/rest/v1/rpc/match_thoughts` with the same shape as cloud OB1. The Edge
# Functions in this recipe DON'T call this directly via PostgREST -- they
# invoke it as a plain plpgsql function from inside a service-role
# connection -- but exposing it via PostgREST means cloud-shaped clients
# can use it too if you ever drop RLS.

set -e

: "${EMBED_DIM:?EMBED_DIM not set}"
: "${POSTGRES_USER:?POSTGRES_USER not set}"
: "${POSTGRES_DB:?POSTGRES_DB not set}"

echo "  [init/02] creating match_thoughts(vector(${EMBED_DIM}), ...) ..."

psql -v ON_ERROR_STOP=1 \
     -v embed_dim="${EMBED_DIM}" \
     --username "$POSTGRES_USER" \
     --dbname   "$POSTGRES_DB" <<'EOSQL'

CREATE OR REPLACE FUNCTION public.match_thoughts(
  query_embedding vector(:embed_dim),
  match_threshold FLOAT DEFAULT 0.7,
  match_count INT DEFAULT 10,
  filter JSONB DEFAULT '{}'::jsonb
)
RETURNS TABLE (
  id UUID,
  content TEXT,
  metadata JSONB,
  similarity FLOAT,
  created_at TIMESTAMPTZ
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT
    t.id,
    t.content,
    t.metadata,
    1 - (t.embedding <=> query_embedding) AS similarity,
    t.created_at
  FROM public.thoughts t
  WHERE 1 - (t.embedding <=> query_embedding) > match_threshold
    AND (filter = '{}'::jsonb OR t.metadata @> filter)
  ORDER BY t.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;

GRANT EXECUTE ON FUNCTION public.match_thoughts(vector, FLOAT, INT, JSONB) TO service_role;

CREATE OR REPLACE FUNCTION public.upsert_thought(
  p_content TEXT,
  p_embedding vector(:embed_dim),
  p_metadata JSONB DEFAULT '{}'::jsonb
)
RETURNS JSONB AS $$
DECLARE
  v_fingerprint TEXT;
  v_id UUID;
BEGIN
  v_fingerprint := encode(sha256(convert_to(
    lower(trim(regexp_replace(p_content, '\s+', ' ', 'g'))),
    'UTF8'
  )), 'hex');

  INSERT INTO public.thoughts (content, embedding, content_fingerprint, metadata)
  VALUES (p_content, p_embedding, v_fingerprint, p_metadata)
  ON CONFLICT (content_fingerprint) WHERE content_fingerprint IS NOT NULL DO UPDATE
    SET updated_at = now(),
        metadata   = public.thoughts.metadata || EXCLUDED.metadata
  RETURNING id INTO v_id;

  RETURN jsonb_build_object('id', v_id, 'fingerprint', v_fingerprint);
END;
$$ LANGUAGE plpgsql;

GRANT EXECUTE ON FUNCTION public.upsert_thought(TEXT, vector, JSONB) TO service_role;

NOTIFY pgrst, 'reload schema';

EOSQL

echo "  [init/02] done."
