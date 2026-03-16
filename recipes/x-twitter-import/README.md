# X/Twitter Import

> Import your X (Twitter) data export — tweets, DMs, and Grok chats — into Open Brain.

## What It Does

Parses X (formerly Twitter) data exports and imports three types of content as searchable thoughts:
- **Tweets** — your original tweets (retweets filtered out), batched by date
- **DMs** — direct message conversations (minimum 3 messages)
- **Grok chats** — conversations with X's Grok AI assistant

## Prerequisites

- Working Open Brain setup ([guide](../../docs/01-getting-started.md))
- **X/Twitter data export** — request from X Settings → Your Account → Download an archive
- **Node.js 18+** installed
- **OpenRouter API key** for embedding generation

## Credential Tracker

```text
X/TWITTER IMPORT -- CREDENTIAL TRACKER
--------------------------------------

FROM YOUR OPEN BRAIN SETUP
  Supabase URL:          ____________
  Service Role Key:      ____________

FROM OPENROUTER
  API Key:               ____________

--------------------------------------
```

## Steps

1. **Request your X data export:**
   - Go to X Settings → Your Account → Download an archive of your data
   - Wait for the email notification (can take 24-48 hours)
   - Download and extract the archive
   - You should see a `data/` folder containing `tweets.js`, `direct-messages.js`, etc.

2. **Copy this recipe folder** and install dependencies:
   ```bash
   cd x-twitter-import
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
   node import-x-twitter.mjs /path/to/twitter-export --dry-run
   ```

5. **Import specific types only** (optional):
   ```bash
   node import-x-twitter.mjs /path/to/twitter-export --types tweets
   node import-x-twitter.mjs /path/to/twitter-export --types dms,grok
   ```

6. **Run the full import:**
   ```bash
   node import-x-twitter.mjs /path/to/twitter-export
   ```

## Expected Outcome

After running the import:
- Tweets are grouped into batches of 20, each becoming one thought
- DM conversations become individual thoughts
- Grok chats are grouped by chat ID
- All tagged with `source_type: x_twitter_import`
- Retweets are automatically excluded
- Short DM conversations (<3 messages) are filtered out

**Scale reference:** Tested with 1,000+ tweets and DMs imported successfully.

## Troubleshooting

**Issue: "file not found" for tweets.js**
X data exports use different filenames across versions. The script tries both `tweets.js` and `tweet.js`. Check your `data/` folder for the actual filename.

**Issue: Twitter JS file won't parse**
Twitter wraps JSON in a `window.YTD.tweets.part0 = [...]` prefix. The script strips this automatically. If parsing fails, the file may be corrupted — re-download from X.

**Issue: All tweets showing as "skipped"**
Tweets under 30 characters and retweets (starting with "RT @") are filtered out. If all your tweets are short, lower the threshold in the `processTweets()` function.
