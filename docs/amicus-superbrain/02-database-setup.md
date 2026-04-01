# 02 — Database Setup

Create all tables, indexes, functions, and security policies in your Supabase project.

Run each SQL block in **Supabase Dashboard > SQL Editor > New query**. Run them in order — later blocks depend on earlier ones.

---

## Step 1: Enable pgvector

In the left sidebar: **Database > Extensions** > search for "vector" > flip **pgvector ON**.

---

## Step 2: Core Thoughts Table

```sql
-- Core thoughts table with vector embeddings
CREATE TABLE thoughts (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  content TEXT NOT NULL,
  embedding vector(1536),
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Indexes
CREATE INDEX ON thoughts USING hnsw (embedding vector_cosine_ops);
CREATE INDEX ON thoughts USING gin (metadata);
CREATE INDEX ON thoughts (created_at DESC);

-- Auto-update timestamp trigger
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  new.updated_at = now();
  RETURN new;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER thoughts_updated_at
  BEFORE UPDATE ON thoughts
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
```

---

## Step 3: Semantic Search Function

```sql
CREATE OR REPLACE FUNCTION match_thoughts(
  query_embedding vector(1536),
  match_threshold FLOAT DEFAULT 0.7,
  match_count INT DEFAULT 10,
  filter JSONB DEFAULT '{}'::jsonb
)
RETURNS TABLE (
  id UUID,
  content TEXT,
  metadata JSONB,
  similarity FLOAT,
  created_at TIMESTAMPTZ
)
LANGUAGE plpgsql AS $$
BEGIN
  RETURN QUERY
  SELECT
    t.id, t.content, t.metadata,
    1 - (t.embedding <=> query_embedding) AS similarity,
    t.created_at
  FROM thoughts t
  WHERE 1 - (t.embedding <=> query_embedding) > match_threshold
    AND (filter = '{}'::jsonb OR t.metadata @> filter)
  ORDER BY t.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;
```

---

## Step 4: Content Fingerprint Dedup

```sql
ALTER TABLE thoughts ADD COLUMN IF NOT EXISTS content_fingerprint TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_thoughts_fingerprint
  ON thoughts (content_fingerprint)
  WHERE content_fingerprint IS NOT NULL;
```

---

## Step 5: Professional CRM Tables

```sql
-- Contacts
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

-- Interactions
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

-- Opportunities
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

-- Indexes
CREATE INDEX IF NOT EXISTS idx_professional_contacts_user_last_contacted
  ON professional_contacts(user_id, last_contacted);
CREATE INDEX IF NOT EXISTS idx_professional_contacts_follow_up
  ON professional_contacts(user_id, follow_up_date) WHERE follow_up_date IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_contact_interactions_contact_occurred
  ON contact_interactions(contact_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_opportunities_user_stage
  ON opportunities(user_id, stage);

-- Auto-update last_contacted on new interactions
CREATE OR REPLACE FUNCTION update_last_contacted()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE professional_contacts SET last_contacted = NEW.occurred_at WHERE id = NEW.contact_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_contact_last_contacted
  AFTER INSERT ON contact_interactions
  FOR EACH ROW EXECUTE FUNCTION update_last_contacted();

-- Updated_at triggers
CREATE TRIGGER update_professional_contacts_updated_at
  BEFORE UPDATE ON professional_contacts
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER update_opportunities_updated_at
  BEFORE UPDATE ON opportunities
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
```

---

## Step 6: Time Tracking Tables

```sql
-- Legal matters / projects
CREATE TABLE matters (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  name TEXT NOT NULL,
  customer_id UUID REFERENCES professional_contacts(id),
  customer_name TEXT,
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'closed', 'on_hold')),
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Task types with billing rates
CREATE TABLE task_types (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  rate_cents INTEGER NOT NULL DEFAULT 360000,
  rate_type TEXT DEFAULT 'hourly' CHECK (rate_type IN ('hourly', 'daily')),
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Time entries
CREATE TABLE time_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  date DATE NOT NULL,
  matter_id UUID REFERENCES matters(id),
  task_type_id UUID REFERENCES task_types(id),
  hours NUMERIC(5,2) NOT NULL CHECK (hours > 0),
  comment TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Indexes
CREATE INDEX idx_time_entries_date ON time_entries(date DESC);
CREATE INDEX idx_time_entries_matter ON time_entries(matter_id);
CREATE INDEX idx_time_entries_user_date ON time_entries(user_id, date DESC);
CREATE INDEX idx_matters_user ON matters(user_id);
CREATE INDEX idx_matters_customer ON matters(customer_id);

-- Triggers
CREATE TRIGGER matters_updated_at
  BEFORE UPDATE ON matters FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER time_entries_updated_at
  BEFORE UPDATE ON time_entries FOR EACH ROW EXECUTE FUNCTION update_updated_at();
```

---

## Step 7: Documents Table

```sql
CREATE TABLE IF NOT EXISTS documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  filename TEXT NOT NULL,
  file_type TEXT NOT NULL CHECK (file_type IN ('pdf', 'docx', 'xlsx')),
  file_size_bytes BIGINT NOT NULL,
  storage_path TEXT NOT NULL,
  full_text TEXT,
  page_count INTEGER,
  word_count INTEGER,
  matter_id UUID REFERENCES matters(id),
  matter_name TEXT,
  contact_id UUID REFERENCES professional_contacts(id),
  thought_id UUID REFERENCES thoughts(id) ON DELETE SET NULL,
  chunk_thought_ids UUID[] DEFAULT '{}',
  description TEXT,
  tags TEXT[] DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

CREATE INDEX idx_documents_matter ON documents(matter_id) WHERE matter_id IS NOT NULL;
CREATE INDEX idx_documents_created ON documents(created_at DESC);

CREATE TRIGGER documents_updated_at
  BEFORE UPDATE ON documents FOR EACH ROW EXECUTE FUNCTION update_updated_at();
```

---

## Step 8: Row Level Security and Permissions

```sql
-- Thoughts
ALTER TABLE thoughts ENABLE ROW LEVEL SECURITY;
CREATE POLICY thoughts_full_access ON thoughts FOR ALL USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE, DELETE ON thoughts TO service_role;

-- CRM
ALTER TABLE professional_contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE contact_interactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE opportunities ENABLE ROW LEVEL SECURITY;
CREATE POLICY contacts_access ON professional_contacts FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY interactions_access ON contact_interactions FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY opportunities_access ON opportunities FOR ALL USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE, DELETE ON professional_contacts TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON contact_interactions TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON opportunities TO service_role;

-- Time Tracking
ALTER TABLE matters ENABLE ROW LEVEL SECURITY;
ALTER TABLE task_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE time_entries ENABLE ROW LEVEL SECURITY;
CREATE POLICY matters_access ON matters FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY task_types_access ON task_types FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY time_entries_access ON time_entries FOR ALL USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE, DELETE ON matters TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON task_types TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON time_entries TO service_role;

-- Documents
ALTER TABLE documents ENABLE ROW LEVEL SECURITY;
CREATE POLICY documents_access ON documents FOR ALL USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE, DELETE ON documents TO service_role;

-- Storage
CREATE POLICY storage_access ON storage.objects FOR ALL USING (true) WITH CHECK (true);
```

---

## Step 9: Create Storage Bucket

In **Supabase Dashboard > Storage**:

1. Click **New Bucket**
2. Name: `documents`
3. Public: **No** (private)
4. Max file size: **50MB**
5. Allowed MIME types: `application/pdf, application/vnd.openxmlformats-officedocument.wordprocessingml.document, application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`

---

## Verification

After running all SQL blocks, check:

- **Table Editor** shows: `thoughts`, `professional_contacts`, `contact_interactions`, `opportunities`, `matters`, `task_types`, `time_entries`, `documents`
- **Database > Functions** shows: `match_thoughts`, `update_updated_at`, `update_last_contacted`
- **Storage** shows: `documents` bucket

---

Next: [03 — MCP Server Deployment](03-mcp-deployment.md)
