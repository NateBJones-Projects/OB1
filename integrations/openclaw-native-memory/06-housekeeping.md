# Memory Housekeeping (Current-State Cleanup)

Purpose:
- keep memory docs aligned with the current OpenBrain setup
- remove stale references to superseded flows
- preserve historical notes while making the current path obvious

## Current-state policy

- In-agent primary path: native plugin tools
  - `search_thoughts`
  - `capture_thought`
  - `list_thoughts`
- Shell scripts are fallback for cron/non-plugin contexts.

## What housekeeping should do

1. **Age-gate daily notes**
   - curate `memory/YYYY-MM-DD.md` files older than 2 days
   - promote only durable facts/tasks/decisions

2. **Dedupe before promotion**
   - run semantic checks with `search_thoughts`
   - skip near-duplicates

3. **Capture with enrichment**
   - include lightweight fields in capture envelope/content:
     - `context`, `type`, `topics`, `people`, `action_items`, `dates_mentioned`

4. **Fallback and alerting**
   - if plugin capture fails, use enriched fallback helper
   - write alert entries to `reports/openbrain-fallback-alerts.log`

5. **State cleanup**
   - normalize obvious stale wording in active docs (for example references implying wrappers/mcporter are still primary)
   - do not rewrite historical daily logs; preserve history for auditability

## Suggested schedule

- Stage-2 curation: daily at off-peak (for example 03:30 local time)
- Fallback alert review: daily (for example 07:00 local time)
- Heavy cleanup review: weekly

## Reporting

Each run should write:
- source files reviewed
- promoted/skipped counts
- dedupe hits
- fallback events
- wording/cleanup changes applied
