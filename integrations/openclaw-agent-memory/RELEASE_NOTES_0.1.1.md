# NBJ OB1 Agent Memory for OpenClaw 0.1.1

Package installability fix for the ClawHub plugin package.

## Changed

- Publishes `@natebjones/ob1-agent-memory` with the `latest` tag so `openclaw plugins install clawhub:@natebjones/ob1-agent-memory` can resolve an installable package version.
- Keeps the plugin package under Nate / OB1 ownership and preserves the typed `openbrain_*` tool contract.
- No contract changes from 0.1.0: this release fixes distribution metadata, not memory behavior.

## Verification Target

After publish, a clean OpenClaw profile should install the plugin from ClawHub and list all seven OB1 Agent Memory tools:

- `openbrain_recall`
- `openbrain_writeback`
- `openbrain_report_usage`
- `openbrain_inspect_memory`
- `openbrain_list_review_queue`
- `openbrain_review_memory`
- `openbrain_get_recall_trace`
