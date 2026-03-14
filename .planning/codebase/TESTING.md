# Testing Patterns

**Analysis Date:** 2026-03-13

## Test Framework

**Status:** No automated test framework detected

This codebase does not use Jest, Vitest, Pytest, or any testing framework. Testing is manual and documented in READMEs.

**Test Philosophy:**
- Community contributions require manual testing on a personal Open Brain instance before PR
- All features are tested against a live Supabase database during development
- See `CONTRIBUTING.md` line 5: "Every contribution you submit should be tested against your own instance first"

## Manual Testing Pattern

**MCP Tool Testing:**

Tools are tested via curl JSON-RPC calls to the running Supabase Edge Function. The pattern documented in `CLAUDE.md`:

```bash
curl -X POST "https://<project-ref>.supabase.co/functions/v1/<function-name>" \
  -H "Content-Type: application/json" \
  -H "x-access-key: $MCP_ACCESS_KEY" \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "tools/call",
    "params": {
      "name": "tool_name",
      "arguments": { "arg1": "value1", "arg2": "value2" }
    }
  }'
```

**Example test calls visible in extensions:**

From `extensions/*/README.md` Step 4 ("Test It"):
- Test commands are tool-specific
- Example patterns (not actual code, but documented in READMEs):
  - Call `add_household_item` with test data
  - Call `search_household_items` with the added item
  - Verify the response contains expected fields

## Script Testing Pattern

**Python Import Scripts:**

Scripts like `import-chatgpt.py` have built-in dry-run mode for safe testing:

```bash
# Test without ingesting
python import-chatgpt.py export.zip --dry-run --limit 10

# Show what would be extracted and summarized
python import-chatgpt.py export.zip --dry-run --verbose
```

**Dry-Run Behavior:**
- `--dry-run` flag skips all database writes
- Prints what would be extracted, filtered, summarized, and ingested
- Useful for validating logic without side effects
- Example from `import-chatgpt.py` lines 709-711:
  ```python
  if args.dry_run:
      print()  # Summary only
      continue  # Skip ingestion
  ```

**TypeScript Script Testing:**

From `recipes/source-filtering/backfill-metadata.ts`:
- Includes `--dry-run` flag to preview changes without writing
- Usage: `deno run --allow-net --allow-env backfill-metadata.ts --dry-run`
- Dry-run output shows: `[DRY] {id}: type=observation, topics=...`
- Dry-run verification: prints what would be updated, count of records
- Live mode writes and confirms: `✓ {id}: type=observation, topics=...`

## Test Organization

**Test Data:**

No fixtures or factories directory exists. Data patterns observed:

- **Live Instance Testing**: All testing against real Supabase instance
- **Seed Data**: Extensions include example metadata in schema.sql
- **Sync Log Pattern**: `import-chatgpt.py` uses `chatgpt-sync-log.json` to track imported conversations
  - Prevents duplicate imports
  - Acts as a test artifact (can be deleted to re-test)

**Environment Handling:**

- All tests require real environment variables (SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, OPENROUTER_API_KEY)
- No test-specific .env files or mocking of external services
- Tests must be run against an actual Supabase instance with proper schema

## Testing Responsibility

**Contributor Testing:**

From `CONTRIBUTING.md` lines 4-5:
> "If you haven't built one yet, start with the [Open Brain guide](docs/01-getting-started.md). Every contribution you submit should be tested against your own instance first — don't submit something you haven't run yourself."

**Manual Testing Checklist (from READMEs):**

Each extension documents manual tests. Example from extension template (`extensions/_template/README.md` Step 4):
- Test It
  - "Verification steps and example prompts go here"
  - Each extension fills this in with specific tool calls to verify

**Before-PR Testing:**

From `CONTRIBUTING.md` lines 143-147:
> "**Description must include:**
> - What the contribution does
> - What it requires (services, tools)
> - Confirmation that you tested it on your own Open Brain instance"

Testing confirmation is part of PR description requirements.

## Test Coverage

**Requirements:** None enforced

- No code coverage metrics or targets
- All testing is functional/integration testing against live instances
- No unit tests (testing library code in isolation)

**What Gets Tested:**

- **MCP Tools**: Manual curl tests against running Edge Function
  - Tool invocation: parameters accepted
  - Response format: JSON structure correct
  - Database effects: data persisted
  - Error cases: documented in Troubleshooting sections

- **Import Scripts**: End-to-end testing
  - Dry-run: parsing and extraction logic verified
  - Live run: ingestion succeeds, data appears in thoughts table
  - Idempotency: sync log prevents re-import

**What's NOT Tested:**

- Individual functions or helpers (no unit tests)
- Error paths other than documented troubleshooting (no error injection tests)
- Performance (no load tests or benchmarks)
- Integration with other extensions (documented conceptually but not tested)

## Common Testing Patterns Observed

**Error Response Pattern:**

MCP tools standardize error responses. From `extensions/household-knowledge/index.ts` lines 74-79:

```typescript
} catch (error) {
  const errorMessage = error instanceof Error ? error.message : String(error);
  return {
    content: [{ type: "text", text: JSON.stringify({ success: false, error: errorMessage }) }],
    isError: true,
  };
}
```

All MCP tools follow this pattern for error handling.

**Supabase Query Pattern:**

Standard pattern for all database operations (lines 47-62):

```typescript
const { data, error } = await supabase
  .from("table_name")
  .insert({...})
  .select()
  .single();

if (error) {
  throw new Error(`Failed to add item: ${error.message}`);
}

return {
  content: [{
    type: "text",
    text: JSON.stringify({ success: true, message: `Added: ${name}`, item: data }, null, 2)
  }]
};
```

This pattern is consistent across all extensions. Testing this involves:
1. Verify insert succeeds (no error)
2. Verify returned data has expected fields
3. Verify data persisted (search/query after insert)

**Python Validation Pattern:**

From `import-chatgpt.py`, argument validation happens early (lines 539-562):

```python
def parse_args():
    parser = argparse.ArgumentParser(description="...", epilog="...")
    parser.add_argument("zip_path", help="...")
    parser.add_argument("--dry-run", action="store_true", help="...")
    parser.add_argument("--limit", type=int, default=0, help="...")
    return parser.parse_args()
```

Testing involves:
- Running with `--help` to verify options exist
- Running with invalid arguments to verify rejection
- Running with `--dry-run` to verify logic without side effects
- Running full process to verify end-to-end ingestion

## Troubleshooting Documentation

Each extension includes `Troubleshooting` section in README documenting:

- Common errors and how to fix them
- Example error message + resolution
- Validation steps to verify fix

Example from `extensions/_template/README.md` lines 102-103:
> **"relation 'table_name' does not exist"**
> - The `schema.sql` wasn't run successfully — re-run it in the Supabase SQL Editor

This pattern encourages manual verification of:
- Schema deployment
- Environment variables set correctly
- Network connectivity to Supabase

## Continuous Testing Notes

**No CI/CD testing pipeline** exists in this repo. Testing relies on:
1. Developer manual testing on own instance before PR
2. Human code review (PR review before merge)
3. No automated test suite runs on PR

**Potential Testing Improvements:**

While not currently implemented, future work could include:
- Deno test runners for TypeScript extensions (using `deno test`)
- Pytest for Python scripts
- CI/CD workflow to run tests on PR
- Test data fixtures/seed SQL

---

*Testing analysis: 2026-03-13*
