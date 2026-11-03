// Real OpenCode host + local fake OB1/model endpoints. No external writes or model calls.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { randomBytes } from "node:crypto";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const directory = await mkdtemp(join(tmpdir(), "ob1-opencode-native-"));
const calls = [], observed = [];
let saved;
const server = createServer(async (req, res) => {
  try {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    const body = raw ? JSON.parse(raw) : {};
    if (req.url === "/api/tags") {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ models: [{ name: "ob1-smoke-check", model: "ob1-smoke-check", size: 1000,
        details: { family: "llama", parameter_size: "1B", quantization_level: "Q4_K_M" } }] })); return;
    }
    if (req.url === "/api/show") {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ capabilities: ["completion"], model_info: { "general.architecture": "llama", "llama.context_length": 16000 } })); return;
    }
    if (req.url === "/ob1/recall") {
      assert.equal(req.headers["x-brain-key"], "local-smoke-only");
      calls.push({ kind: "recall", body });
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ request_id: "native-smoke-trace", memories: [{
        memory_id: "native-smoke-memory", content: "OB1_NATIVE_CONTEXT_MARKER", summary: "Smoke evidence",
        scope: { workspace_id: "smoke", project_id: "opencode-native-smoke" },
        use_policy: { can_use_as_instruction: false, can_use_as_evidence: true, requires_user_confirmation: false },
      }] })); return;
    }
    if (req.url === "/ob1/writeback") {
      calls.push({ kind: "writeback", body });
      saved = { id: "native-checkpoint", workspace_id: "smoke", project_id: "opencode-native-smoke",
        task_id: body.task_id, runtime_name: "opencode", provenance_status: "generated", review_status: "pending",
        lifecycle_status: "active", requires_user_confirmation: true, can_use_as_instruction: false,
        content: "Use unsigned timers for the smoke fixture." };
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ memories: [{ memory_id: "native-checkpoint" }] })); return;
    }
    if (req.url === "/ob1/memories/native-checkpoint") {
      res.setHeader("content-type", "application/json"); res.end(JSON.stringify({ memory: saved })); return;
    }
    if (req.url === "/ob1/memories/native-checkpoint/review") {
      assert.equal(body.action, "evidence_only");
      calls.push({ kind: "review", body });
      saved = { ...saved, review_status: "evidence_only", requires_user_confirmation: false };
      res.setHeader("content-type", "application/json"); res.end(JSON.stringify({ memory: saved })); return;
    }
    if (req.url?.endsWith("/chat/completions")) {
      const input = JSON.stringify(body.messages);
      observed.push(input);
      const text = input.includes("Review generated OB1 memory candidates")
        ? JSON.stringify({ reviews: [{ memory_id: "native-checkpoint", decision: "approve_evidence",
          source_quote: "For this synthetic memory integration test, use unsigned timers.", reason: "Explicit routine test decision." }] })
        : input.includes("Extract only durable project")
        ? '{"decisions":["Use unsigned timers for the smoke fixture."]}' : "OB1_SMOKE_OK";
      res.setHeader("content-type", body.stream ? "text/event-stream" : "application/json");
      if (body.stream) {
        for (const chunk of [
          { choices: [{ index: 0, delta: { role: "assistant", content: text }, finish_reason: null }] },
          { choices: [{ index: 0, delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 100, completion_tokens: 10, total_tokens: 110 } },
        ]) res.write(`data: ${JSON.stringify({ id: "smoke", object: "chat.completion.chunk", model: "check", ...chunk })}\n\n`);
        res.end("data: [DONE]\n\n");
      } else res.end(JSON.stringify({ id: "smoke", object: "chat.completion", model: "check",
        choices: [{ index: 0, message: { role: "assistant", content: text }, finish_reason: "stop" }],
        usage: { prompt_tokens: 100, completion_tokens: 10, total_tokens: 110 } }));
      return;
    }
    res.setHeader("content-type", "application/json"); res.end(JSON.stringify({ data: [] }));
  } catch (e) { res.statusCode = 500; res.end("Smoke fixture error"); console.error(e.message); }
});
await new Promise(r => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}`;
let host;
let cleanupSession;
try {
  await mkdir(join(directory, "config"));
  await writeFile(join(directory, "opencode.json"), JSON.stringify({
    model: "ollama/ob1-smoke-check",
    policies: [
      { action: "provider.use", resource: "*", effect: "deny" },
      { action: "provider.use", resource: "ollama", effect: "allow" },
      { action: "mcp.use", resource: "*", effect: "deny" },
    ],
    agents: { compaction: { model: "ollama/ob1-smoke-check" } },
    providers: { "ollama": { package: "@opencode/ai/providers/openai-compatible",
      settings: { baseURL: base + "/v1", apiKey: "local-smoke-only" },
      models: { "ob1-smoke-check": { modelID: "ob1-smoke-check", capabilities: { tools: false, input: ["text"], output: ["text"] },
        limit: { context: 16000, output: 1000 } } } } },
    plugins: [{ package: root, options: { endpoint: base + "/ob1", workspaceId: "smoke",
      projectId: "opencode-native-smoke", keyEnv: "OB1_NATIVE_SMOKE_KEY", autoCapture: true,
      autoReview: true, reviewModel: { providerID: "ollama", id: "ob1-smoke-check" } } }],
    mcp: { servers: { openbrain: { type: "local", command: ["unused"], disabled: true } } },
  }, null, 2));
  const password = randomBytes(24).toString("hex");
  const childEnv = { ...process.env, PWD: directory, INIT_CWD: directory, OB1_NATIVE_SMOKE_KEY: "local-smoke-only",
    XDG_CONFIG_HOME: join(directory, "config"), OPENCODE_CONFIG_DIR: join(directory, "config"),
    OPENCODE_PASSWORD: password, OPENCODE_SERVER_PASSWORD: password };
  host = spawn(process.env.OPENCODE_BIN || "opencode", ["serve", "--stdio", "--port", "0"], {
    cwd: directory, env: childEnv, stdio: ["pipe", "pipe", "pipe"],
  });
  const diagnostics = [];
  host.stderr.on("data", data => {
    diagnostics.push(...data.toString().split("\n").filter(line => line.includes("[ob1.agent-memory]")));
  });
  const serverUrl = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("OpenCode startup timed out")), 15000);
    let buffer = "";
    host.on("error", reject);
    host.stdout.on("data", data => {
      buffer += data;
      const newline = buffer.indexOf("\n");
      if (newline < 0) return;
      try { const { url } = JSON.parse(buffer.slice(0, newline)); clearTimeout(timer); resolve(url); }
      catch { clearTimeout(timer); reject(new Error("Invalid OpenCode startup response")); }
    });
  });
  // Refuse to run prompts if any unrelated non-builtin plugin was inherited.
  for (let i = 0; i < 20; i++) {
    const { stdout } = await promisify(execFile)(process.env.OPENCODE_BIN || "opencode",
      ["api", "get", "/api/plugin", "--server", serverUrl], { cwd: directory, env: childEnv });
    const plugins = JSON.parse(stdout).data.filter(p => p.source.type !== "builtin");
    assert.ok(plugins.every(p => p.source.path === root), "Unexpected inherited plugin in smoke test");
    if (plugins.some(p => p.id === "ob1.agent-memory" && p.state.status === "active")) break;
    if (i === 19) throw new Error("Smoke plugin failed to activate");
    await new Promise(r => setTimeout(r, 50));
  }
  const child = spawn(process.env.OPENCODE_BIN || "opencode", ["run", "--server", serverUrl, "--auto", "--format", "json",
    "--model", "ollama/ob1-smoke-check", "For this synthetic memory integration test, use unsigned timers. Reply briefly."], {
    cwd: directory, env: childEnv, stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout.on("data", b => output += b); child.stderr.on("data", b => output += b);
  const timeout = setTimeout(() => child.kill("SIGTERM"), 90000);
  const code = await new Promise((resolve, reject) => { child.on("exit", resolve); child.on("error", reject); });
  clearTimeout(timeout);
  const sessionID = output.split("\n").flatMap(line => {
    try { return [JSON.parse(line).sessionID].filter(Boolean); } catch { return []; }
  })[0];
  if (sessionID) cleanupSession = () => promisify(execFile)(process.env.OPENCODE_BIN || "opencode",
    ["api", "delete", `/api/session/${sessionID}`, "--server", serverUrl], { cwd: directory, env: childEnv });
  assert.equal(code, 0, output.slice(-4000));
  assert.ok(calls.some(c => c.kind === "recall"), "Native context hook did not recall");
  assert.ok(observed.some(s => s.includes("OB1_NATIVE_CONTEXT_MARKER")), "Memory missing from actual model request");
  for (let i = 0; i < 100 && !calls.some(c => c.kind === "writeback"); i++) await new Promise(r => setTimeout(r, 50));
  const write = calls.find(c => c.kind === "writeback");
  if (!write) console.error(JSON.stringify({ calls: calls.map(c => c.kind), modelRequests: observed.length,
    extractionRequests: observed.filter(x => x.includes("Extract only durable project")).length, diagnostics }));
  assert.ok(write, "Native idle checkpoint did not reach the fixture backend");
  assert.equal(write.body.provenance.requires_review, true);
  assert.equal(write.body.runtime.name, "opencode");
  for (let i = 0; i < 100 && !calls.some(c => c.kind === "review"); i++) await new Promise(r => setTimeout(r, 50));
  assert.ok(calls.some(c => c.kind === "review"), "Native evidence-only review did not complete");
  await promisify(execFile)(process.env.OPENCODE_BIN || "opencode",
    ["api", "post", `/api/session/${sessionID}/compact`, "--data", "{}", "--server", serverUrl], { cwd: directory, env: childEnv });
  let compacted = false;
  for (let i = 0; i < 100; i++) {
    const { stdout } = await promisify(execFile)(process.env.OPENCODE_BIN || "opencode",
      ["api", "get", `/api/session/${sessionID}/context`, "--server", serverUrl], { cwd: directory, env: childEnv });
    const result = JSON.parse(stdout);
    if ((result.data ?? result).some(m => m.type === "compaction")) { compacted = true; break; }
    await new Promise(r => setTimeout(r, 50));
  }
  assert.ok(compacted, "Native compaction did not complete with the plugin enabled");
  console.log(JSON.stringify({ ok: true, native_recall: true, model_context_injection: true, native_completion_checkpoint: true,
    native_compaction: true, native_evidence_review: true,
    actual_external_writes: 0 }));
} finally {
  if (cleanupSession) await cleanupSession().catch(() => {});
  if (host && host.exitCode === null) {
    host.kill("SIGTERM");
    await new Promise(r => host.once("exit", r));
  }
  server.closeAllConnections(); await new Promise(r => server.close(r));
  await rm(directory, { recursive: true, force: true });
}
