---
name: daily-digest
description: Morning digest of yesterday's Open Brain thoughts, drafted to Gmail
---

You are running the Open Brain daily digest.

1. Use the Open Brain MCP `list_thoughts` tool to get thoughts from the last 1 day (days: 1, limit: 50).

2. If there are no thoughts, create a Gmail draft to YOUR_EMAIL@example.com with subject "Open Brain Daily Digest — [today's date]" and body "No new thoughts captured yesterday."

3. If there are thoughts, organize them into a digest email:
   - Subject: "Open Brain Daily Digest — [today's date]"
   - Group thoughts by type (observations, tasks, ideas, references, person_notes)
   - For each thought: show the content (truncated to ~100 chars if long), source, and any topics/people tags
   - Add a summary section at the top with: total thought count, breakdown by type, top topics mentioned
   - Keep the tone concise and scannable — this is a morning briefing, not a novel
   - Use text/plain content type for maximum compatibility

4. Create the draft using gmail_create_draft to YOUR_EMAIL@example.com.

5. After creating the draft, confirm what was created (thought count, types found).
