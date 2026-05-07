# Gmail & Drive Ingestion

> Automated daily capture from Gmail inbox and Google Drive notes via n8n workflows

## What It Does

This recipe automates daily ingestion from your Gmail inbox and Google Drive files using n8n workflows. The workflows run daily at 23:00 UTC, capture new emails and files, and POST them to your Open Brain v2 capture endpoint for processing and storage.

## Prerequisites

- Working Open Brain v2 setup ([guide](../../docs/01-getting-started.md))
- n8n account (automate.billgleeson.com)
- Gmail API access with OAuth2
- Google Drive API access with OAuth2
- n8n API access (configured via environment variables)

## Credential Tracker

Copy this block into a text editor and fill it in as you go.

```text
GMAIL & DRIVE INGESTION -- CREDENTIAL TRACKER
--------------------------------------

FROM YOUR OPEN BRAIN SETUP
  Project URL:           ____________
  Supabase URL:           https://zpeedfgyuusscsrirzsg.supabase.co
  MCP Access Key:         c5061efb5c64a3e54aa4d340effd8f446d48d0921b683cef97c771dcf496a672

FROM YOUR N8N SETUP
  N8N Base URL:           https://automate.billgleeson.com
  N8N API Key:            <from .env file>
  
GMAIL & DRIVE API SETUP
  Gmail OAuth Client ID:  ____________
  Gmail OAuth Client Secret: ____________
  Drive OAuth Client ID:   ____________
  Drive OAuth Client Secret: ____________

--------------------------------------
```

## Active n8n Workflows

The following workflows are active and run daily:

### 1. OB Gmail Ingestion (ID: cWfrthIlCCwaUTyT)
- **Purpose**: Captures emails from Gmail inbox (last 24 hours)
- **Schedule**: Daily 23:00 UTC
- **Sources**: Gmail inbox emails from previous day
- **Processing**: AI analysis extracts key content and topics
- **Output**: POST to capture endpoint

### 2. OB Drive Ingestion (ID: cj6IiNQafmBUeKxb)
- **Purpose**: Captures files from Google Drive notes folder
- **Schedule**: Daily 23:00 UTC
- **Sources**: Files in designated Google Drive notes folder
- **Processing**: File content extraction + AI analysis
- **Output**: POST to capture endpoint

### 3. OB Meeting Notes Ingestion (ID: mBuap1YCyldtyN9y)
- **Purpose**: Captures meeting notes from Google Drive
- **Schedule**: Daily 23:00 UTC
- **Sources**: Drive files matching "meeting"/"notes" patterns
- **Processing**: Meeting summary extraction + AI insights
- **Output**: POST to capture endpoint

## Steps

### 1. Configure n8n Workflows (If Not Already Set Up)

1. **Open n8n**: Go to https://automate.billgleeson.com
2. **Import Workflows**: Each workflow should be available via template
3. **Configure Credentials**:
   - Add Gmail OAuth2 credential
   - Add Google Drive OAuth2 credential
   - Add n8n API credential for Open Brain access

### 2. Update Capture Endpoint

All workflows currently POST to the old Cloudflare Worker endpoint. Update to:

```http
POST https://zpeedfgyuusscsrirzsg.supabase.co/functions/v1/open-brain-mcp?key=YOUR_MCP_ACCESS_KEY
```

With JSON-RPC payload format:

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "tools/call",
  "params": {
    "name": "capture_thought",
    "arguments": {
      "content": "extracted content here",
      "title": "email subject or document title",
      "source": "gmail-drive",
      "tags": ["email", "gmail", "drive", "document"],
      "project": "open-brain"
    }
  }
}
```

### 3. Activate Workflows

Ensure all three workflows are active and scheduled:
- OB Gmail Ingestion
- OB Drive Ingestion  
- OB Meeting Notes Ingestion

## Expected Outcome

- Daily automatic ingestion of new Gmail emails
- Daily capture of Google Drive documents and notes
- Meeting notes processed for key insights and action items
- All content stored in Open Brain v2 with proper metadata
- Content searchable via MCP tools

## Troubleshooting

**Issue: Workflows failing to authenticate**
- Check Gmail/Drive OAuth credentials in n8n
- Verify API permissions are correctly configured
- Ensure refresh tokens are valid

**Issue: Capture endpoint errors**
- Verify the Supabase URL is correct
- Check that MCP_ACCESS_KEY is properly configured
- Ensure the endpoint is running and accessible

**Issue: Missing content in captured items**
- Check if email/document extraction is working
- Verify AI processing nodes in workflows
- Ensure output formats match expected schema

**Issue: Rate limiting issues**
- Gmail has quotas on API calls
- Consider batching requests for large volumes
- Adjust workflow timing if needed

**Issue: Time zone issues**
- Ensure workflows run in UTC (23:00)
- Check that scheduled times are correctly set in n8n
- Verify date calculations are accurate