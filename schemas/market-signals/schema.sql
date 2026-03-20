-- Market Signals Schema for Open Brain
-- Tracks customer pain points, feature requests, and competitive gaps
-- to inform product build priorities with evidence, not guesses.

CREATE TABLE market_signals (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  signal text NOT NULL,
  source_url text,
  source_type text DEFAULT 'reddit',
  product text DEFAULT 'default',
  signal_type text NOT NULL CHECK (
    signal_type IN (
      'pain_point',
      'feature_request',
      'competitor_gap',
      'workflow_complaint',
      'willingness_to_pay'
    )
  ),
  category text,
  intensity int CHECK (intensity BETWEEN 1 AND 5) DEFAULT 3,
  frequency_note text,
  people text[] DEFAULT '{}',
  topics text[] DEFAULT '{}',
  raw_quote text,
  created_at timestamptz DEFAULT now(),
  metadata jsonb DEFAULT '{}'
);

-- Row Level Security: service_role only
ALTER TABLE market_signals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_only" ON market_signals
  FOR ALL USING (auth.role() = 'service_role');

-- Grant permissions to service_role (required on newer Supabase projects)
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.market_signals TO service_role;

-- Performance indexes
CREATE INDEX idx_signals_product ON market_signals(product);
CREATE INDEX idx_signals_type ON market_signals(signal_type);
CREATE INDEX idx_signals_category ON market_signals(category);
CREATE INDEX idx_signals_created ON market_signals(created_at DESC);
CREATE INDEX idx_signals_topics ON market_signals USING GIN(topics);
