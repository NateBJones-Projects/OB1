-- Sensitivity Tiers: Add sensitivity_tier column to thoughts table
--
-- Three tiers:
--   restricted — contains SSNs, API keys, passwords, credit cards, bank accounts
--   personal   — contains medication dosages, health data, financial details
--   standard   — everything else (default)
--
-- Run this migration against your Supabase SQL Editor.

ALTER TABLE thoughts
ADD COLUMN IF NOT EXISTS sensitivity_tier TEXT NOT NULL DEFAULT 'standard';

-- Index for filtering queries (WHERE sensitivity_tier != 'restricted')
CREATE INDEX IF NOT EXISTS idx_thoughts_sensitivity_tier
ON thoughts (sensitivity_tier);

-- Optional: Add a check constraint to enforce valid values
ALTER TABLE thoughts
ADD CONSTRAINT chk_sensitivity_tier
CHECK (sensitivity_tier IN ('standard', 'personal', 'restricted'));
