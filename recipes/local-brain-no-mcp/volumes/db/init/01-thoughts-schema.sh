#!/bin/bash
# local-brain-no-mcp -- thoughts schema init (idempotent)
#
# Runs once on first boot of the Postgres container (Docker entrypoint).
# Substitutes ${EMBED_DIM} from the container environment into the vector
# column dimension. Once the table exists with a given dim, the dim is fixed
# until the Postgres volume is wiped -- pgvector will reject inserts of a
# different-sized vector.
#
# This mirrors docs/drafts/agent-memory-staging-base.sql (the canonical OB1
# thoughts schema) so that cloud-shaped recipes work against this local stack
# with a base-URL swap. The only deviation is the parameterized embedding
# dimension.

set -e

: "${EMBED_DIM:?EMBED_DIM not set -- check supabase-docker/docker/.env}"
: "${POSTGRES_USER:?POSTGRES_USER not set by entrypoint}"
: "${POSTGRES_DB:?POSTGRES_DB not set by entrypoint}"

echo "  [init/01] creating thoughts schema with embedding vector(${EMBED_DIM})..."

psql -v ON_ERROR_STOP=1 \
     -v embed_dim="${EMBED_DIM}" \
     --username "$POSTGRES_USER" \
     --dbname   "$POSTGRES_DB" <<'EOSQL'

CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS public.thoughts (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  content TEXT NOT NULL,
  embedding vector(:embed_dim),
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  content_fingerprint TEXT
);

CREATE INDEX IF NOT EXISTS thoughts_embedding_hnsw_idx
  ON public.thoughts
  USING hnsw (embedding vector_cosine_ops);

CREATE INDEX IF NOT EXISTS thoughts_metadata_gin_idx
  ON public.thoughts USING gin (metadata);

CREATE INDEX IF NOT EXISTS thoughts_created_at_desc_idx
  ON public.thoughts (created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS idx_thoughts_fingerprint
  ON public.thoughts (content_fingerprint)
  WHERE content_fingerprint IS NOT NULL;

CREATE OR REPLACE FUNCTION public.update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS thoughts_updated_at ON public.thoughts;
CREATE TRIGGER thoughts_updated_at
  BEFORE UPDATE ON public.thoughts
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at();

ALTER TABLE public.thoughts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role full access" ON public.thoughts;
CREATE POLICY "Service role full access"
  ON public.thoughts
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.thoughts TO service_role;

EOSQL

echo "  [init/01] done."
