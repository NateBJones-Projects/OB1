-- OB1 Per-Agent Identity
-- Optional identity primitive for multi-agent Open Brain deployments.
--
-- This schema lets a deployment issue opaque per-agent memory keys while
-- storing only SHA-256 hashes in Postgres. Server code presents a hash to the
-- SECURITY DEFINER lookup RPC and receives the stable authenticated agent id.

BEGIN;

CREATE TABLE IF NOT EXISTS public.openbrain_agents (
  canonical_agent_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  label TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.agent_memory_keys (
  key_hash TEXT PRIMARY KEY,
  canonical_agent_id UUID NOT NULL REFERENCES public.openbrain_agents(canonical_agent_id) ON DELETE CASCADE,
  label TEXT,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  CHECK (length(key_hash) = 64),
  CHECK (key_hash = lower(key_hash)),
  CHECK (revoked_at IS NULL OR active = false)
);

CREATE INDEX IF NOT EXISTS idx_agent_memory_keys_agent
  ON public.agent_memory_keys (canonical_agent_id);

CREATE INDEX IF NOT EXISTS idx_agent_memory_keys_active
  ON public.agent_memory_keys (active)
  WHERE active = true AND revoked_at IS NULL;

CREATE OR REPLACE FUNCTION public.openbrain_agents_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_openbrain_agents_updated_at ON public.openbrain_agents;
CREATE TRIGGER trg_openbrain_agents_updated_at
  BEFORE UPDATE ON public.openbrain_agents
  FOR EACH ROW EXECUTE FUNCTION public.openbrain_agents_set_updated_at();

CREATE OR REPLACE FUNCTION public.lookup_agent_memory_key(p_key_hash TEXT)
RETURNS TABLE (
  canonical_agent_id UUID,
  agent_label TEXT,
  key_label TEXT
) AS $$
BEGIN
  IF p_key_hash IS NULL OR length(trim(p_key_hash)) <> 64 THEN
    RETURN;
  END IF;

  RETURN QUERY
  UPDATE public.agent_memory_keys k
     SET last_used_at = now()
    FROM public.openbrain_agents a
   WHERE k.canonical_agent_id = a.canonical_agent_id
     AND k.key_hash = lower(trim(p_key_hash))
     AND k.active = true
     AND k.revoked_at IS NULL
   RETURNING a.canonical_agent_id, a.label, k.label;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE ALL ON FUNCTION public.lookup_agent_memory_key(TEXT) FROM PUBLIC;

ALTER TABLE public.openbrain_agents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_memory_keys ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS openbrain_agents_service_role_all ON public.openbrain_agents;
CREATE POLICY openbrain_agents_service_role_all ON public.openbrain_agents
  FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS agent_memory_keys_service_role_all ON public.agent_memory_keys;
CREATE POLICY agent_memory_keys_service_role_all ON public.agent_memory_keys
  FOR ALL TO service_role USING (true) WITH CHECK (true);

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.openbrain_agents TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.agent_memory_keys TO service_role;
GRANT EXECUTE ON FUNCTION public.lookup_agent_memory_key(TEXT) TO service_role;

COMMIT;
