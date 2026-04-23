-- Extension 3: Family Calendar
-- Multi-person family scheduling system

-- Family members in your household
CREATE TABLE family_members (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL,
    name TEXT NOT NULL,
    relationship TEXT, -- e.g. 'self', 'spouse', 'child', 'parent'
    birth_date DATE,
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- Scheduled events and recurring activities
CREATE TABLE activities (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL,
    family_member_id UUID REFERENCES family_members, -- null means whole family
    title TEXT NOT NULL,
    activity_type TEXT, -- e.g. 'sports', 'medical', 'school', 'social'
    day_of_week TEXT, -- for recurring: 'monday', 'tuesday', etc. null for one-time
    start_time TIME,
    end_time TIME,
    start_date DATE,
    end_date DATE, -- null for one-time or ongoing recurring
    location TEXT,
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- Birthdays, anniversaries, deadlines
CREATE TABLE important_dates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL,
    family_member_id UUID REFERENCES family_members, -- null for family-wide dates
    title TEXT NOT NULL,
    date_value DATE NOT NULL,
    recurring_yearly BOOLEAN DEFAULT false,
    reminder_days_before INTEGER DEFAULT 7,
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- Row Level Security
ALTER TABLE family_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE activities ENABLE ROW LEVEL SECURITY;
ALTER TABLE important_dates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access" ON family_members FOR ALL TO public
  USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');
CREATE POLICY "family_members_user_policy" ON family_members FOR ALL TO public
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Service role full access" ON activities FOR ALL TO public
  USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');
CREATE POLICY "activities_user_policy" ON activities FOR ALL TO public
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Service role full access" ON important_dates FOR ALL TO public
  USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');
CREATE POLICY "important_dates_user_policy" ON important_dates FOR ALL TO public
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- Indexes for common queries
CREATE INDEX idx_activities_user_dow ON activities(user_id, day_of_week);
CREATE INDEX idx_activities_family_member ON activities(family_member_id);
CREATE INDEX idx_activities_user_dates ON activities(user_id, start_date, end_date);
CREATE INDEX idx_important_dates_user_date ON important_dates(user_id, date_value);
CREATE INDEX idx_family_members_user ON family_members(user_id);
