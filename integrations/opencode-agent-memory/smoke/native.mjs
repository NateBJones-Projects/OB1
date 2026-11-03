// Real OpenCode host + local fake OB1/model endpoints. No external writes or model calls.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { randomBytes } from "node:crypto";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const directory = await mkdtemp(join(tmpdir(), "ob1-opencode-native-"));
const calls = [], observed = [];
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
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ memories: [{ memory_id: "native-checkpoint" }] })); return;
    }
    if (req.url?.endsWith("/chat/completions")) {
      const input = JSON.stringify(body.messages);
      observed.push(input);
      const text = input.includes("Extract only durable project")
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
  await writeFile(join(directory, "opencode.json"), JSON.stringify({
    model: "ollama/ob1-smoke-check",
    agents: { compaction: { model: "ollama/ob1-smoke-check" } },
    providers: { "ollama": { package: "@opencode/ai/providers/openai-compatible",
      settings: { baseURL: base + "/v1", apiKey: "local-smoke-only" },
      models: { "ob1-smoke-check": { modelID: "ob1-smoke-check", capabilities: { tools: false, input: ["text"], output: ["text"] },
        limit: { context: 16000, output: 1000 } } } } },
    plugins: [{ package: root, options: { endpoint: base + "/ob1", workspaceId: "smoke",
      projectId: "opencode-native-smoke", keyEnv: "OB1_NATIVE_SMOKE_KEY", autoCapture: true } }],
    mcp: { servers: { openbrain: { type: "local", command: ["unused"], disabled: true } } },
  }, null, 2));
  if (process.env.OB1_SMOKE_DEBUG) {
    const { stdout } = await promisify(execFile)(process.env.OPENCODE_BIN || "opencode", ["debug", "config", "--standalone"], { cwd: directory });
    console.log(JSON.stringify(JSON.parse(stdout).map(x => ({ path: x.path, providers: Object.keys(x.info?.providers ?? {}), plugins: x.info?.plugins }))));
  }
  const password = randomBytes(24).toString("hex");
  const childEnv = { ...process.env, PWD: directory, INIT_CWD: directory, OB1_NATIVE_SMOKE_KEY: "local-smoke-only",
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
    native_compaction: true,
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
