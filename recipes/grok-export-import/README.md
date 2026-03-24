# Grok Export Import

<div align="center">

![Community Contribution](https://img.shields.io/badge/OB1_COMMUNITY-Approved_Contribution-2ea44f?style=for-the-badge&logo=github)

**Created by [@alanshurafa](https://github.com/alanshurafa)**

*Reviewed and merged by the Open Brain maintainer team — thank you for building the future of AI memory!*

</div>

> Import xAI Grok conversation history into Open Brain as searchable thoughts.

## What It Does

Parses xAI Grok conversation exports (JSON format with MongoDB-style dates) and imports each conversation as a thought with embeddings. Handles nested conversation/response structures and MongoDB date objects.

## Prerequisites

- Working Open Brain setup ([guide](../../docs/01-getting-started.md))
- **Grok data export** — JSON file from X/Grok
- **Node.js 18+** installed
- **OpenRouter API key** for embedding generation

## Credential Tracker

```text
GROK EXPORT IMPORT -- CREDENTIAL TRACKER
--------------------------------------

FROM YOUR OPEN BRAIN SETUP
  Supabase URL:          ____________
  Service Role Key:      ____________

FROM OPENROUTER
  API Key:               ____________

--------------------------------------
```

## Steps

1. **Export your Grok data:**
   - Request your data export from X (formerly Twitter)
   - The Grok conversations are included in the data archive
   - Find the Grok JSON file in the export

2. **Copy this recipe folder** and install dependencies:
   ```bash
   cd recipes/grok-export-import
   npm install
   ```

3. **Create `.env`** with your credentials (see `.env.example`):
   ```env
   SUPABASE_URL=https://your-project.supabase.co
   SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
   OPENROUTER_API_KEY=sk-or-v1-your-key
   ```

4. **Preview what will be imported** (dry run):
   ```bash
   node import-grok.mjs /path/to/grok-export.json --dry-run
   ```

5. **Run the import:**
   ```bash
   node import-grok.mjs /path/to/grok-export.json
   ```

## Expected Outcome

After running the import:
- Each Grok conversation becomes a thought with `source_type: grok_import`
- MongoDB-style dates (`$date.$numberLong`) are properly parsed to ISO timestamps
- Running `search_thoughts` finds relevant Grok conversations

**Scale reference:** Tested with 750+ Grok conversations imported successfully.

## Troubleshooting

**Issue: Date parsing errors**
Grok uses MongoDB's `{$date: {$numberLong: "..."}}` format. The script handles this automatically. If you see wrong dates, check that the JSON file hasn't been modified.

**Issue: "conversations" field not found**
The script looks for `parsed.conversations` first, then treats the root as an array. Different Grok export versions may structure the data differently.
