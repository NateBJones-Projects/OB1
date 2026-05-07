---
name: daily-digest
description: Enhanced weekly digest with DOK-aware grouping, SPOV status tags, and items needing review
---

You are running the enhanced Open Brain weekly digest.

1. Use the Open Brain MCP `recall` tool to get thoughts from the last 7 days:
   - Query: "weekly digest"
   - Days: 7
   - Include all DOK levels (true for dok1, dok2, dok3, dok4)
   - Limit per level: 10

2. If there are no results, create a Gmail draft to YOUR_EMAIL@example.com with subject "Open Brain Weekly Digest — [today's date]" and body "No new insights captured in the last 7 days."

3. If there are results, organize them into an enhanced digest email:
   - Subject: "Open Brain Weekly Digest — [today's date]"
   - Include header with summary statistics (total entries, breakdown by DOK level, top topics)
   
   Format the content as follows:
   
   ```
   === Weekly Brain Digest — [date range] ===
   
   Summary:
   - [X] new insights captured
   - DOK2: [Y] clusters, DOK3: [Z] insights, DOK4: [W] SPOVs
   - Top topics: [list top 3-5 topics]
   
   === DOK2 — Clusters ([count]) ===
   - **[Title]** [Project/Tag]: [Content preview]...
   
   === DOK3 — Insights ([count]) ===
   - **[Title]** [Project/Tag]: [Content preview]...
   
   === DOK4 — SPOVs ([count]) ===
   - **[Title]** [STATUS]: [Content preview]...
     [TRUTH], [MYTH], [OK], or [NEEDS REVIEW]
   
   === Items Needing Your Review ===
   ❗ **[Title]** [BROKEN/CHALLENGED]: [Reason for review needed]...
   ```

4. For each entry, include:
   - Title (if available) or first 20 characters of content
   - DOK level indicator
   - SPOV status tags for DOK4 entries
   - Content preview (truncated to ~150 characters)
   - Project or topic tags if available
   - Source attribution if available

5. Highlight any entries that need human review:
   - DOK4 entries with BROKEN validation status
   - DOK4 entries with NEEDS REVIEW status
   - Recent contradictions or challenges

6. Create the draft using gmail_create_draft to YOUR_EMAIL@example.com.

7. After creating the draft, confirm what was created (total entries, DOK breakdown, items needing review).
