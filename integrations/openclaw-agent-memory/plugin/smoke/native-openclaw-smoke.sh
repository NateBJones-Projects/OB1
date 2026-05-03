#!/usr/bin/env bash
set -euo pipefail

OPENCLAW_BIN="${OPENCLAW_BIN:-openclaw}"
OPENCLAW_PROFILE="${OPENCLAW_PROFILE:-personal}"
OPENCLAW_AGENT="${OPENCLAW_AGENT:-jonathan}"
OPENCLAW_PLUGIN_ID="${OPENCLAW_PLUGIN_ID:-openbrain-agent-memory}"
OPENCLAW_SESSION_PREFIX="${OPENCLAW_SESSION_PREFIX:-ob1-openclaw-native-smoke}"
OPENCLAW_DISABLE_AFTER="${OPENCLAW_DISABLE_AFTER:-true}"
OPENCLAW_HOME_DIR="${OPENCLAW_HOME_DIR:-$HOME/.openclaw-${OPENCLAW_PROFILE}}"

RUN_ID="${OB1_OPENCLAW_SMOKE_RUN_ID:-$(date -u +%Y%m%d%H%M%S)}"
SESSION_ID="${OPENCLAW_SESSION_PREFIX}-${RUN_ID}"
PROMPT_FILE="$(mktemp)"
OUTPUT_FILE="$(mktemp)"
INSPECT_FILE="$(mktemp)"

cleanup() {
  rm -f "$PROMPT_FILE" "$OUTPUT_FILE" "$INSPECT_FILE"
  if [[ "$OPENCLAW_DISABLE_AFTER" == "true" ]]; then
    "$OPENCLAW_BIN" --profile "$OPENCLAW_PROFILE" plugins disable "$OPENCLAW_PLUGIN_ID" >/dev/null || true
  fi
}
trap cleanup EXIT

required_tools=(
  openbrain_recall
  openbrain_writeback
  openbrain_report_usage
  openbrain_inspect_memory
  openbrain_list_review_queue
  openbrain_review_memory
  openbrain_get_recall_trace
)

"$OPENCLAW_BIN" --profile "$OPENCLAW_PROFILE" plugins enable "$OPENCLAW_PLUGIN_ID" >/dev/null
"$OPENCLAW_BIN" --profile "$OPENCLAW_PROFILE" plugins inspect "$OPENCLAW_PLUGIN_ID" --runtime --json > "$INSPECT_FILE"

node - "$INSPECT_FILE" "$OPENCLAW_PLUGIN_ID" "${required_tools[@]}" <<'NODE'
const [inspectFile, ...required] = process.argv.slice(2);
const pluginId = required.shift();
const data = JSON.parse(require("fs").readFileSync(inspectFile, "utf8"));
const plugin = data.plugin || (data.plugins || []).find((item) => item.id === pluginId) || data;
const tools = new Set(plugin.toolNames || data.toolNames || (data.tools || []).map((tool) => tool.name || tool.id).filter(Boolean));
const missing = required.filter((tool) => !tools.has(tool));
if (missing.length) {
  console.error(JSON.stringify({ ok: false, phase: "inspect", missing_tools: missing }, null, 2));
  process.exit(1);
}
NODE

cat > "$PROMPT_FILE" <<PROMPT
Run the OB1 Agent Memory native OpenClaw plugin smoke test.

Hard rules:
- Use only openbrain_* tools.
- Do not use shell, file, exec, read, write, edit, or process tools.
- Final response must be compact JSON only.

Steps:
1. Call openbrain_list_review_queue once.
2. Call openbrain_writeback with:
{
  "schema_version": "openbrain.openclaw.writeback.v1",
  "task_id": "openclaw-native-harness-${RUN_ID}",
  "step_id": "writeback-1",
  "idempotency_key": "openclaw-native-harness-${RUN_ID}:writeback-1",
  "channel": {"kind": "cli", "id": "spark", "thread_id": "openclaw-native-harness"},
  "runtime": {"name": "openclaw", "version": "2026.5.2"},
  "models_used": [{"provider": "openai-codex", "model": "gpt-5.5", "role": "native_plugin_smoke"}],
  "source_refs": [{"kind": "runbook", "uri": "spark://personal/openclaw/OPENCLAW-HOWTO.md", "title": "Jonathan Spark OpenClaw How-To"}],
  "memory_payload": {
    "decisions": [],
    "outputs": ["OpenClaw native smoke harness ${RUN_ID} invoked OB1 Agent Memory plugin tools from the Jonathan Spark agent."],
    "lessons": ["The repeatable native smoke harness verifies OpenClaw tool exposure and direct openbrain_* tool calls."],
    "constraints": ["OB1 Agent Memory access keys must stay behind OpenClaw SecretRefs during native plugin smoke tests."],
    "unresolved_questions": [],
    "next_steps": ["Run this native harness before ClawHub publishing or OpenClaw plugin config changes."],
    "failures": [],
    "artifacts": [{"kind": "script", "uri": "repo://integrations/openclaw-agent-memory/plugin/smoke/native-openclaw-smoke.sh", "description": "Native OpenClaw plugin smoke harness"}],
    "entities": {"topics": ["OB1 Agent Memory", "OpenClaw", "native smoke harness", "SecretRef", "tools.allow"], "repos": ["OB1"], "people": ["Jonathan Edwards"]}
  },
  "provenance": {"default_status": "generated", "confidence": 0.84, "requires_review": true},
  "retention": {"stale_after_days": 30},
  "visibility": {"workspace": "private", "project": "project", "channel": "cli"}
}
3. Call openbrain_recall with:
{
  "schema_version": "openbrain.openclaw.recall.v1",
  "task_id": "openclaw-native-harness-${RUN_ID}",
  "task_type": "smoke",
  "channel": {"kind": "cli", "id": "spark", "thread_id": "openclaw-native-harness"},
  "runtime": {"name": "openclaw", "version": "2026.5.2"},
  "model_intent": {"provider": "openai-codex", "model": "gpt-5.5"},
  "query": "OpenClaw native smoke harness ${RUN_ID} OB1 Agent Memory tools.allow SecretRef",
  "entities": {"topics": ["OB1 Agent Memory", "OpenClaw", "native smoke harness"], "repos": ["OB1"]},
  "scope": {"visibility": "project", "project_only": true, "include_unconfirmed": true, "include_stale": false},
  "limits": {"max_items": 10, "max_tokens": 4000, "recency_days": 7},
  "sensitivity": {"contains_code": false, "contains_customer_data": false, "contains_private_meeting_data": false}
}
4. Call openbrain_report_usage for the first recalled memory.
5. Call openbrain_review_memory on the first memory returned from writeback with action evidence_only.
6. Call openbrain_inspect_memory for that reviewed memory.
7. Call openbrain_get_recall_trace for the recall request.

Final JSON keys:
writeback_memory_count, recall_memory_count, used_memory_id, reviewed_memory_id, review_status_after, trace_item_count, native_tools_only, blockers.
PROMPT

"$OPENCLAW_BIN" --profile "$OPENCLAW_PROFILE" agent \
  --agent "$OPENCLAW_AGENT" \
  --session-id "$SESSION_ID" \
  --message "$(cat "$PROMPT_FILE")" \
  --json > "$OUTPUT_FILE"

SESSION_FILE="${OPENCLAW_SESSION_FILE:-${OPENCLAW_HOME_DIR}/agents/${OPENCLAW_AGENT}/sessions/${SESSION_ID}.jsonl}"

node - "$SESSION_FILE" "$OUTPUT_FILE" "${required_tools[@]}" <<'NODE'
const fs = require("fs");
const [sessionFile, outputFile, ...required] = process.argv.slice(2);
const toolCalls = [];
const toolErrors = [];
const assistantTexts = [];

if (fs.existsSync(sessionFile)) {
  for (const line of fs.readFileSync(sessionFile, "utf8").split(/\n+/)) {
    if (!line.trim()) continue;
    const event = JSON.parse(line);
    const content = event.message?.content || [];
    for (const part of content) {
      if (part.type === "toolCall") toolCalls.push(part.name);
      if (part.type === "text") assistantTexts.push(part.text);
    }
    if (event.message?.role === "toolResult" && event.message?.isError) {
      toolErrors.push({ tool: event.message.toolName, content: event.message.content });
    }
  }
} else {
  const output = fs.readFileSync(outputFile, "utf8");
  for (const tool of required) {
    if (output.includes(`"${tool}"`) || output.includes(tool)) toolCalls.push(tool);
  }
}

const missing = required.filter((tool) => !toolCalls.includes(tool));
const nonOpenBrain = toolCalls.filter((tool) => !tool.startsWith("openbrain_"));
let finalJson = null;
for (const text of assistantTexts.reverse()) {
  const trimmed = text.trim();
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    try {
      finalJson = JSON.parse(trimmed);
      break;
    } catch {
      // Continue looking.
    }
  }
}

const ok = missing.length === 0 && nonOpenBrain.length === 0 && toolErrors.length === 0 && finalJson?.blockers?.length === 0;
const summary = {
  ok,
  session_file: fs.existsSync(sessionFile) ? sessionFile : null,
  tool_calls: toolCalls,
  missing_tools: missing,
  non_openbrain_tools: nonOpenBrain,
  tool_error_count: toolErrors.length,
  final: finalJson,
};

console.log(JSON.stringify(summary, null, 2));
if (!ok) process.exit(1);
NODE
