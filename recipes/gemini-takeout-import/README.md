# Gemini Takeout Import

> Import Google Gemini AI conversations into Open Brain as searchable thoughts.

## What It Does

Parses Google Takeout's Gemini Apps export (HTML format) and imports each conversation entry as a thought with embeddings. Your Gemini AI conversation history becomes semantically searchable in Open Brain.

## Prerequisites

- Working Open Brain setup ([guide](../../docs/01-getting-started.md))
- **Google Takeout export** with Gemini Apps data (HTML format)
- **Node.js 18+** installed
- **OpenRouter API key** for embedding generation

## Credential Tracker

```text
GEMINI TAKEOUT IMPORT -- CREDENTIAL TRACKER
--------------------------------------

FROM YOUR OPEN BRAIN SETUP
  Supabase URL:          ____________
  Service Role Key:      ____________

FROM OPENROUTER
  API Key:               ____________

--------------------------------------
```

## Steps

1. **Export your Gemini data from Google Takeout:**
   - Go to [Google Takeout](https://takeout.google.com/)
   - Deselect all, then select **Gemini Apps**
   - Choose **HTML** format
   - Export and download the archive
   - Extract and find the `My Activity` HTML file

2. **Copy this recipe folder** and install dependencies:
   ```bash
   cd gemini-takeout-import
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
   node import-gemini.mjs /path/to/MyActivity.html --dry-run
   ```

5. **Run the import:**
   ```bash
   node import-gemini.mjs /path/to/MyActivity.html
   ```

## Expected Outcome

After running the import:
- Each Gemini conversation entry becomes a thought with `source_type: gemini_import`
- Prompts are preserved and prefixed in the content
- Running `search_thoughts { query: "explain quantum computing" }` finds relevant Gemini conversations
- Dry run shows: `[1/500] Would import: "Gemini: explain quantum computing" (1240 chars)`

**Scale reference:** Tested with 26 MB of Gemini HTML → 8,000+ thoughts imported.

## Troubleshooting

**Issue: No entries found**
Make sure the HTML file contains `class="outer-cell"` elements. Gemini's takeout format uses this CSS class to separate entries. If the file is empty or in a different format, re-export from Google Takeout.

**Issue: Garbled text in imported thoughts**
HTML entity decoding handles common entities (&amp;, &lt;, etc.) but unusual Unicode may not decode perfectly. The imported text should still be searchable.

**Issue: Feedback entries being imported**
Entries starting with "Gave feedback:" are automatically filtered out as noise.
