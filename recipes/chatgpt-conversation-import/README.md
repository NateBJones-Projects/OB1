# ChatGPT Conversation Import

> Parse your ChatGPT data export and ingest conversations into Open Brain as searchable thoughts.

## What It Does

Takes the JSON file from ChatGPT's "Export your data" feature and converts each conversation into one or more thoughts in Open Brain. Conversations are embedded and stored with metadata including conversation title, date range, message count, and model used — so you can semantically search everything you've ever discussed with ChatGPT.

## Prerequisites

- Working Open Brain setup ([guide](../../docs/getting-started.md))
- Your ChatGPT data export (Settings → Data Controls → Export Data in ChatGPT)
- Node.js 18+
- Your Supabase project URL and service role key
- OpenRouter API key (for generating embeddings)

## Steps

<!-- TODO: Matt Hallett to fill in step-by-step instructions -->

1. Export your data from ChatGPT (Settings → Data Controls → Export Data)
2. Download and unzip the export — you need the `conversations.json` file
3. Clone this folder and install dependencies
4. Configure your environment variables
5. Run the import script, pointing it at your `conversations.json`
6. Verify thoughts were created in your Supabase database

## Expected Outcome

After running the import, each ChatGPT conversation appears as one or more thoughts in your `thoughts` table. The `content` field contains the conversation text, and the `metadata` jsonb field includes:
- `source`: `"chatgpt"`
- `title`: conversation title from ChatGPT
- `date_range`: first and last message timestamps
- `message_count`: number of messages in the conversation
- `model`: which GPT model was used

Searching for topics you discussed with ChatGPT now returns results through your Open Brain MCP server.

## Troubleshooting

**Issue: `conversations.json` not found in the export**
Solution: ChatGPT exports come as a zip file. Make sure you've unzipped it. The `conversations.json` file should be in the root of the extracted folder.

**Issue: Import is very slow**
Solution: Large exports (1000+ conversations) take time because each conversation needs an embedding generated. The script processes in batches. Let it run — progress is printed to the console.

**Issue: Some conversations are missing after import**
Solution: Very short conversations (fewer than 3 messages) are skipped by default to avoid noise. Use the `--include-short` flag to import everything.
