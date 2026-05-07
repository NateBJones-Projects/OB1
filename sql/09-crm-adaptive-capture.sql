-- Combined SQL for Professional CRM and Adaptive Capture Classification
-- Run this migration once against your Supabase project

-- ============================================================================
-- SECTION 1: PROFESSIONAL CRM TABLES (Extension 5)
-- ============================================================================

-- Table: professional_contacts
-- People in your professional network
CREATE TABLE IF NOT EXISTS professional_contacts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL,
    name TEXT NOT NULL,
    company TEXT,
    title TEXT,
    email TEXT,
    phone TEXT,
    linkedin_url TEXT,
    how_we_met TEXT,
    tags TEXT[] DEFAULT '{}',
    notes TEXT,
    last_contacted TIMESTAMPTZ,
    follow_up_date DATE,
    created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

-- Table: contact_interactions
-- Log of every touchpoint with contacts
CREATE TABLE IF NOT EXISTS contact_interactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    contact_id UUID REFERENCES professional_contacts(id) ON DELETE CASCADE NOT NULL,
    user_id UUID NOT NULL,
    interaction_type TEXT NOT NULL CHECK (interaction_type IN ('meeting', 'email', 'call', 'coffee', 'event', 'linkedin', 'other')),
    occurred_at TIMESTAMPTZ DEFAULT now() NOT NULL,
    summary TEXT NOT NULL,
    follow_up_needed BOOLEAN DEFAULT false,
    follow_up_notes TEXT,
    created_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

-- Table: opportunities
-- Deals, projects, or potential collaborations
CREATE TABLE IF NOT EXISTS opportunities (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL,
    contact_id UUID REFERENCES professional_contacts(id) ON DELETE SET NULL,
    title TEXT NOT NULL,
    description TEXT,
    stage TEXT DEFAULT 'identified' CHECK (stage IN ('identified', 'in_conversation', 'proposal', 'negotiation', 'won', 'lost')),
    value DECIMAL(12,2),
    expected_close_date DATE,
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

-- Indexes for Professional CRM
CREATE INDEX IF NOT EXISTS idx_professional_contacts_user_last_contacted
    ON professional_contacts(user_id, last_contacted);

CREATE INDEX IF NOT EXISTS idx_professional_contacts_follow_up
    ON professional_contacts(user_id, follow_up_date)
    WHERE follow_up_date IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_contact_interactions_contact_occurred
    ON contact_interactions(contact_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_opportunities_user_stage
    ON opportunities(user_id, stage);

-- RLS for Professional CRM
ALTER TABLE professional_contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE contact_interactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE opportunities ENABLE ROW LEVEL SECURITY;

CREATE POLICY professional_contacts_user_policy ON professional_contacts
    FOR ALL
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY contact_interactions_user_policy ON contact_interactions
    FOR ALL
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY opportunities_user_policy ON opportunities
    FOR ALL
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

-- Function to automatically update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Triggers to update updated_at columns
DROP TRIGGER IF EXISTS update_professional_contacts_updated_at ON professional_contacts;
CREATE TRIGGER update_professional_contacts_updated_at
    BEFORE UPDATE ON professional_contacts
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_opportunities_updated_at ON opportunities;
CREATE TRIGGER update_opportunities_updated_at
    BEFORE UPDATE ON opportunities
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Function to auto-update last_contacted when an interaction is logged
CREATE OR REPLACE FUNCTION update_last_contacted()
RETURNS TRIGGER AS $$
BEGIN
    UPDATE professional_contacts
    SET last_contacted = NEW.occurred_at
    WHERE id = NEW.contact_id;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to update last_contacted on new interactions
DROP TRIGGER IF EXISTS update_contact_last_contacted ON contact_interactions;
CREATE TRIGGER update_contact_last_contacted
    AFTER INSERT ON contact_interactions
    FOR EACH ROW
    EXECUTE FUNCTION update_last_contacted();

-- ============================================================================
-- SECTION 2: ADAPTIVE CAPTURE CLASSIFICATION TABLES
-- ============================================================================

-- 1. correction_learnings
--    Tracks user feedback on individual word corrections.
--    After two rejections a correction is suppressed permanently.
CREATE TABLE IF NOT EXISTS correction_learnings (
    word        TEXT NOT NULL,
    correction  TEXT NOT NULL,
    accepted    INTEGER DEFAULT 0,
    rejected    INTEGER DEFAULT 0,
    PRIMARY KEY (word, correction)
);

GRANT SELECT, INSERT, UPDATE ON correction_learnings TO authenticated;

ALTER TABLE correction_learnings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage their own correction learnings"
    ON correction_learnings
    FOR ALL
    USING (auth.role() = 'authenticated');

-- 2. classification_outcomes
--    One row per capture attempt. Records the model used,
--    LLM confidence, whether it was auto-classified, and the
--    user's eventual verdict. Used to track model accuracy
--    and drive threshold adjustments.
CREATE TABLE IF NOT EXISTS classification_outcomes (
    id              TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    item_id         TEXT,
    model           TEXT NOT NULL,
    item_type       TEXT NOT NULL,
    confidence      REAL NOT NULL,
    auto_classified BOOLEAN NOT NULL DEFAULT FALSE,
    user_accepted   BOOLEAN,
    user_correction TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_outcomes_model ON classification_outcomes (model);
CREATE INDEX IF NOT EXISTS idx_outcomes_type  ON classification_outcomes (item_type);
CREATE INDEX IF NOT EXISTS idx_outcomes_date  ON classification_outcomes (created_at);

GRANT SELECT, INSERT, UPDATE ON classification_outcomes TO authenticated;

ALTER TABLE classification_outcomes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage their own outcomes"
    ON classification_outcomes
    FOR ALL
    USING (auth.role() = 'authenticated');

-- 3. capture_thresholds
--    Stores the current auto-classify threshold for each
--    capture type. Starts at 0.75 for every type. Nudged
--    down when the user silently accepts an auto-classify
--    result; nudged up when they correct it. Clamped 0.50–0.95.
CREATE TABLE IF NOT EXISTS capture_thresholds (
    item_type    TEXT PRIMARY KEY,
    threshold    REAL NOT NULL DEFAULT 0.75,
    sample_count INTEGER DEFAULT 0,
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

GRANT SELECT, INSERT, UPDATE ON capture_thresholds TO authenticated;

ALTER TABLE capture_thresholds ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage their own thresholds"
    ON capture_thresholds
    FOR ALL
    USING (auth.role() = 'authenticated');

-- 4. ab_comparisons
--    Head-to-head model comparison results. One row per
--    comparison session. Winner is 'a', 'b', 'both', or
--    'neither', set by the user. Used to decide which model
--    to promote as the default classifier.
CREATE TABLE IF NOT EXISTS ab_comparisons (
    id           TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    model_a      TEXT NOT NULL,
    model_b      TEXT NOT NULL,
    item_type_a  TEXT NOT NULL,
    item_type_b  TEXT NOT NULL,
    confidence_a REAL NOT NULL,
    confidence_b REAL NOT NULL,
    time_ms_a    INTEGER NOT NULL,
    time_ms_b    INTEGER NOT NULL,
    tokens_a     INTEGER,
    tokens_b     INTEGER,
    winner       TEXT CHECK (winner IN ('a', 'b', 'both', 'neither')),
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ab_model_a ON ab_comparisons (model_a);
CREATE INDEX IF NOT EXISTS idx_ab_model_b ON ab_comparisons (model_b);

GRANT SELECT, INSERT, UPDATE ON ab_comparisons TO authenticated;

ALTER TABLE ab_comparisons ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage their own A/B comparisons"
    ON ab_comparisons
    FOR ALL
    USING (auth.role() = 'authenticated');