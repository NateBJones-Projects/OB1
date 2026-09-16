-- ============================================
-- Work Operating Model Activation
-- ============================================
-- Structured storage for conversation-first work elicitation.
-- This recipe stores one durable profile per user, versioned sessions,
-- approved layer checkpoints, canonical entries, and export snapshots.
--
-- Run this in your Supabase SQL Editor.
-- ============================================

CREATE OR REPLACE FUNCTION update_work_operating_model_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TABLE IF NOT EXISTS operating_model_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE,
  current_version INTEGER NOT NULL DEFAULT 0 CHECK (current_version >= 0),
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'active', 'archived')),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS operating_model_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id UUID NOT NULL REFERENCES operating_model_profiles(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  profile_version INTEGER NOT NULL CHECK (profile_version > 0),
  session_name TEXT,
  status TEXT NOT NULL DEFAULT 'in_progress'
    CHECK (status IN ('in_progress', 'review_ready', 'completed', 'abandoned')),
  current_layer TEXT NOT NULL DEFAULT 'operating_rhythms'
    CHECK (current_layer IN (
      'operating_rhythms',
      'recurring_decisions',
      'dependencies',
      'institutional_knowledge',
      'friction',
      'review',
      'complete'
    )),
  completed_layers TEXT[] NOT NULL DEFAULT '{}',
  resume_metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS operating_model_layer_checkpoints (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id UUID NOT NULL REFERENCES operating_model_profiles(id) ON DELETE CASCADE,
  session_id UUID NOT NULL REFERENCES operating_model_sessions(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  profile_version INTEGER NOT NULL CHECK (profile_version > 0),
  layer TEXT NOT NULL
    CHECK (layer IN (
      'operating_rhythms',
      'recurring_decisions',
      'dependencies',
      'institutional_knowledge',
      'friction'
    )),
  checkpoint_summary TEXT NOT NULL,
  normalized_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'approved'
    CHECK (status IN ('draft', 'approved', 'superseded')),
  approved_at TIMESTAMPTZ,
  last_validated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (session_id, layer)
);

CREATE TABLE IF NOT EXISTS operating_model_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id UUID NOT NULL REFERENCES operating_model_profiles(id) ON DELETE CASCADE,
  session_id UUID NOT NULL REFERENCES operating_model_sessions(id) ON DELETE CASCADE,
  checkpoint_id UUID NOT NULL REFERENCES operating_model_layer_checkpoints(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  profile_version INTEGER NOT NULL CHECK (profile_version > 0),
  layer TEXT NOT NULL
    CHECK (layer IN (
      'operating_rhythms',
      'recurring_decisions',
      'dependencies',
      'institutional_knowledge',
      'friction'
    )),
  entry_order INTEGER NOT NULL DEFAULT 0,
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  cadence TEXT,
  trigger TEXT,
  inputs TEXT[] NOT NULL DEFAULT '{}',
  stakeholders TEXT[] NOT NULL DEFAULT '{}',
  constraints TEXT[] NOT NULL DEFAULT '{}',
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  source_confidence TEXT NOT NULL DEFAULT 'confirmed'
    CHECK (source_confidence IN ('confirmed', 'synthesized')),
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'unresolved', 'superseded')),
  last_validated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS operating_model_exports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id UUID NOT NULL REFERENCES operating_model_profiles(id) ON DELETE CASCADE,
  session_id UUID NOT NULL REFERENCES operating_model_sessions(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  profile_version INTEGER NOT NULL CHECK (profile_version > 0),
  artifact_name TEXT NOT NULL
    CHECK (artifact_name IN (
      'operating-model.json',
      'USER.md',
      'SOUL.md',
      'HEARTBEAT.md',
      'schedule-recommendations.json'
    )),
  content TEXT NOT NULL,
  content_type TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (session_id, artifact_name)
);

CREATE INDEX IF NOT EXISTS idx_omp_user_status
  ON operating_model_profiles(user_id, status);

CREATE INDEX IF NOT EXISTS idx_oms_user_status_version
  ON operating_model_sessions(user_id, status, profile_version DESC);

CREATE INDEX IF NOT EXISTS idx_oms_completed_layers
  ON operating_model_sessions USING GIN (completed_layers);

CREATE INDEX IF NOT EXISTS idx_omc_session_layer
  ON operating_model_layer_checkpoints(session_id, layer);

CREATE INDEX IF NOT EXISTS idx_omc_user_version
  ON operating_model_layer_checkpoints(user_id, profile_version DESC, layer);

CREATE INDEX IF NOT EXISTS idx_ome_user_version_layer
  ON operating_model_entries(user_id, profile_version DESC, layer, entry_order);

CREATE INDEX IF NOT EXISTS idx_ome_stakeholders
  ON operating_model_entries USING GIN (stakeholders);

CREATE INDEX IF NOT EXISTS idx_ome_inputs
  ON operating_model_entries USING GIN (inputs);

CREATE INDEX IF NOT EXISTS idx_ome_details
  ON operating_model_entries USING GIN (details);

CREATE INDEX IF NOT EXISTS idx_omx_session_artifact
  ON operating_model_exports(session_id, artifact_name);

ALTER TABLE operating_model_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE operating_model_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE operating_model_layer_checkpoints ENABLE ROW LEVEL SECURITY;
ALTER TABLE operating_model_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE operating_model_exports ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS operating_model_profiles_user_policy ON operating_model_profiles;
CREATE POLICY operating_model_profiles_user_policy ON operating_model_profiles
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS operating_model_sessions_user_policy ON operating_model_sessions;
CREATE POLICY operating_model_sessions_user_policy ON operating_model_sessions
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS operating_model_layer_checkpoints_user_policy ON operating_model_layer_checkpoints;
CREATE POLICY operating_model_layer_checkpoints_user_policy ON operating_model_layer_checkpoints
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS operating_model_entries_user_policy ON operating_model_entries;
CREATE POLICY operating_model_entries_user_policy ON operating_model_entries
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS operating_model_exports_user_policy ON operating_model_exports;
CREATE POLICY operating_model_exports_user_policy ON operating_model_exports
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.operating_model_profiles TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.operating_model_sessions TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.operating_model_layer_checkpoints TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.operating_model_entries TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.operating_model_exports TO service_role;

DROP TRIGGER IF EXISTS update_operating_model_profiles_updated_at ON operating_model_profiles;
CREATE TRIGGER update_operating_model_profiles_updated_at
  BEFORE UPDATE ON operating_model_profiles
  FOR EACH ROW
  EXECUTE FUNCTION update_work_operating_model_updated_at();

DROP TRIGGER IF EXISTS update_operating_model_sessions_updated_at ON operating_model_sessions;
CREATE TRIGGER update_operating_model_sessions_updated_at
  BEFORE UPDATE ON operating_model_sessions
  FOR EACH ROW
  EXECUTE FUNCTION update_work_operating_model_updated_at();

DROP TRIGGER IF EXISTS update_operating_model_layer_checkpoints_updated_at ON operating_model_layer_checkpoints;
CREATE TRIGGER update_operating_model_layer_checkpoints_updated_at
  BEFORE UPDATE ON operating_model_layer_checkpoints
  FOR EACH ROW
  EXECUTE FUNCTION update_work_operating_model_updated_at();

DROP TRIGGER IF EXISTS update_operating_model_entries_updated_at ON operating_model_entries;
CREATE TRIGGER update_operating_model_entries_updated_at
  BEFORE UPDATE ON operating_model_entries
  FOR EACH ROW
  EXECUTE FUNCTION update_work_operating_model_updated_at();

DROP TRIGGER IF EXISTS update_operating_model_exports_updated_at ON operating_model_exports;
CREATE TRIGGER update_operating_model_exports_updated_at
  BEFORE UPDATE ON operating_model_exports
  FOR EACH ROW
  EXECUTE FUNCTION update_work_operating_model_updated_at();

CREATE OR REPLACE FUNCTION operating_model_next_layer(p_completed_layers TEXT[])
RETURNS TEXT AS $$
DECLARE
  v_layers TEXT[] := ARRAY[
    'operating_rhythms',
    'recurring_decisions',
    'dependencies',
    'institutional_knowledge',
    'friction'
  ];
  v_layer TEXT;
BEGIN
  FOREACH v_layer IN ARRAY v_layers LOOP
    IF NOT v_layer = ANY(COALESCE(p_completed_layers, ARRAY[]::TEXT[])) THEN
      RETURN v_layer;
    END IF;
  END LOOP;

  RETURN 'review';
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION operating_model_start_session(
  p_user_id UUID,
  p_session_name TEXT DEFAULT NULL
)
RETURNS JSONB AS $$
DECLARE
  v_profile operating_model_profiles%ROWTYPE;
  v_session operating_model_sessions%ROWTYPE;
  v_session_checkpoints JSONB;
  v_latest_checkpoints JSONB;
  v_next_version INTEGER;
BEGIN
  INSERT INTO operating_model_profiles (user_id)
  VALUES (p_user_id)
  ON CONFLICT (user_id) DO UPDATE
    SET updated_at = now()
  RETURNING * INTO v_profile;

  SELECT *
  INTO v_session
  FROM operating_model_sessions
  WHERE user_id = p_user_id
    AND status IN ('in_progress', 'review_ready')
  ORDER BY created_at DESC
  LIMIT 1;

  IF v_session.id IS NULL THEN
    v_next_version := GREATEST(v_profile.current_version, 0) + 1;

    INSERT INTO operating_model_sessions (
      profile_id,
      user_id,
      profile_version,
      session_name,
      status,
      current_layer
    )
    VALUES (
      v_profile.id,
      p_user_id,
      v_next_version,
      p_session_name,
      'in_progress',
      'operating_rhythms'
    )
    RETURNING * INTO v_session;

    UPDATE operating_model_profiles
      SET status = 'draft',
          updated_at = now()
    WHERE id = v_profile.id
    RETURNING * INTO v_profile;
  END IF;

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'layer', c.layer,
        'checkpoint_summary', c.checkpoint_summary,
        'normalized_payload', c.normalized_payload,
        'last_validated_at', c.last_validated_at,
        'profile_version', c.profile_version
      )
      ORDER BY array_position(
        ARRAY[
          'operating_rhythms',
          'recurring_decisions',
          'dependencies',
          'institutional_knowledge',
          'friction'
        ],
        c.layer
      )
    ),
    '[]'::jsonb
  )
  INTO v_session_checkpoints
  FROM operating_model_layer_checkpoints c
  WHERE c.session_id = v_session.id
    AND c.status = 'approved';

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'layer', ranked.layer,
        'checkpoint_summary', ranked.checkpoint_summary,
        'normalized_payload', ranked.normalized_payload,
        'last_validated_at', ranked.last_validated_at,
        'profile_version', ranked.profile_version
      )
      ORDER BY array_position(
        ARRAY[
          'operating_rhythms',
          'recurring_decisions',
          'dependencies',
          'institutional_knowledge',
          'friction'
        ],
        ranked.layer
      )
    ),
    '[]'::jsonb
  )
  INTO v_latest_checkpoints
  FROM (
    SELECT DISTINCT ON (layer)
      layer,
      checkpoint_summary,
      normalized_payload,
      last_validated_at,
      profile_version
    FROM operating_model_layer_checkpoints
    WHERE user_id = p_user_id
      AND status = 'approved'
    ORDER BY layer, profile_version DESC, approved_at DESC NULLS LAST, updated_at DESC
  ) ranked;

  RETURN jsonb_build_object(
    'profile_id', v_profile.id,
    'profile_status', v_profile.status,
    'current_version', v_profile.current_version,
    'session_id', v_session.id,
    'session_status', v_session.status,
    'session_version', v_session.profile_version,
    'completed_layers', to_jsonb(COALESCE(v_session.completed_layers, ARRAY[]::TEXT[])),
    'pending_layer', COALESCE(v_session.current_layer, operating_model_next_layer(v_session.completed_layers)),
    'session_checkpoints', v_session_checkpoints,
    'latest_checkpoints', v_latest_checkpoints
  );
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION operating_model_save_layer(
  p_session_id UUID,
  p_layer TEXT,
  p_checkpoint_summary TEXT,
  p_entries JSONB
)
RETURNS JSONB AS $$
DECLARE
  v_session operating_model_sessions%ROWTYPE;
  v_profile operating_model_profiles%ROWTYPE;
  v_checkpoint_id UUID;
  v_completed_layers TEXT[];
  v_pending_layer TEXT;
  v_saved_entries JSONB;
  v_layers TEXT[] := ARRAY[
    'operating_rhythms',
    'recurring_decisions',
    'dependencies',
    'institutional_knowledge',
    'friction'
  ];
BEGIN
  IF NOT p_layer = ANY(v_layers) THEN
    RAISE EXCEPTION 'Invalid layer: %', p_layer;
  END IF;

  IF jsonb_typeof(COALESCE(p_entries, '[]'::jsonb)) <> 'array' THEN
    RAISE EXCEPTION 'Entries payload must be a JSON array';
  END IF;

  SELECT *
  INTO v_session
  FROM operating_model_sessions
  WHERE id = p_session_id
  FOR UPDATE;

  IF v_session.id IS NULL THEN
    RAISE EXCEPTION 'Session not found';
  END IF;

  IF v_session.status NOT IN ('in_progress', 'review_ready') THEN
    RAISE EXCEPTION 'Session is not editable in status %', v_session.status;
  END IF;

  SELECT *
  INTO v_profile
  FROM operating_model_profiles
  WHERE id = v_session.profile_id
  FOR UPDATE;

  INSERT INTO operating_model_layer_checkpoints (
    profile_id,
    session_id,
    user_id,
    profile_version,
    layer,
    checkpoint_summary,
    normalized_payload,
    status,
    approved_at,
    last_validated_at
  )
  VALUES (
    v_profile.id,
    v_session.id,
    v_session.user_id,
    v_session.profile_version,
    p_layer,
    p_checkpoint_summary,
    jsonb_build_object(
      'layer', p_layer,
      'checkpoint_summary', p_checkpoint_summary,
      'entries', COALESCE(p_entries, '[]'::jsonb)
    ),
    'approved',
    now(),
    now()
  )
  ON CONFLICT (session_id, layer) DO UPDATE
    SET checkpoint_summary = EXCLUDED.checkpoint_summary,
        normalized_payload = EXCLUDED.normalized_payload,
        status = 'approved',
        approved_at = now(),
        last_validated_at = now(),
        updated_at = now()
  RETURNING id INTO v_checkpoint_id;

  DELETE FROM operating_model_entries
  WHERE session_id = v_session.id
    AND layer = p_layer;

  INSERT INTO operating_model_entries (
    profile_id,
    session_id,
    checkpoint_id,
    user_id,
    profile_version,
    layer,
    entry_order,
    title,
    summary,
    cadence,
    trigger,
    inputs,
    stakeholders,
    constraints,
    details,
    source_confidence,
    status,
    last_validated_at
  )
  SELECT
    v_profile.id,
    v_session.id,
    v_checkpoint_id,
    v_session.user_id,
    v_session.profile_version,
    p_layer,
    src.ordinality::INTEGER,
    TRIM(src.entry->>'title'),
    TRIM(src.entry->>'summary'),
    NULLIF(TRIM(src.entry->>'cadence'), ''),
    NULLIF(TRIM(src.entry->>'trigger'), ''),
    COALESCE(
      ARRAY(
        SELECT jsonb_array_elements_text(COALESCE(src.entry->'inputs', '[]'::jsonb))
      ),
      ARRAY[]::TEXT[]
    ),
    COALESCE(
      ARRAY(
        SELECT jsonb_array_elements_text(COALESCE(src.entry->'stakeholders', '[]'::jsonb))
      ),
      ARRAY[]::TEXT[]
    ),
    COALESCE(
      ARRAY(
        SELECT jsonb_array_elements_text(COALESCE(src.entry->'constraints', '[]'::jsonb))
      ),
      ARRAY[]::TEXT[]
    ),
    COALESCE(src.entry->'details', '{}'::jsonb),
    COALESCE(NULLIF(src.entry->>'source_confidence', ''), 'confirmed'),
    COALESCE(NULLIF(src.entry->>'status', ''), 'active'),
    COALESCE(
      NULLIF(src.entry->>'last_validated_at', '')::timestamptz,
      now()
    )
  FROM jsonb_array_elements(COALESCE(p_entries, '[]'::jsonb)) WITH ORDINALITY AS src(entry, ordinality);

  SELECT ARRAY(
    SELECT item
    FROM unnest(COALESCE(v_session.completed_layers, ARRAY[]::TEXT[]) || ARRAY[p_layer]) AS item
    GROUP BY item
    ORDER BY array_position(v_layers, item)
  )
  INTO v_completed_layers;

  v_pending_layer := operating_model_next_layer(v_completed_layers);

  UPDATE operating_model_sessions
    SET completed_layers = v_completed_layers,
        current_layer = CASE
          WHEN v_pending_layer = 'review' THEN 'review'
          ELSE v_pending_layer
        END,
        status = CASE
          WHEN v_pending_layer = 'review' THEN 'review_ready'
          ELSE 'in_progress'
        END,
        resume_metadata = resume_metadata || jsonb_build_object(
          'last_saved_layer', p_layer,
          'last_saved_at', now()
        ),
        updated_at = now()
  WHERE id = v_session.id
  RETURNING * INTO v_session;

  UPDATE operating_model_profiles
    SET status = 'draft',
        updated_at = now()
  WHERE id = v_profile.id;

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'title', e.title,
        'summary', e.summary,
        'cadence', e.cadence,
        'trigger', e.trigger,
        'inputs', to_jsonb(e.inputs),
        'stakeholders', to_jsonb(e.stakeholders),
        'constraints', to_jsonb(e.constraints),
        'details', e.details,
        'source_confidence', e.source_confidence,
        'status', e.status,
        'last_validated_at', e.last_validated_at
      )
      ORDER BY e.entry_order
    ),
    '[]'::jsonb
  )
  INTO v_saved_entries
  FROM operating_model_entries e
  WHERE e.session_id = v_session.id
    AND e.layer = p_layer;

  RETURN jsonb_build_object(
    'session_id', v_session.id,
    'session_status', v_session.status,
    'session_version', v_session.profile_version,
    'layer', p_layer,
    'checkpoint_summary', p_checkpoint_summary,
    'completed_layers', to_jsonb(v_completed_layers),
    'pending_layer', CASE
      WHEN v_pending_layer = 'review' THEN 'review'
      ELSE v_pending_layer
    END,
    'entries', v_saved_entries
  );
END;
$$ LANGUAGE plpgsql;

GRANT EXECUTE ON FUNCTION public.operating_model_next_layer(TEXT[]) TO service_role;
GRANT EXECUTE ON FUNCTION public.operating_model_start_session(UUID, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.operating_model_save_layer(UUID, TEXT, TEXT, JSONB) TO service_role;

-- Verification
-- SELECT table_name FROM information_schema.tables
-- WHERE table_name LIKE 'operating_model_%'
-- ORDER BY table_name;
