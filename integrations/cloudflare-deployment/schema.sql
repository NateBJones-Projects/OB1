-- Open Brain on Cloudflare — D1 Schema
-- Thoughts table: stores raw text, metadata, and timestamps

CREATE TABLE IF NOT EXISTS thoughts (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  content TEXT NOT NULL,
  metadata TEXT DEFAULT '{}',
  source TEXT DEFAULT 'mcp',
  embedded INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

-- Index for time-based queries
CREATE INDEX IF NOT EXISTS idx_thoughts_created_at ON thoughts(created_at);

-- Index for source filtering
CREATE INDEX IF NOT EXISTS idx_thoughts_source ON thoughts(source);

-- Index for pending embedding jobs
CREATE INDEX IF NOT EXISTS idx_thoughts_embedded ON thoughts(embedded);

-- Full-text search as a fallback/complement to vector search
CREATE VIRTUAL TABLE IF NOT EXISTS thoughts_fts USING fts5(
  content,
  content_rowid='rowid'
);

-- Trigger to keep FTS in sync on insert
CREATE TRIGGER IF NOT EXISTS thoughts_fts_insert AFTER INSERT ON thoughts
BEGIN
  INSERT INTO thoughts_fts(rowid, content) VALUES (NEW.rowid, NEW.content);
END;

-- Trigger to keep FTS in sync on update
CREATE TRIGGER IF NOT EXISTS thoughts_fts_update AFTER UPDATE OF content ON thoughts
BEGIN
  DELETE FROM thoughts_fts WHERE rowid = OLD.rowid;
  INSERT INTO thoughts_fts(rowid, content) VALUES (NEW.rowid, NEW.content);
END;

-- Trigger to keep FTS in sync on delete
CREATE TRIGGER IF NOT EXISTS thoughts_fts_delete AFTER DELETE ON thoughts
BEGIN
  DELETE FROM thoughts_fts WHERE rowid = OLD.rowid;
END;
