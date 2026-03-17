-- Extension 5: Professional CRM
-- Schema for tracking professional contacts, interactions, and opportunities

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

-- Indexes for efficient querying
CREATE INDEX IF NOT EXISTS idx_professional_contacts_user_last_contacted
    ON professional_contacts(user_id, last_contacted);

CREATE INDEX IF NOT EXISTS idx_professional_contacts_follow_up
    ON professional_contacts(user_id, follow_up_date)
    WHERE follow_up_date IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_contact_interactions_contact_occurred
    ON contact_interactions(contact_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_opportunities_user_stage
    ON opportunities(user_id, stage);

-- Row Level Security (RLS)
ALTER TABLE professional_contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE contact_interactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE opportunities ENABLE ROW LEVEL SECURITY;

-- RLS Policies: Users can only see their own data
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

-- Sample data (optional - uncomment to insert examples)
-- INSERT INTO professional_contacts (user_id, name, company, title, email, how_we_met, tags) VALUES
-- (auth.uid(), 'Sarah Chen', 'DataCorp', 'VP of Engineering', 'sarah@datacorp.com', 'AI Summit 2026', ARRAY['ai', 'engineering']);
