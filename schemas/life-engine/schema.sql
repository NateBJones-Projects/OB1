-- Life Engine schema for Open Brain
-- Run this in your Supabase SQL Editor.
--
-- All tables use UUIDs and timestamptz.
-- RLS is enabled on each table; autonomous agents should access via service key (bypasses RLS).
-- Personal data (raw check-in text) is stored in life_engine_checkins.raw_text — do not log this.

-- ============================================================
-- Habits
-- ============================================================

CREATE TABLE IF NOT EXISTS life_engine_habits (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name          TEXT        NOT NULL,
  reminder_time TIME,                        -- e.g. '07:00'
  days_of_week  TEXT[],                      -- e.g. ARRAY['Mon','Tue','Wed','Thu','Fri']
                                             -- NULL = every day
  active        BOOLEAN     NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE life_engine_habits ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- Habit completions
-- ============================================================

CREATE TABLE IF NOT EXISTS life_engine_habit_completions (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  habit_id     UUID        NOT NULL REFERENCES life_engine_habits(id) ON DELETE CASCADE,
  completed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  notes        TEXT
);

ALTER TABLE life_engine_habit_completions ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- Check-ins (mood / energy)
-- ============================================================

CREATE TABLE IF NOT EXISTS life_engine_checkins (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  checked_in_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  mood_score    INT         CHECK (mood_score   BETWEEN 1 AND 5),
  energy_score  INT         CHECK (energy_score BETWEEN 1 AND 5),
  raw_text      TEXT,       -- user's raw reply (not logged externally)
  notes         TEXT
);

ALTER TABLE life_engine_checkins ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- Briefings log (morning habits message, evening summary)
-- ============================================================

CREATE TABLE IF NOT EXISTS life_engine_briefings (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  trigger_type     TEXT        NOT NULL,   -- 'morning' | 'evening'
  channel          TEXT        NOT NULL DEFAULT 'telegram',
  sent_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  content          TEXT,                   -- message text sent
  habits_count     INT,
  habits_completed INT
);

ALTER TABLE life_engine_briefings ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- Evolution (weekly self-improvement proposals)
-- ============================================================

CREATE TABLE IF NOT EXISTS life_engine_evolution (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  proposed_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  observation  TEXT        NOT NULL,
  suggestion   TEXT        NOT NULL,
  status       TEXT        NOT NULL DEFAULT 'pending'
                           CHECK (status IN ('pending', 'approved', 'rejected')),
  actioned_at  TIMESTAMPTZ
);

ALTER TABLE life_engine_evolution ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- Seed: example habits (edit before running)
-- ============================================================

INSERT INTO life_engine_habits (name, reminder_time, days_of_week) VALUES
  ('Morning walk',      '07:00', ARRAY['Mon','Tue','Wed','Thu','Fri']),
  ('Evening wind-down', '21:00', ARRAY['Mon','Tue','Wed','Thu','Fri','Sat','Sun'])
ON CONFLICT DO NOTHING;
