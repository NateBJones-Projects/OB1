-- Draft: staging patch for enhanced upsert_thought column mirroring.
-- This is already folded into schemas/enhanced-thoughts/schema.sql for new installs.

CREATE OR REPLACE FUNCTION public.upsert_thought(p_content TEXT, p_payload JSONB DEFAULT '{}')
RETURNS JSONB AS $$
DECLARE
  v_fingerprint TEXT;
  v_result JSONB;
  v_id UUID;
  v_metadata JSONB;
  v_type TEXT;
  v_source_type TEXT;
  v_importance SMALLINT;
  v_quality_score NUMERIC(5,2);
  v_sensitivity_tier TEXT;
  v_status TEXT;
BEGIN
  v_metadata := COALESCE(p_payload->'metadata', '{}'::jsonb);
  v_type := COALESCE(NULLIF(v_metadata->>'type', ''), 'observation');
  v_source_type := COALESCE(NULLIF(v_metadata->>'source_type', ''), NULLIF(v_metadata->>'source', ''), 'unknown');
  v_importance := CASE
    WHEN COALESCE(v_metadata->>'importance', '') ~ '^[0-9]+(\.[0-9]+)?$'
      THEN LEAST(100, GREATEST(0, ROUND((v_metadata->>'importance')::numeric)))::smallint
    ELSE 50
  END;
  v_quality_score := CASE
    WHEN COALESCE(v_metadata->>'quality_score', '') ~ '^[0-9]+(\.[0-9]+)?$'
      THEN LEAST(100, GREATEST(0, (v_metadata->>'quality_score')::numeric))
    ELSE 70
  END;
  v_sensitivity_tier := COALESCE(NULLIF(v_metadata->>'sensitivity_tier', ''), 'standard');
  v_status := COALESCE(NULLIF(p_payload->>'status', ''), NULLIF(v_metadata->>'status', ''));
  IF v_status IS NULL AND v_type IN ('task', 'idea') THEN
    v_status := 'new';
  END IF;

  v_fingerprint := encode(sha256(convert_to(
    lower(trim(regexp_replace(p_content, '\s+', ' ', 'g'))),
    'UTF8'
  )), 'hex');

  INSERT INTO public.thoughts (
    content,
    content_fingerprint,
    metadata,
    type,
    source_type,
    importance,
    quality_score,
    sensitivity_tier,
    status,
    status_updated_at
  )
  VALUES (
    p_content,
    v_fingerprint,
    v_metadata,
    v_type,
    v_source_type,
    v_importance,
    v_quality_score,
    v_sensitivity_tier,
    v_status,
    CASE WHEN v_status IS NULL THEN NULL ELSE now() END
  )
  ON CONFLICT (content_fingerprint) WHERE content_fingerprint IS NOT NULL DO UPDATE
  SET updated_at = now(),
      metadata = public.thoughts.metadata || COALESCE(EXCLUDED.metadata, '{}'::jsonb),
      type = COALESCE(EXCLUDED.type, public.thoughts.type),
      source_type = COALESCE(EXCLUDED.source_type, public.thoughts.source_type),
      importance = COALESCE(EXCLUDED.importance, public.thoughts.importance),
      quality_score = COALESCE(EXCLUDED.quality_score, public.thoughts.quality_score),
      sensitivity_tier = COALESCE(EXCLUDED.sensitivity_tier, public.thoughts.sensitivity_tier),
      status = COALESCE(EXCLUDED.status, public.thoughts.status),
      status_updated_at = CASE
        WHEN EXCLUDED.status IS DISTINCT FROM public.thoughts.status THEN now()
        ELSE public.thoughts.status_updated_at
      END
  RETURNING id INTO v_id;

  v_result := jsonb_build_object('id', v_id, 'fingerprint', v_fingerprint);
  RETURN v_result;
END;
$$ LANGUAGE plpgsql;

GRANT EXECUTE ON FUNCTION public.upsert_thought(TEXT, JSONB) TO service_role;

NOTIFY pgrst, 'reload schema';
