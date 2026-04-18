# Chrome Capture Extension

> Chrome MV3 extension that captures conversations from Claude, ChatGPT, and Gemini into your Open Brain via the REST API gateway.

## What It Does

A client-side Chrome (or Chromium-based browser) extension that sits on top of Claude.ai, chatgpt.com, and gemini.google.com. When you finish an interesting exchange, click the extension icon and the extension extracts the latest user + assistant turn from the page DOM, runs local sensitivity and duplicate filters, and POSTs the result to your Open Brain REST API gateway. It also supports bulk backfill from Claude and ChatGPT using their internal conversation APIs so you can import your existing chat history in one pass.

This is a **client-side** integration — unlike the other integrations in this repo (Slack, Discord, email capture) which deploy as Supabase Edge Functions, a Chrome extension runs entirely in the user's browser. It does **not** register as an MCP server. All it does is call the REST API gateway's `/ingest` endpoint with standard `x-brain-key` auth. Every user installs it locally against their own Open Brain.

## Screenshots

Placeholder. See [`docs/screenshots/README.md`](docs/screenshots/README.md) for the expected filenames. The four targets are:

- First-run Configure screen (URL + API key entry)
- Popup on a Claude tab with Capture Current Response visible
- Activity log showing a successful capture plus a duplicate/skipped one
- Sync tab with Claude full/incremental sync controls

## Prerequisites

- Working Open Brain setup ([guide](../../docs/01-getting-started.md))
- The [REST API gateway integration](../rest-api/) deployed and reachable — the extension POSTs to `/open-brain-rest/ingest` and pings `/open-brain-rest/health`
- An `MCP_ACCESS_KEY` (or equivalent `x-brain-key` token) issued by your Open Brain for this device
- Chrome 120+, or any Chromium-based browser that supports MV3 (Edge 120+, Brave, Arc, Opera)

## Credential Tracker

Copy this block into a text editor and fill it in as you go.

```text
CHROME CAPTURE EXTENSION -- CREDENTIAL TRACKER
--------------------------------------

FROM YOUR OPEN BRAIN SETUP
  REST API base URL:     ____________
    (Supabase example: https://YOUR_PROJECT_REF.supabase.co/functions/v1
     Self-hosted example: https://brain.example.com)
  x-brain-key API key:   ____________

BROWSER INFO
  Browser + version:     ____________
  Extension ID (after install): ____________

--------------------------------------
```

## Installation

1. Download or clone this repository to your machine
2. Open your Chromium-based browser and go to `chrome://extensions`
3. Toggle **Developer mode** on (top-right)
4. Click **Load unpacked** and pick the `integrations/chrome-capture-extension/` folder
5. Pin the extension icon to the toolbar so you can reach it quickly
6. A new tab opens automatically on first install — the Configure Open Brain screen (see below)

## First-Run Config

The extension ships with **no hardcoded server URLs**. On first install it opens `popup/config.html` and asks for two things:

1. **Open Brain REST API URL** — the base URL of your REST API gateway. Examples:
   - Supabase-hosted: `https://your-project-ref.supabase.co/functions/v1`
   - Self-hosted: `https://brain.example.com`
2. **API Key** — the `x-brain-key` (`MCP_ACCESS_KEY`) you configured when deploying the REST API integration

When you click **Save & Grant Permission**, Chrome shows a native permission prompt asking whether the extension may access the specific origin you entered. Approve it. This is a one-time grant — Chrome remembers it and the extension can now talk to your Open Brain without asking again. You can revoke the grant any time from `chrome://extensions → Open Brain Capture → Details → Site access`.

**Storage details:**
- API key → `chrome.storage.local` (per-device only, **never** synced across Chrome profiles)
- API URL + platform toggles + thresholds → `chrome.storage.sync` (follows your Google account across devices)

## Usage

**Manual capture (primary workflow):**

1. Open a conversation on Claude.ai, chatgpt.com, or gemini.google.com
2. Click the extension icon in the toolbar
3. Click **Capture Current Response**
4. Watch the Activity log on the Overview tab — you should see `captured` and the sent counter tick up
5. Confirm the thought arrived in your Open Brain (query `search_thoughts` or peek at your database's `thoughts` table)

**Bulk backfill (Claude and ChatGPT):**

Switch to the Sync tab and click **Sync All** under the platform you want to import. The extension walks the platform's internal conversation API using your existing logged-in session and funnels every conversation through the capture pipeline. Dedup is handled automatically via SHA-256 content fingerprints — running Sync All twice is safe. Incremental **Sync New** only imports conversations whose `updated_at` has changed since the last run. Optionally turn on **Auto-sync every 15 min** to keep new conversations flowing in hands-free.

## Supported Sites

| Site | Manual capture | Bulk sync | Notes |
|------|---------------|-----------|-------|
| `claude.ai` | Yes | Yes | Uses Claude's internal `/api/organizations/.../chat_conversations` endpoint for bulk sync. DOM extractor walks open shadow roots to survive UI refactors. |
| `chatgpt.com`, `chat.openai.com` | Yes | Yes | Uses ChatGPT's `/backend-api/conversations` for bulk sync and `data-message-author-role` selectors for manual capture. |
| `gemini.google.com` | Yes (best-effort) | No | Google exposes no conversation API. Manual capture only. Selectors target `<user-query>` and `<model-response>` Web Components — Google rewrites this UI frequently, so extractor fragility is expected. |

## Architecture

```
┌──────────────────────────┐
│ claude.ai / chatgpt.com  │
│ / gemini.google.com tab  │
└──────────┬───────────────┘
           │ content script (bridge.js + extractor-<platform>.js)
           │ extracts last user+assistant turn from DOM
           ▼
┌──────────────────────────┐
│ background/service-      │
│ worker.js                │
│  - sensitivity filter    │
│  - SHA-256 fingerprint   │
│  - retry queue (5 tries, │
│    exponential backoff)  │
└──────────┬───────────────┘
           │ fetch() with x-brain-key header
           ▼
┌──────────────────────────┐
│ Open Brain REST API      │
│ /open-brain-rest/ingest  │
│ (Supabase Edge Function) │
└──────────────────────────┘
```

The service worker is the only network caller. Content scripts never touch the network — they only extract DOM text and hand it over via `chrome.runtime.sendMessage`. This keeps the API key out of every page's origin and makes the permission model reviewable.

## Host Permissions Approach

This extension uses **`optional_host_permissions` + runtime `chrome.permissions.request()`**, not `<all_urls>` at install time. Trade-off analysis:

| Approach | Pros | Cons |
|----------|------|------|
| `host_permissions: ["<all_urls>"]` | One-line manifest, no prompt flow | Chrome Web Store flags it as a high-risk permission, install-time prompt scares users, extension can hit any site |
| `optional_host_permissions` + runtime request (chosen) | Minimum-viable permissions, user sees exactly which origin they're granting, survives Chrome Web Store review | Requires a Configure screen + one extra click during setup |

The extension declares `optional_host_permissions: ["https://*/*", "http://*/*"]` in the manifest. On the Configure screen it parses the user's URL, derives an origin pattern like `https://your-project-ref.supabase.co/*`, and calls `chrome.permissions.request({ origins: [origin] })`. The user approves once; Chrome persists the grant; the service worker can now `fetch()` that origin. Nothing else.

The `content_scripts` entries for `claude.ai`, `chatgpt.com`, and `gemini.google.com` remain as normal `host_permissions` because the content scripts inject at `document_idle` on page load — they can't wait for a runtime prompt. Those three origins are scoped narrowly and visible in the install dialog.

## Security

- **API key storage.** The `x-brain-key` lives in `chrome.storage.local`. Chrome encrypts local storage on disk with OS-level keys, and the key is **never** written to `chrome.storage.sync` — meaning it does not propagate to your other Chrome profiles on the same Google account. Rotate by reopening the Configure screen and saving a new value. Uninstalling the extension removes the key along with it.
- **Client-side sensitivity filtering.** `data/sensitivity-patterns.json` holds regex patterns for SSNs, passports, bank accounts, API keys, credit cards, passwords-in-URLs, and medical/financial markers. Anything matching a `restricted` pattern is blocked locally before the request is even built — the text never leaves the browser. `personal` matches are logged but allowed through. Patterns compile once per session and are tested with `String.prototype.match` regex semantics.
- **Outbound requests.** Only the service worker calls `fetch()`, and only to the user-configured origin. No telemetry, no analytics, no third-party hosts.
- **Retry queue integrity.** Failed captures live in `chrome.storage.local` with the full payload and a `nextRetryAt` timestamp. Retries honour exponential backoff (1, 2, 4, 8, 16 minutes, capped at 60), max 5 attempts, then a dead-letter entry in the activity log. Fingerprints live across retries so a retry-then-manual-retry doesn't produce duplicates in Open Brain.
- **CSP.** Manifest V3 service workers run under a strict CSP that forbids `eval` and remote script loading. The lib scripts are all local.

## Publishing to Chrome Web Store

**Status: future work.** This contribution is currently distributed as an unpacked/developer-mode install. To publish to the Chrome Web Store, a maintainer will need to:

1. Provide a 1.0.0-ready icon set (16/32/48/128 PNGs — see [`icons/README.md`](icons/README.md))
2. Fill in the store listing: description, category (Productivity), screenshots, privacy policy URL
3. Draft the **permission justifications** — the store review team requires a paragraph per declared permission. Suggested text:
   - `storage` — "Persists user-supplied Open Brain API URL, API key, and per-platform capture toggles."
   - `alarms` — "Scheduled retry of failed ingests and optional 15-minute auto-sync from Claude/ChatGPT."
   - `activeTab`, `tabs` — "Resolves the active conversation tab when the user clicks Capture."
   - `cookies` — "Reads the `lastActiveOrg` cookie on claude.ai and the session cookie on chatgpt.com to bulk-fetch conversations via each platform's internal API using the user's own session."
   - Host permissions for `claude.ai`, `chatgpt.com`, `chat.openai.com`, `gemini.google.com` — "Content scripts extract the latest conversation turn from the page DOM when the user clicks Capture."
   - `optional_host_permissions` — "Runtime-granted by the user to reach their specific Open Brain API URL."
4. Pay the $5 one-time developer registration fee
5. Submit for review (typically 3–7 business days)

Alternatively, host the packed `.crx` on a maintainer-owned update URL and let users sideload without going through the store at all.

## Known Limitations

- **DOM extraction is fragile.** Claude, ChatGPT, and Gemini all ship UI rewrites without notice. When a platform shuffles its selectors, manual capture returns "No conversation turns found" until the extractor is updated. The Gemini extractor is especially exposed — Google ships new Gemini UIs every few months. Expect occasional maintenance PRs. Bulk sync (Claude + ChatGPT) uses stable internal JSON APIs and is far less fragile than DOM extraction.
- **No passive/ambient capture yet.** The extension only captures when the user explicitly clicks Capture or runs Sync. A previous "observe every turn" design was retired because keeping up with selector churn on every render was not sustainable. Re-introducing ambient capture is tracked as future work.
- **Gemini has no bulk sync.** Google does not expose a conversation history API outside the Gemini UI. Manual capture is the only option.
- **Large conversations.** The REST API `/ingest` endpoint accepts a single payload per request. A 400-turn Claude thread becomes one very large POST. If your gateway has a request size cap (Supabase default is 10MB), Sync All may dead-letter the longest conversations. Check the activity log and trim in your dashboard if that happens.
- **Sensitivity filter is regex-only.** It's deliberately conservative — false negatives are possible. Treat it as a guardrail, not a vault. For truly sensitive content, don't paste it into an AI chat in the first place.

## Troubleshooting

**Issue: Extension icon has a yellow `!` badge and captures fail**
Solution: The extension is not configured. Click the icon, then click **Open Configure screen** in the yellow banner, and supply your Open Brain REST API URL + API key.

**Issue: "Missing x-brain-key API key" error when I click Capture**
Solution: Either the API key was never saved, or Chrome's local storage got cleared (this can happen after a browser profile reset). Open the Settings tab → **Reconfigure API URL & Key** and re-enter.

**Issue: "Cannot reach the page" error when capturing**
Solution: The content script isn't loaded on this tab. Refresh the tab and retry. If the page is still on the same URL family that the manifest declares (`claude.ai/*`, `chatgpt.com/*`, etc.), the refresh will re-inject the script. If the error persists, disable and re-enable the extension from `chrome://extensions`.

**Issue: "No conversation turns found" on Claude / ChatGPT / Gemini**
Solution: The site DOM has changed and the extractor selectors are stale. Check the repo for a newer version of the extension; if there isn't one yet, open an issue with a sample of the current DOM and the `chrome://extensions → errors` output.

**Issue: Sync All reports every conversation as `existing` but your Open Brain is empty**
Solution: The SHA-256 fingerprint cache is populated but the ingest POSTs are silently rejected. Open the Activity log on the Overview tab and look for `queued_retry` or `dead_letter` entries — those will show the actual API error. Common cause: the REST API gateway is deployed but `MCP_ACCESS_KEY` was rotated and you didn't update the extension.

**Issue: I configured the extension but Test Connection says "fetch failed"**
Solution: Your browser doesn't have host permission for that origin. Open the Configure screen and save again — Chrome will re-prompt. If it still fails, verify the URL is reachable from your browser (paste it directly into the address bar, expect a 401 or similar from the gateway).

## Tool Surface Area

This integration is a **capture source**, not an MCP server — it doesn't expose any tools to your AI. It only writes into Open Brain. The AI-facing tool count of your setup is unchanged by installing this extension.

If you're weighing whether to add more MCP-exposing extensions on top, see the [MCP Tool Audit & Optimization Guide](../../docs/05-tool-audit.md) for how to keep your tool count manageable as your Open Brain grows.
