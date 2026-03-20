# Claude Export Import

> Import Anthropic Claude conversation history into Open Brain as searchable thoughts.

## What It Does

Parses Claude's conversation export (JSON format) and imports each conversation as a thought with embeddings. Handles both `chat_messages` array and nested `content` block formats.

## Prerequisites

- Working Open Brain setup ([guide](../../docs/01-getting-started.md))
- **Claude data export** — JSON file from Anthropic
- **Node.js 18+** installed
- **OpenRouter API key** for embedding generation

## Credential Tracker

```text
CLAUDE EXPORT IMPORT -- CREDENTIAL TRACKER
--------------------------------------

FROM YOUR OPEN BRAIN SETUP
  Supabase URL:          ____________
  Service Role Key:      ____________

FROM OPENROUTER
  API Key:               ____________

--------------------------------------
```

## Steps

1. **Export your Claude data:**
   - Go to [Claude Settings](https://claude.ai/settings) → Export data
   - Download and extract the archive
   - Find the conversations JSON file

2. **Copy this recipe folder** and install dependencies:
   ```bash
   cd claude-export-import
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
   node import-claude.mjs /path/to/conversations.json --dry-run
   ```

5. **Run the import:**
   ```bash
   node import-claude.mjs /path/to/conversations.json
   ```

## Expected Outcome

After running the import:
- Each Claude conversation becomes a thought with `source_type: claude_import`
- Full USER/ASSISTANT transcripts are preserved
- Consecutive duplicate messages are deduplicated
- Running `search_thoughts { query: "code review discussion" }` finds relevant Claude conversations

**Scale reference:** Tested with 800+ Claude conversations imported successfully.

## Troubleshooting

**Issue: JSON parse error**
The file might contain a single conversation object instead of an array. The script handles both formats — if the error persists, check that the file is valid JSON.

**Issue: Empty messages or missing content**
Claude exports use different content formats across versions. The script handles `content[]` arrays, `.text` fields, and string content. If a specific format isn't handled, open an issue.

**Issue: "sender" field not recognized**
Claude uses `sender: "human"` or `sender: "assistant"`. Both are normalized to USER/ASSISTANT in the output.
