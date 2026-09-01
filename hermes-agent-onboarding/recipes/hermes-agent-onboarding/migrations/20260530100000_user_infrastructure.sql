-- ================================================================
-- USER INFRASTRUCTURE — Base Tables for the Hermes Onboarding
-- ================================================================
-- Stage 0 (Foundation) of the generative meta-skill process.
-- These 6 tables are universal — they serve ANY user regardless of
-- work domain. They are the skeleton every profile needs.
--
-- Populate order:
--   1. user_profiles (who you are)
--   2. user_preferences (how the agent should behave)
--   3. user_mbti (how you think)
--   4. user_style (how you communicate)
--   5. user_relations (who matters)
--   6. user_beliefs (what you stand for)
--
-- ⚠️ NOTE: Always prefix with `public.`. Without it, `supabase db push`
-- creates tables in the `extensions` schema, requiring manual ALTER TABLE.
-- ================================================================

-- ================================================================
-- 1. USER PROFILES — Identity + context
-- ================================================================
CREATE TABLE public.user_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  preferred_name TEXT,
  domain_summary TEXT,               -- one-liner: "Firmware Engineer", "Writer", "Teacher"
  bio TEXT,                          -- free-form self-description
  mbti_type TEXT,                    -- e.g. INTJ, populated from user_mbti
  primary_language TEXT DEFAULT 'en',
  timezone TEXT,

  -- Family & routines (Djair's insight: critical for understanding user context)
  family JSONB,                      -- {spouse: "name", children: [{name, age}], pets: [{type, name}]}
  routines TEXT,                     -- daily/weekly routine description

  -- Onboarding state machine
  onboarding_completed BOOLEAN DEFAULT false,
  onboarding_stage TEXT DEFAULT 'none',  -- none | setup | profile | operational | financial | ontology | calibration | complete
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- ================================================================
-- 2. USER PREFERENCES — How the agent should behave
-- ================================================================
CREATE TABLE public.user_preferences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id UUID REFERENCES user_profiles(id) ON DELETE CASCADE,

  -- Communication
  preferred_tone TEXT DEFAULT 'direct',   -- direct, formal, casual, technical, creative
  response_depth TEXT DEFAULT 'concise',  -- concise, detailed, exhaustive
  prefers_bullets BOOLEAN DEFAULT false,
  clarification_style TEXT DEFAULT 'ask', -- ask (before acting), assume (correct after)

  -- Autonomy
  autonomy_level INT DEFAULT 3,           -- 1 (ask everything) to 5 (execute freely)
  approve_deploys BOOLEAN DEFAULT true,
  approve_destructive BOOLEAN DEFAULT true,
  sudo_allowed BOOLEAN DEFAULT false,

  -- File organization
  file_organization TEXT,                 -- e.g. "folders by project/year"
  primary_work_dir TEXT,
  backup_dir TEXT,

  -- Schedule
  work_hours JSONB,                       -- {monday: {start: "08:00", end: "18:00", deep_work: ["09:00-12:00"]}}
  best_contact_time TEXT,

  -- Financial tracking
  finance_tracked BOOLEAN DEFAULT false,
  bank_csv_imported BOOLEAN DEFAULT false,
  finance_goal TEXT,

  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- ================================================================
-- 3. USER MBTI — Personality profile
-- ================================================================
CREATE TABLE public.user_mbti (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id UUID REFERENCES user_profiles(id) ON DELETE CASCADE,

  -- 4-letter type dimensions
  ei TEXT NOT NULL,                    -- E (Extraversion) or I (Introversion)
  sn TEXT NOT NULL,                    -- S (Sensing) or N (Intuition)
  tf TEXT NOT NULL,                    -- T (Thinking) or F (Feeling)
  jp TEXT NOT NULL,                    -- J (Judging) or P (Perceiving)

  -- How the type was determined
  source TEXT NOT NULL DEFAULT 'self-reported',  -- self-reported, quick_test, detailed_test, inferred
  confidence INT DEFAULT 3,                      -- 1 (low) to 5 (certain)

  -- Observed traits from guided interview
  observed_traits JSONB,               -- ["prefers planning before acting", "values logic over emotion"]
  communication_notes TEXT,
  decision_style TEXT,
  stress_pattern TEXT,
  growth_edge TEXT,

  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),

  UNIQUE(profile_id)
);

-- ================================================================
-- 4. USER STYLE — Communication patterns
-- ================================================================
CREATE TABLE public.user_style (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id UUID REFERENCES user_profiles(id) ON DELETE CASCADE,

  -- Syntax & formatting
  sentence_length TEXT DEFAULT 'medium',     -- short, medium, long, variable
  punctuation_style TEXT DEFAULT 'standard', -- standard, minimal, expressive
  paragraph_style TEXT DEFAULT 'mixed',      -- short_paragraphs, long_blocks, bullet_points
  format_preference TEXT DEFAULT 'markdown', -- markdown, plain_text, structured

  -- Vocabulary
  vocabulary_level TEXT DEFAULT 'technical', -- simple, everyday, technical, erudite
  preferred_terms TEXT[],                    -- jargon the user employs frequently
  avoided_terms TEXT[],                      -- words the user dislikes
  slang_or_idioms TEXT[],                    -- recurring expressions

  -- Tone
  humor_style TEXT DEFAULT 'subtle',          -- none, subtle, frequent, sarcastic
  formality_level INT DEFAULT 3,             -- 1 (very casual) to 5 (very formal)
  emotional_expression TEXT DEFAULT 'reserved', -- reserved, moderate, expressive

  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),

  UNIQUE(profile_id)
);

-- ================================================================
-- 5. USER RELATIONS — Key people in the user's life
-- ================================================================
CREATE TABLE public.user_relations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id UUID REFERENCES user_profiles(id) ON DELETE CASCADE,

  name TEXT NOT NULL,
  role TEXT NOT NULL,           -- spouse, child, parent, partner, client, mentor, team, friend, etc.
  context TEXT,                 -- "theater partner since 2010", "weekly D&D group"
  contact_info JSONB,           -- {email, phone, linkedin}
  importance INT DEFAULT 3,     -- 1 (acquaintance) to 5 (essential)
  last_interaction DATE,
  notes TEXT,

  -- Link to professional CRM if it exists
  crm_contact_id UUID,

  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- ================================================================
-- 6. USER BELIEFS — Values, principles, non-negotiables
-- ================================================================
CREATE TABLE public.user_beliefs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id UUID REFERENCES user_profiles(id) ON DELETE CASCADE,

  category TEXT NOT NULL,       -- work, life, ethics, money, relationships, creativity, technology
  statement TEXT NOT NULL,      -- the belief itself: "Quality over quantity"
  context TEXT,                 -- when/how this belief manifests
  strength INT DEFAULT 3,       -- 1 (flexible) to 5 (non-negotiable)
  source TEXT,                  -- where it comes from: experience, family, education
  opposed_to TEXT[],            -- what contradicts this belief: ["workarounds", "shortcuts"]

  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- ================================================================
-- INDEXES & RLS POLICIES
-- ================================================================

-- Common lookup indexes
CREATE INDEX idx_user_preferences_profile ON public.user_preferences(profile_id);
CREATE INDEX idx_user_relations_profile ON public.user_relations(profile_id);
CREATE INDEX idx_user_beliefs_profile ON public.user_beliefs(profile_id);
CREATE INDEX idx_user_beliefs_category ON public.user_beliefs(category);

-- RLS: service_role access only (Hermes Agent).
-- The service_role key's JWT contains `role=service_role`.
-- Anon and authenticated user JWTs lack this claim and are blocked.
-- Without RLS, any public anon key could read personal user data.
ALTER TABLE public.user_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_mbti ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_style ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_relations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_beliefs ENABLE ROW LEVEL SECURITY;

-- Single policy: allow everything for service_role, deny everything else.
-- auth.jwt() ->> 'role' = 'service_role' only when using service_role key.
CREATE POLICY "service_role_only" ON public.user_profiles FOR ALL
  USING ((auth.jwt() ->> 'role') = 'service_role');
CREATE POLICY "service_role_only" ON public.user_preferences FOR ALL
  USING ((auth.jwt() ->> 'role') = 'service_role');
CREATE POLICY "service_role_only" ON public.user_mbti FOR ALL
  USING ((auth.jwt() ->> 'role') = 'service_role');
CREATE POLICY "service_role_only" ON public.user_style FOR ALL
  USING ((auth.jwt() ->> 'role') = 'service_role');
CREATE POLICY "service_role_only" ON public.user_relations FOR ALL
  USING ((auth.jwt() ->> 'role') = 'service_role');
CREATE POLICY "service_role_only" ON public.user_beliefs FOR ALL
  USING ((auth.jwt() ->> 'role') = 'service_role');

-- After applying, run:
-- GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO service_role;
-- GRANT USAGE ON SCHEMA public TO service_role;
