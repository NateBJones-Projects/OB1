# Chrome Extension — Browser Capture & Search

Save and search your Open Brain second brain directly from your browser. Capture thoughts from any webpage with automatic source tracking, search semantically across all your thoughts, and use keyboard shortcuts for fast access.

## Features

- **Save thoughts** from any webpage — source URL and page title are attached automatically
- **Semantic search** across all your thoughts (browser, Telegram, Slack, Claude)
- **Auto-capture** — select text on a page, open the extension, and it's pre-filled
- **Right-click menu** — save or search selected text without opening the popup
- **Omnibox** — type `brain <query>` in the address bar for instant search
- **Related thoughts** — after saving, see similar thoughts you captured before
- **Source filter** — filter search results by origin (browser, Telegram, Slack, Claude)
- **Click to copy** — click any search result to copy it to clipboard
- **Delete and complete** — remove thoughts or mark tasks as done directly from search results
- **Keyboard shortcut** — `Ctrl+Shift+B` (or `Cmd+Shift+B` on Mac) to open
- **Stats bar** — see total thoughts, today's count, and this week's count at a glance

## Prerequisites

- A working [Open Brain](https://github.com/NateBJones-Projects/OB1) setup with:
  - The `thoughts` table and `match_thoughts` function in Supabase
  - An [OpenRouter](https://openrouter.ai) API key (for embeddings and metadata extraction)
- Chrome or any Chromium-based browser (Edge, Brave, Arc, etc.)
- Supabase CLI installed (`npm install -g supabase`)

## Step-by-Step Setup

### 1. Deploy the brain-api Edge Function

The extension communicates with your Open Brain through a lightweight REST API (included in `supabase-function/`).

**Set your secrets** (one-time):

```bash
supabase secrets set OPENROUTER_API_KEY=your-openrouter-key --project-ref YOUR_PROJECT_REF
supabase secrets set BRAIN_API_KEY=$(openssl rand -hex 32) --project-ref YOUR_PROJECT_REF
```

Write down the `BRAIN_API_KEY` you generated — you will need it in step 3.

**Deploy the function:**

```bash
cd supabase-function
supabase functions deploy brain-api --project-ref YOUR_PROJECT_REF --no-verify-jwt
```

**Verify it works:**

```bash
curl -X POST https://YOUR_PROJECT_REF.supabase.co/functions/v1/brain-api \
  -H "Content-Type: application/json" \
  -H "x-brain-key: YOUR_BRAIN_API_KEY" \
  -d '{"action": "stats"}'
```

You should see a JSON response with `total`, `today`, and `this_week` counts.

### 2. Install the Chrome Extension

1. Open `chrome://extensions/` in your browser
2. Enable **Developer mode** (toggle in the top right)
3. Click **Load unpacked**
4. Navigate to the `chrome-extension/` folder inside this contribution and select it
5. The Open Brain icon (brain emoji) should now appear in your toolbar

### 3. Configure the Extension

1. Click the Open Brain icon in your toolbar (or press `Ctrl+Shift+B`)
2. The settings panel opens automatically on first use
3. Enter:
   - **API URL**: `https://YOUR_PROJECT_REF.supabase.co/functions/v1/brain-api`
   - **API Key**: the `BRAIN_API_KEY` you generated in step 1
4. Click **Einstellungen speichern**

The stats bar should now show your thought counts.

## Expected Outcome

After setup, you should be able to:

1. **Open the popup** with `Ctrl+Shift+B` and see your thought stats (total, today, this week)
2. **Type a thought** in the text area and press `Ctrl+Enter` to save it — you should see "Gedanke gespeichert!" and related thoughts appear below
3. **Search** by typing a query in the search field — results appear with source badges, dates, and similarity scores
4. **Right-click** selected text on any webpage and see "Im Brain speichern" and "Im Brain suchen" in the context menu
5. **Type `brain` in the address bar**, press Tab, and type a query to get instant search suggestions

## Usage

| Action | How |
| --- | --- |
| Save a thought | Open popup, type, press `Ctrl+Enter` |
| Save selected text | Select text on page, right-click, "Im Brain speichern" |
| Search | Open popup, type in search field, press Enter |
| Search selected text | Select text, right-click, "Im Brain suchen" |
| Omnibox search | Type `brain` in address bar, press Tab, type query |
| Copy a result | Click on the result text |
| Delete a thought | Hover over result, click X, confirm |
| Complete a task | Hover over a task result, click "Erledigt" |
| Filter by source | Use the dropdown next to the search field |

## Troubleshooting

**"API nicht konfiguriert" error**
Open the extension, expand Settings at the bottom, and enter your API URL and API Key. Make sure there are no trailing spaces.

**Stats show "--" after configuration**
Your brain-api function may not be deployed or the API key is wrong. Test with the curl command from step 1 above.

**Right-click menu doesn't appear**
Go to `chrome://extensions/`, find Open Brain, and click the reload button. The context menu is registered on install — reloading the extension re-triggers it.

**"Suche laeuft..." hangs forever**
Check that your Supabase project is active (not paused). Free-tier projects pause after 7 days of inactivity. Go to your Supabase dashboard and restore it if needed.

**Extension doesn't capture selected text automatically**
Auto-capture doesn't work on `chrome://` pages, PDF viewers, or pages with strict Content Security Policy. This is a Chrome security restriction.

## Tech Stack

- Chrome Extension Manifest V3
- Supabase Edge Functions (Deno/TypeScript)
- pgvector for semantic search
- OpenRouter API (text-embedding-3-small for embeddings, gpt-4o-mini for metadata extraction)

## License

MIT
