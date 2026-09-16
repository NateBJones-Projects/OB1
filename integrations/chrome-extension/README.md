# Chrome Extension: Browser Capture & Search

> Save thoughts from any webpage and search your Open Brain semantically, straight from the browser toolbar, context menu, or address bar.

## What It Does

A Manifest V3 browser extension that captures text from the page you are reading into Open Brain (with the page title and URL attached) and runs semantic search across all your thoughts, whatever tool captured them. It talks to your Open Brain through the [Open Brain REST gateway](../open-brain-rest/), so it needs no Edge Function of its own.

Looking for automatic capture of Claude, ChatGPT, or Gemini conversations instead? See the [Chrome Capture Extension](../chrome-capture-extension/). The two extensions use the same gateway and can be installed side by side.

### Features

- **Save thoughts** from any webpage. The source URL and page title are attached automatically
- **Automatic classification.** The gateway extracts a type (`observation`, `task`, `idea`, `reference`, `person_note`, ...), topics, people, and action items for every saved thought
- **Semantic search** across all your thoughts (browser, Telegram, Slack, Claude, MCP)
- **Auto-capture.** Select text on a page, open the extension, and the text is pre-filled
- **Right-click menu.** Save or search selected text without opening the popup
- **Omnibox.** Type `brain <query>` in the address bar for instant search
- **Related thoughts.** After saving, see similar thoughts you captured before
- **Source filter.** Filter search results by origin
- **Click to copy.** Click any search result to copy it to the clipboard
- **Delete and complete.** Remove thoughts or mark tasks as done directly from search results
- **Keyboard shortcut.** `Ctrl+Shift+B` (or `Cmd+Shift+B` on Mac) opens the popup
- **Stats bar.** Total thoughts plus how many you captured in the last 24 hours and the last 7 days

## Prerequisites

- Working Open Brain setup ([guide](../../docs/01-getting-started.md)), including the local project folder with the `supabase/` directory from Step 6 and your `MCP_ACCESS_KEY`
- The [Enhanced Thoughts schema](../../schemas/enhanced-thoughts/) applied to your database (the REST gateway reads its columns and RPCs). The [Workflow Status schema](../../schemas/workflow-status/) is optional because Enhanced Thoughts already adds the `status` columns
- Supabase CLI installed and linked to your project (done in the getting started guide)
- Chrome or any Chromium-based browser (Edge, Brave, Arc, Opera). The "Search in Brain" context menu opens the popup automatically on Chrome 127 or newer; on older versions the query is waiting when you open the popup yourself

## Credential Tracker

Copy this block into a text editor and fill it in as you go.

```text
CHROME EXTENSION -- CREDENTIAL TRACKER
--------------------------------------

FROM YOUR OPEN BRAIN SETUP
  Project ref:           ____________
  MCP access key:        ____________
  OpenRouter API key:    ____________  (already set as a Supabase secret)

GENERATED DURING SETUP
  REST gateway URL:      https://YOUR_PROJECT_REF.supabase.co/functions/v1/open-brain-rest

--------------------------------------
```

## Steps

### Part 1: Deploy the REST gateway

Skip this part if `open-brain-rest` is already deployed (for example for the dashboard or the Chrome Capture Extension). Test it with the health check in step 5 below.

Run every command from your Open Brain project folder, the one that contains the `supabase/` directory. The Supabase CLI only finds your project from there.

1. Apply the Enhanced Thoughts schema if you have not done so yet. Follow the steps in [`schemas/enhanced-thoughts`](../../schemas/enhanced-thoughts/).

2. Create the function folder:

   ```bash
   supabase functions new open-brain-rest
   ```

3. Download the gateway code into it:

   ```bash
   curl -o supabase/functions/open-brain-rest/index.ts https://raw.githubusercontent.com/NateBJones-Projects/OB1/main/integrations/open-brain-rest/index.ts
   curl -o supabase/functions/open-brain-rest/deno.json https://raw.githubusercontent.com/NateBJones-Projects/OB1/main/integrations/open-brain-rest/deno.json
   ```

   If you work from a clone of this repository, you can copy both files from `integrations/open-brain-rest/` instead.

4. Make sure the secrets exist, then deploy. `MCP_ACCESS_KEY` and `OPENROUTER_API_KEY` were set during the core setup (Step 6.5) and are shared by all functions in the project, so you only need to set them again if they are missing (`supabase secrets list` shows them):

   ```bash
   supabase secrets set MCP_ACCESS_KEY=your-access-key-from-step-5
   supabase secrets set OPENROUTER_API_KEY=your-openrouter-key-here
   ```

   ```bash
   supabase functions deploy open-brain-rest --no-verify-jwt
   ```

   The first line of the output should say `Using workdir` followed by your project folder. `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are provided to the function automatically.

5. Verify the gateway answers:

   ```bash
   curl https://YOUR_PROJECT_REF.supabase.co/functions/v1/open-brain-rest/health \
     -H "x-brain-key: YOUR_MCP_ACCESS_KEY"
   ```

   You should see `{"ok":true,"status":"ok","service":"open-brain-rest",...}`.

### Part 2: Install the extension

1. Download or clone this repository
2. Open `chrome://extensions/` in your browser
3. Enable **Developer mode** (toggle in the top right)
4. Click **Load unpacked** and select the `integrations/chrome-extension/chrome-extension/` folder
5. Pin the Open Brain icon to your toolbar

### Part 3: Configure the extension

1. Click the Open Brain icon in your toolbar (or press `Ctrl+Shift+B`). The settings panel opens automatically on first use
2. Enter:
   - **API URL**: `https://YOUR_PROJECT_REF.supabase.co/functions/v1/open-brain-rest` (no trailing path)
   - **API Key**: your `MCP_ACCESS_KEY`
3. Click **Save settings**

The stats bar should now show your thought counts.

## Expected Outcome

After setup, you should be able to:

1. **Open the popup** with `Ctrl+Shift+B` and see your stats (total thoughts, last 24 hours, last 7 days)
2. **Type a thought** in the text area and press `Ctrl+Enter` to save it. You should see "Thought saved!" and related thoughts appear below
3. **Search** by typing a query in the search field. Results appear with source badges, dates, and similarity scores
4. **Right-click** selected text on any webpage and see "Save to Brain" and "Search in Brain" in the context menu. After saving, the toolbar icon briefly shows an `OK` badge
5. **Type `brain` in the address bar**, press Tab, and type a query to get instant search suggestions

In the Supabase Table Editor, a thought saved from the extension has `source_type = browser`, a classified `type`, and `url` and `title` inside `metadata`.

## Usage

| Action | How |
| --- | --- |
| Save a thought | Open popup, type, press `Ctrl+Enter` |
| Save selected text | Select text on page, right-click, "Save to Brain" |
| Search | Open popup, type in search field, press Enter |
| Search selected text | Select text, right-click, "Search in Brain" |
| Omnibox search | Type `brain` in address bar, press Tab, type query |
| Copy a result | Click on the result text |
| Delete a thought | Hover over a result, click X, confirm with "Yes" |
| Complete a task | Hover over a task result, click "Done" |
| Filter by source | Use the dropdown next to the search field |

## Troubleshooting

**Issue: "API not configured. Please check settings." error**
Solution: Open the extension, expand Settings at the bottom, and enter your API URL and API Key. Make sure there are no spaces around the key.

**Issue: Stats show "--" or every action fails with "Failed to fetch"**
Solution: The extension cannot reach the gateway. Check, in this order:
- The API URL ends in `/functions/v1/open-brain-rest` and points to your project ref
- The health check from Part 1, step 5 succeeds in a terminal
- Your Supabase project is active. Free-tier projects pause after 7 days of inactivity; restore it from the Supabase dashboard
- A company firewall, VPN, or browser privacy extension is not blocking `*.supabase.co`

**Issue: "API error (401)"**
Solution: The API Key does not match the `MCP_ACCESS_KEY` secret. Copy it again from your credential tracker, or reset it with `supabase secrets set MCP_ACCESS_KEY=...` and update both the extension and your AI connectors.

**Issue: "API error (500)" mentioning a missing column such as `sensitivity_tier` or `type`**
Solution: The Enhanced Thoughts schema is not applied. Apply [`schemas/enhanced-thoughts`](../../schemas/enhanced-thoughts/) and try again.

**Issue: "API error (404)" on every request**
Solution: The gateway is not deployed under the name `open-brain-rest`, or the API URL has an extra path. Redeploy with `supabase functions deploy open-brain-rest --no-verify-jwt` and use the exact URL from the credential tracker.

**Issue: Right-click menu doesn't appear**
Solution: Go to `chrome://extensions/`, find Open Brain, and click the reload button. The context menu is registered on install, so reloading the extension registers it again.

**Issue: "Searching..." never finishes**
Solution: Semantic search needs `OPENROUTER_API_KEY`. Check `supabase secrets list` and look at the function logs in the Supabase dashboard (Edge Functions → open-brain-rest → Logs).

**Issue: Selected text is not pre-filled in the popup**
Solution: Auto-capture does not work on `chrome://` pages, the built-in PDF viewer, or the Chrome Web Store. This is a Chrome security restriction.

## Security Notes

- The API key is your `MCP_ACCESS_KEY`, which grants full read and write access to your Open Brain. The extension keeps it in `chrome.storage.sync`, so Chrome syncs it to other devices signed in to the same browser profile. Only install the extension in profiles you control
- `host_permissions` are limited to `https://*.supabase.co/*`. If you self-host the gateway on another domain, add that domain to `manifest.json`
- Search results are rendered with HTML escaping, and restricted thoughts (`sensitivity_tier = restricted`) are excluded by the gateway

## How It Works

- Chrome Extension Manifest V3: popup, background service worker, context menu, omnibox
- `chrome-extension/api.js` is the only file that talks to the network. It calls these `open-brain-rest` endpoints:

| Feature | Endpoint |
| --- | --- |
| Save | `POST /capture`, then `PUT /thought/:id` to attach page `url` and `title` to the metadata |
| Search, related thoughts, omnibox | `POST /search` (semantic mode) |
| Source filter | `POST /search` with a wider result window, filtered in the extension by `source_type` |
| Stats | `GET /stats?days=1` and `GET /stats?days=7` |
| Delete | `DELETE /thought/:id` |
| Mark task as done | `PUT /thought/:id` with `status: "done"` |

- Embeddings (`text-embedding-3-small`) and metadata extraction (`gpt-4o-mini`) run inside the gateway through OpenRouter, matching the core Open Brain setup

## Tool Surface Area

This extension does not add MCP tools; it uses the REST gateway directly. If you are weighing whether to add MCP-exposing integrations on top, see the [MCP Tool Audit & Optimization Guide](../../docs/05-tool-audit.md) for how to keep your tool count manageable as your Open Brain grows.
