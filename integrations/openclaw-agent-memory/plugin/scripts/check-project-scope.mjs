import fs from "node:fs";

const typeStub = new Proxy({}, { get: () => (...args) => ({ args }) });
let code = fs.readFileSync(new URL("../dist/index.js", import.meta.url), "utf8");

code = code
  .replace('import { Type as Type2 } from "typebox";\n', "const Type2 = typeStub;\n")
  .replace('import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";\n', "const definePluginEntry = (entry) => entry;\n")
  .replace(
    'import { resolveConfiguredSecretInputString } from "openclaw/plugin-sdk/secret-input-runtime";\n',
    'const resolveConfiguredSecretInputString = async ({ value }) => ({ value: typeof value === "string" ? value : "test-key" });\n',
  )
  .replace('import { Type } from "typebox";\n', "const Type = typeStub;\n")
  .replace(/export \{\s*index_default as default\s*\};\s*$/s, "return index_default;");

const plugin = new Function("typeStub", code)(typeStub);
const registered = new Map();
const api = {
  pluginConfig: {
    endpoint: "https://example.invalid/agent-memory-api",
    accessKey: "test-key",
    workspaceId: "ratiocore",
    projectId: "ratiocore-ops",
    requireReviewByDefault: true,
    includeUnconfirmedRecall: false,
  },
  config: {},
  registerTool(tool) {
    registered.set(tool.name, tool);
  },
};

plugin.register(api);

const calls = [];
globalThis.fetch = async (url, options = {}) => {
  calls.push({
    url: String(url),
    body: options.body ? JSON.parse(options.body) : null,
  });
  return {
    ok: true,
    status: 200,
    async text() {
      return JSON.stringify({ ok: true });
    },
  };
};

function fail(message, details = {}) {
  console.error(JSON.stringify({ ok: false, error: message, ...details }, null, 2));
  process.exit(1);
}

function assertEqual(name, actual, expected) {
  if (actual !== expected) fail(`${name} mismatch`, { actual, expected });
}

await registered.get("openbrain_recall").execute("test", {
  query: "clubhouse constraints",
  project_id: "clubhouse",
  scope: { project_only: true },
});
await registered.get("openbrain_recall").execute("test", {
  query: "default project fallback",
});
await registered.get("openbrain_recall").execute("test", {
  query: "workspace-wide explicit null",
  project_id: null,
});
await registered.get("openbrain_writeback").execute("test", {
  project_id: "teacher-loloy",
  memory_payload: { decisions: ["test decision"] },
});
await registered.get("openbrain_list_review_queue").execute("test", {
  project_id: "paperclip",
});

const summary = {
  registered_tool_count: registered.size,
  recall_override: calls[0]?.body?.project_id,
  recall_default: calls[1]?.body?.project_id,
  recall_explicit_null: calls[2]?.body?.project_id,
  writeback_override: calls[3]?.body?.project_id,
  review_queue_url: calls[4]?.url,
};

assertEqual("registered_tool_count", summary.registered_tool_count, 7);
assertEqual("recall_override", summary.recall_override, "clubhouse");
assertEqual("recall_default", summary.recall_default, "ratiocore-ops");
assertEqual("recall_explicit_null", summary.recall_explicit_null, null);
assertEqual("writeback_override", summary.writeback_override, "teacher-loloy");
if (!summary.review_queue_url?.includes("project_id=paperclip")) {
  fail("review_queue_url missing project_id override", summary);
}

console.log(JSON.stringify({ ok: true, ...summary }, null, 2));
