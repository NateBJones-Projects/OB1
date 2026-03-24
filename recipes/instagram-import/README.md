# Instagram Import

<div align="center">

![Community Contribution](https://img.shields.io/badge/OB1_COMMUNITY-Approved_Contribution-2ea44f?style=for-the-badge&logo=github)

**Created by [@alanshurafa](https://github.com/alanshurafa)**

*Reviewed and merged by the Open Brain maintainer team — thank you for building the future of AI memory!*

</div>

> Import your Instagram data — DMs, comments, and post captions — into Open Brain.

## What It Does

Parses Instagram's data export and imports three types of content as searchable thoughts:
- **Messages** — DM conversations (minimum 3 messages per conversation)
- **Comments** — Your comments on posts, batched together
- **Posts** — Your post captions, batched together

Handles Meta's double-encoded UTF-8 text (latin1 → UTF-8 conversion).

## Prerequisites

- Working Open Brain setup ([guide](../../docs/01-getting-started.md))
- **Instagram data export** — download from Instagram Settings
- **Node.js 18+** installed
- **OpenRouter API key** for embedding generation

## Credential Tracker

```text
INSTAGRAM IMPORT -- CREDENTIAL TRACKER
--------------------------------------

FROM YOUR OPEN BRAIN SETUP
  Supabase URL:          ____________
  Service Role Key:      ____________

FROM OPENROUTER
  API Key:               ____________

--------------------------------------
```

## Steps

1. **Request your Instagram data:**
   - Go to Instagram → Settings → Accounts Center → Your information and permissions → Download your information
   - Select **JSON** format
   - Download and extract the archive
   - Look for the `your_instagram_activity/` folder

2. **Copy this recipe folder** and install dependencies:
   ```bash
   cd instagram-import
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
   node import-instagram.mjs /path/to/instagram-export --dry-run
   ```

5. **Import specific types only** (optional):
   ```bash
   node import-instagram.mjs /path/to/instagram-export --types messages
   node import-instagram.mjs /path/to/instagram-export --types comments,posts
   ```

6. **Run the full import:**
   ```bash
   node import-instagram.mjs /path/to/instagram-export
   ```

## Expected Outcome

After running the import:
- DM conversations become thoughts tagged with `source_type: instagram_import`
- Long conversations are capped at 200 messages per thought
- Comments and captions are batched (50 comments or 30 captions per thought)
- All content with `sensitivity_tier: personal`
- Running `search_thoughts { query: "that restaurant recommendation" }` finds relevant DMs

**Scale reference:** Tested with 502 Instagram items imported successfully.

## Troubleshooting

**Issue: "Could not find your_instagram_activity directory"**
The export structure varies by download method. Look inside your extracted archive for a folder named `your_instagram_activity`. If it's nested deeper, point the script at the parent folder.

**Issue: Garbled text (wrong characters)**
Meta exports encode text as latin1-interpreted UTF-8. The script fixes this automatically with `fixMetaEncoding()`. If text still looks wrong, the file may use a different encoding.

**Issue: No messages found**
DMs are in `your_instagram_activity/messages/inbox/`. Each conversation is in its own folder with `message_1.json`, `message_2.json`, etc. Check that this structure exists in your export.
