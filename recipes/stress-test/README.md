# Contrarian Stress Test

Validates DOK4 SPOVs by searching for contradicting evidence with auto-revise and insight generation.

## Purpose

This recipe validates Strategic Point of View (SPOV) entries in your knowledge base by actively seeking contradicting evidence. It ensures your highest-level insights are robust, well-tested, and continuously improved through:

1. **Contradiction Detection** - Searches the entire knowledge base for evidence that challenges each SPOV
2. **Validation Classification** - Classifies SPOVs as:
   - `validated` - No significant contradictions found
   - `challenged` - Moderate contradictions (auto-revised)
   - `broken` - Strong contradictions (needs human review)
3. **Auto-Revision** - Automatically revises challenged SPOVs to incorporate counterpoints
4. **Insight Generation** - Creates new DOK3 insights from patterns of contradictions

## How It Works

### Algorithm

1. Fetches DOK4 entries with `validation_status = 'pending'` (batch of 3)
2. For each SPOV:
   - Generates 2-3 contrarian search queries
   - Searches the entire knowledge base for contradicting evidence
   - Evaluates evidence strength (strong/moderate/weak contradictions)
   - Updates validation status and history
3. For challenged SPOVs:
   - Auto-generates revised version incorporating challenges
   - Marks original as `superseded`
   - Creates new version with `validation_status = 'revised'`
4. Generates DOK3 insights from contradiction patterns when 3+ SPOVs are challenged
5. Updates validation status in the `dok_levels` table

### GPT Prompts Used

- **Contrarian Query Generation**: 
  > "Given this contrarian position, generate 2-3 search queries that would find evidence contradicting it."

- **Contradiction Evaluation**:
  > "Does this evidence contradict or challenge the SPOV? Return JSON: {contradicted: bool, strength: 'strong'|'moderate'|'weak', reasoning: string, evidence_summary: string}"

- **SPOV Revision**:
  > "Revise the SPOV to incorporate the challenging evidence. Be balanced and acknowledge the counterpoints while maintaining the core insight."

- **Insight Generation**:
  > "Based on these challenged SPOVs, generate a new DOK3 insight that explains the underlying pattern or tension."

## Usage

### Automatic Execution

This recipe is typically scheduled to run periodically (e.g., weekly) via cron or scheduled workflow:

```bash
# Trigger the stress test
curl -X POST https://your-ref.supabase.co/functions/v1/stress-test/run \
  -H "apikey: YOUR_ANON_KEY" \
  -H "Content-Type: application/json" \
  -d '{"batch_size": 3}'
```

### Manual Testing

Check the function status and trigger manually:

```bash
# Check status
curl https://your-ref.supabase.co/functions/v1/stress-test/status

# Trigger test
curl https://your-ref.supabase.co/functions/v1/stress-test/trigger
```

## Validation Statuses

- `pending` - Newly created SPOV awaiting validation
- `validated` - No significant contradictions found
- `challenged` - Moderate contradictions found, auto-revised
- `broken` - Strong contradictions found, requires human review
- `revised` - Auto-revised version of a challenged SPOV
- `superseded` - Original SPOV replaced by revised version

## Metrics and Reports

The stress test generates a JSON report with:
- `processed` - Number of SPOVs processed
- `validated` - Number of validated SPOVs
- `challenged` - Number of challenged SPOVs
- `broken` - Number of broken SPOVs
- `revised` - Number of auto-revised SPOVs
- `new_insights` - Number of new DOK3 insights generated
- `details` - Additional details about generated insights

## Edge Function Details

- **Function**: `stress-test`
- **Runtime**: Cloudflare Workers/Deno
- **Memory**: Optimized for batch processing of 3 SPOVs
- **Timeout**: 30 seconds per batch
- **Dependencies**: OpenAI API, Supabase

## Integration

This recipe integrates with the DOK pipeline by:
1. Reading from `dok_levels` table (DOK4 entries)
2. Writing validation results back to `dok_levels`
3. Creating new DOK3 entries in `dok_levels` when insights are generated
4. Using vector search to find contradicting evidence across all DOK levels

## Requirements

- OpenAI API key with access to GPT-4o-mini
- Supabase project with DOK pipeline tables
- DOK4 SPOVs with `validation_status = 'pending'`