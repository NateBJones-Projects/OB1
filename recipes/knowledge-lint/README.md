# Knowledge Lint

Automated maintenance for your knowledge base that prunes stale, redundant, or low-value entries.

## Features

- **Identifies stale entries**: Finds documents with no access count older than 60 days
- **AI evaluation**: Uses GPT to determine if entries should be kept, archived, or merged
- **Duplicate detection**: Finds near-duplicates across same DOK level (similarity > 0.95)
- **Audit trail**: Stores maintenance reports in the knowledge base
- **Structured output**: Returns JSON for easy integration with n8n email workflows

## Usage

Deploy as a Supabase Edge Function and schedule via n8n or cron:

```bash
# Deploy the function
cd /home/ubuntu/open-brain-v2
npx supabase functions deploy knowledge-lint --no-verify-jwt
```

## Function Logic

### 1. Stale Document Detection
- Queries documents with `access_count = 0`
- Created more than 60 days ago
- Limited to 100 documents per run

### 2. AI Evaluation
For each document, GPT-4 mini decides:
- **keep**: Still relevant and valuable
- **archive**: Outdated or no longer relevant
- **merge**: Likely duplicate of newer content

### 3. Actions Taken
- **Archive**: Sets `metadata.archived = true` and `archived_at` timestamp
- **Keep**: No changes, remains in active knowledge base
- **Merge**: Flagged for manual review (requires human intervention)

### 4. Duplicate Detection
- Compares embeddings within same DOK level
- Uses 0.95 similarity threshold
- Reports pairs for manual review

## Output Format

Returns structured JSON suitable for n8n integration:

```json
{
  "success": true,
  "report": "Knowledge Lint Report — April 16, 2026\n\n...",
  "results": {
    "totalProcessed": 25,
    "archived": 8,
    "flaggedForMerge": 3,
    "kept": 14,
    "duplicates": 2
  }
}
```

## Integration with n8n

Create an n8n workflow that:
1. Triggers weekly (e.g., Sunday 03:00 UTC)
2. Calls the knowledge-lint function
3. Parses the JSON response
4. Sends email report with:
   - Summary statistics
   - List of archived documents
   - Duplicate pairs requiring review
   - Links to review in Supabase

## Requirements

- Supabase project with Open Brain schema
- OpenAI API key configured
- `access_stats` table populated with usage data

## Schedule

Recommended: Weekly on Sunday at 03:00 UTC (before weekly digest)