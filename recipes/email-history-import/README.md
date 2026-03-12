# Email History Import

> Import your Gmail email history into Open Brain as searchable, embedded thoughts.

## What It Does

Pulls your Gmail history via the Gmail API and loads each email into Open Brain as a thought. Emails are embedded and stored with sender, subject, date, and label metadata — making your entire email archive searchable through your brain's semantic search.

## Prerequisites

- Working Open Brain setup ([guide](../../docs/getting-started.md))
- Google Cloud project with Gmail API enabled
- Gmail API OAuth credentials (Client ID + Client Secret)
- Node.js 18+
- Your Supabase project URL and service role key

## Steps

<!-- TODO: Matt Hallett to fill in step-by-step instructions -->

1. Set up Google Cloud project and enable the Gmail API
2. Create OAuth 2.0 credentials
3. Clone this folder and install dependencies
4. Configure your environment variables
5. Run the authentication flow
6. Run the import script
7. Verify thoughts were created in your Supabase database

## Expected Outcome

After running the import, you should see your emails as rows in the `thoughts` table. Each thought's `content` field contains the email body, and the `metadata` jsonb field includes:
- `source`: `"gmail"`
- `sender`: sender email address
- `subject`: email subject line
- `date`: original send date
- `labels`: Gmail labels

You can search for any email content using your Open Brain MCP server's `search_thoughts` tool.

## Troubleshooting

**Issue: OAuth flow fails or redirects to an error page**
Solution: Make sure your redirect URI in Google Cloud Console matches exactly what's in your config. For local development, use `http://localhost:3000/callback`.

**Issue: Import runs but no thoughts appear in Supabase**
Solution: Check that your `SUPABASE_SERVICE_ROLE_KEY` is set (not the anon key). RLS blocks anon inserts.

**Issue: Rate limiting from Gmail API**
Solution: The script includes built-in rate limiting, but if you have a very large mailbox, you may need to import in batches. Use the `--after` flag to set a start date.
