# Email Attachments Schema Extension

Extends the `documents` table to support email attachment ingestion.

## Changes

- Adds `email_message_id` column to link documents to their source Outlook message
- Relaxes `file_type` CHECK constraint to include `pptx`, `md`, `txt`

## Usage

Run `migration.sql` against your Supabase database before deploying the updated edge functions.
