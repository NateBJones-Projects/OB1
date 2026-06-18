# Hermes Agent Memory (OB1)

![Community Contribution](https://img.shields.io/badge/OB1_COMMUNITY-Approved_Contribution-2ea44f?style=for-the-badge&logo=github)

**Created by [@MicScalise](https://github.com/MicScalise)**

> Native Hermes `MemoryProvider` for the OB1 governed memory system. Gives Hermes agents the same auto-recall, auto-writeback, and governance that OpenClaw agents get from `integrations/openclaw-agent-memory`.

## What It Does

Plugs Hermes Agent into the OB1 v1 Agent Memory API so every Hermes turn does three things automatically:

1. **Recall** — Before the LLM call, recent and relevant memories are pulled from OB1 (filtered by `use_policy` — `[instruction]` items are treated as binding rules, `[evidence]` as supporting context only).
2. **Writeback** — After the turn, a structured summary lands in `agent_memories` tagged with `runtime=hermes`, the actual model + provider that ran the turn, and the `task_id` linkage.
3. **Govern** — Memories default to `pending_review` with `requires_user_confirmation=true` so nothing is promoted to instruction-grade until a human (or the `ob1_review_memory` tool) confirms it.

The same backend serves both runtimes — OpenClaw agents and Hermes agents share **one** governed memory.

## Prerequisites

- Working Open Brain setup ([guide](../../docs/01-getting-started.md))
- [`schemas/agent-memory`](../../schemas/agent-memory/) applied
- [`integrations/agent-memory-api`](../agent-memory-api/) deployed
- Hermes Agent 0.13.0+ installed
- Python 3.11+

## Credential Tracker

```text
HERMES AGENT MEMORY -- CREDENTIAL TRACKER
-----------------------------------------

FROM OB1
  Agent Memory API URL:   ____________
  MCP Access Key:         ____________

HERMES
  Plugin path (~/.hermes/plugins/ob1):  ____________
  Default workspace ID:                 ____________
  Default project ID (optional):        ____________

-----------------------------------------
```

## Steps

![Step 1](https://img.shields.io/badge/Step_1-Prepare_OB1_Agent_Memory-1E88E5?style=for-the-badge)

Apply the schema and deploy the API.

> [!IMPORTANT]
> The Agent Memory API must be reachable on the URL you'll configure below. The provider does an HTTP `GET /health` probe on initialization and warns (non-fatally) if it fails.

**Done when:** `GET /health` on the Agent Memory API returns `ok: true`.

![Step 2](https://img.shields.io/badge/Step_2-Install_the_Plugin-1E88E5?style=for-the-badge)

Hermes plugins live under `$HERMES_HOME/plugins/<name>/`. The default `$HERMES_HOME` is `~/.hermes`.

```bash
mkdir -p ~/.hermes/plugins/ob1
cp plugin/__init__.py     ~/.hermes/plugins/ob1/__init__.py
cp plugin/plugin.yaml     ~/.hermes/plugins/ob1/plugin.yaml
```

> [!NOTE]
> The plugin uses Python's stdlib only — no `pip install` required. PyYAML ships with Hermes.

**Done when:** `ls ~/.hermes/plugins/ob1/` shows both files.

![Step 3](https://img.shields.io/badge/Step_3-Configure_Hermes-1E88E5?style=for-the-badge)

The plugin reads non-secret config from `~/.hermes/ob1.json` and the access key from the `OPENBRAIN_KEY` environment variable.

**1. Write the config file:**

```bash
cat > ~/.hermes/ob1.json <<'EOF'
{
  "endpoint": "http://localhost:8000/functions/v1/agent-memory-api",
  "workspace_id": "default",
  "project_id": null,
  "auto_recall": true,
  "auto_capture": true,
  "max_recall_results": 10,
  "default_confidence": 0.7,
  "require_review_by_default": true
}
EOF
```

**2. Set the access key in `~/.hermes/.env`:**

```bash
echo 'OPENBRAIN_KEY=<your-mcp-access-key>' >> ~/.hermes/.env
echo 'OPENBRAIN_URL=http://localhost:8000/functions/v1/agent-memory-api' >> ~/.hermes/.env
```

**3. Tell Hermes to use the provider:**

```bash
hermes config set memory.provider ob1
```

> [!TIP]
> Environment variables override `ob1.json` — useful for switching workspaces per shell (`OPENBRAIN_WORKSPACE_ID=staging hermes ...`).

**Done when:** `hermes -z "Tell me what memory provider is active."` mentions OpenBrain in its response.

![Step 4](https://img.shields.io/badge/Step_4-Verify_End_to_End-1E88E5?style=for-the-badge)

Drive a real turn and confirm the writeback lands:

```bash
hermes -z "Decision: we will use Postgres for the queue. Lesson: always run migrations off-hours."
```

Then query the database:

```sql
SELECT runtime_name, model, provider, task_id,
       substring(content, 1, 80) AS content
FROM agent_memories
WHERE runtime_name = 'hermes'
ORDER BY created_at DESC
LIMIT 5;
```

**Done when:** You see rows with `runtime_name=hermes`, the model your Hermes is configured to use (e.g. `anthropic/claude-opus-4.6`), and content matching your test turn.

## Expected Outcome

Once installed and configured:

- **Every Hermes turn auto-recalls.** When the LLM is reasoning, recent and similar OB1 memories are silently injected as `<ob1-context>` in the system prompt.
- **Every meaningful turn auto-writes.** The user's question + a summary of the assistant's response lands in `agent_memories` as a turn-summary `output`. Trivial messages (`ok`, `thanks`) and short replies are skipped.
- **Session end produces structured findings.** When Hermes exits, conversation lines matching decision / lesson / constraint / next_step / question / failure patterns are extracted into OB1's structured payload categories.
- **Compression preserves findings.** When Hermes hits a context-compression boundary, structured findings from the about-to-be-compressed messages are extracted, written back to OB1, and folded into the compression summary.
- **Seven tools are available** to the agent for explicit memory ops:
  - `ob1_recall` — task-scoped recall
  - `ob1_writeback` — structured store
  - `ob1_search` — alias for recall
  - `ob1_report_usage` — close the loop on which recalled memories were useful
  - `ob1_list_review_queue` — what's pending review
  - `ob1_review_memory` — confirm / reject / annotate
  - `ob1_get_recall_trace` — debug what came back

## Troubleshooting

### `hermes -z` returns instantly but nothing writes to `agent_memories`

The provider silently no-ops when `OPENBRAIN_KEY` is not set or the endpoint is empty. Verify both:

```bash
hermes config get memory.provider     # must be: ob1
cat ~/.hermes/ob1.json | grep endpoint  # must be your real Agent Memory API URL
grep OPENBRAIN_KEY ~/.hermes/.env       # must be present
```

### Writebacks land but `model` and `provider` columns are blank

Hermes' `run_agent.py` doesn't pass `model` to `on_turn_start`, so the provider falls back to reading `~/.hermes/config.yaml`. Confirm the config has a real model:

```bash
grep -A2 '^model:' ~/.hermes/config.yaml
```

If the value is `auto` for the provider field, the plugin derives the provider from the model prefix (`anthropic/...` → `anthropic`, `openrouter/...` → `openrouter`). For provider-less model names, the column will read `unknown` — set an explicit `model.provider` in `config.yaml` if you need accuracy.

### Recall returns 0 memories even when matches obviously exist

The OB1 Agent Memory API uses `match_thoughts(threshold=0.7)` against `text-embedding-3-small`, which is strict. Related items often score 0.4–0.6. If your fleet uses queries that are conceptually similar but not lexically close, lower the threshold in `match_thoughts` or override it in your fork of `agent-memory-api/index.ts`.

### `HTTP 400 Invalid input` errors in Hermes logs

Almost always means the OB1 Edge Function rejected a payload shape. The provider sends the v1 schema_version literals (`openbrain.agent_memory.recall.v1` / `openbrain.agent_memory.writeback.v1`) and a strict `runtime: {name, version}` shape — extra keys in `runtime` get rejected. If you're modifying the provider, run the test suite (`pytest plugin/tests/`) before installing.

### Subagent runs are corrupting the parent agent's task_id

The provider auto-disables writes when invoked with `agent_context in ("subagent", "cron", "flush")`. Hermes sets `agent_context` automatically for these cases — if you're driving the provider from a custom runner, set it yourself when calling `initialize()`.

## Repository Layout

```
integrations/hermes-agent-memory/
├── README.md            # this file
├── metadata.json        # OB1 contribution metadata
├── CHANGELOG.md         # release notes
└── plugin/
    ├── __init__.py      # OB1MemoryProvider implementation
    ├── plugin.yaml      # Hermes plugin metadata
    └── tests/
        ├── __init__.py
        └── test_ob1_provider.py
```

## Tests

```bash
cd plugin
pytest tests/
```

75 tests cover pure helpers, schema shapes on the wire, lifecycle, prefetch + cache TTL, sync_turn, session-end, pre-compress, and the seven tool handlers. Network is mocked at `urllib.request.urlopen` — tests run offline.
