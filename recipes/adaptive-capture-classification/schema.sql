-- Adaptive Capture Classification — Learning Tables
-- Adds four tables to your Open Brain database to support confidence gating,
-- per-type threshold learning, A/B model comparison, and spell correction learning.
--
-- Run this migration once against your Supabase project.
-- No existing OB1 tables are modified.

-- ============================================================
-- 1. correction_learnings
--    Tracks user feedback on individual word corrections.
--    After two rejections a correction is suppressed permanently.
-- ============================================================
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

-- ============================================================
-- 2. classification_outcomes
--    One row per capture attempt. Records the model used,
--    LLM confidence, whether it was auto-classified, and the
--    user's eventual verdict. Used to track model accuracy
--    and drive threshold adjustments.
-- ============================================================
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

-- ============================================================
-- 3. capture_thresholds
--    Stores the current auto-classify threshold for each
--    capture type. Starts at 0.75 for every type. Nudged
--    down when the user silently accepts an auto-classify
--    result; nudged up when they correct it. Clamped 0.50–0.95.
-- ============================================================
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

-- ============================================================
-- 4. ab_comparisons
--    Head-to-head model comparison results. One row per
--    comparison session. Winner is 'a', 'b', 'both', or
--    'neither', set by the user. Used to decide which model
--    to promote as the default classifier.
-- ============================================================
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
