-- Email Attachments Migration
-- Adds email_message_id to documents table and relaxes file_type constraint
-- to support pptx, md, txt in addition to existing pdf, docx, xlsx

-- Add email_message_id column to link documents back to source emails
ALTER TABLE documents ADD COLUMN IF NOT EXISTS email_message_id TEXT;
CREATE INDEX IF NOT EXISTS idx_documents_email_message_id
  ON documents(email_message_id) WHERE email_message_id IS NOT NULL;

-- Relax file_type CHECK to include pptx, md, txt
ALTER TABLE documents DROP CONSTRAINT IF EXISTS documents_file_type_check;
ALTER TABLE documents ADD CONSTRAINT documents_file_type_check
  CHECK (file_type IN ('pdf', 'docx', 'xlsx', 'pptx', 'md', 'txt'));
