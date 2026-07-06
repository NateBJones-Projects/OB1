# Changelog

## 0.1.0 — 2026-05-09

Initial release of the Hermes OB1 memory provider.

### Added

- Native Hermes `MemoryProvider` implementation against the OB1 v1 contract.
- Auto-recall before each turn via `prefetch()`.
- Background recall caching via `queue_prefetch()` / consumed by next `prefetch()` (90s TTL).
- Auto-writeback after each turn via `sync_turn()` — payload structured as OB1 `outputs[]`.
- Synchronous structured-finding writeback at session end via `on_session_end()`.
- Background writeback + summary string injection at compression via `on_pre_compress()`.
- Heuristic finding extractor that maps conversation lines into OB1 categories: decisions, lessons, constraints, next_steps, unresolved_questions, failures.
- Seven explicit tools: `ob1_recall`, `ob1_writeback`, `ob1_search`, `ob1_report_usage`, `ob1_list_review_queue`, `ob1_review_memory`, `ob1_get_recall_trace`.
- Setup-wizard support via `get_config_schema` / `save_config`.
- `x-brain-key` header authentication (matches OB1 v1 contract — not Bearer).
- Per-turn model + provider tracking, with fallback to Hermes `config.yaml` when `on_turn_start` kwargs are absent.
- Subagent / cron / flush context guard — disables writes for non-primary contexts to prevent corrupting the parent's memory record.
- 75 pytest tests covering pure helpers, schema shapes, lifecycle, prefetch caching, sync_turn, session-end, pre-compress, and tool routing.
