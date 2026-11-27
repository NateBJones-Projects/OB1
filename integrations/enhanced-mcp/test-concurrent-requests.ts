/**
 * test-concurrent-requests.ts
 *
 * Regression check for the shared-McpServer defect: a module-level McpServer
 * re-connected to a new StreamableHTTPTransport per request sends an
 * in-flight request's response to whichever transport connected last, so
 * two overlapping requests in one isolate lose a response and the client
 * waits forever. Antigravity's agy CLI hit this on every start: it sends
 * `server/discover` and `notifications/roots/list_changed` at the same time.
 *
 * Runs the real edge function locally (no Supabase, no database: only the
 * MCP handshake and tools/list are exercised, which touch neither).
 *
 * Usage (from the repo root; works for any of the three per-request servers):
 *   deno run -A integrations/enhanced-mcp/test-concurrent-requests.ts integrations/enhanced-mcp/index.ts
 *   deno run -A integrations/enhanced-mcp/test-concurrent-requests.ts integrations/update-thought-mcp/index.ts
 *   deno run -A integrations/enhanced-mcp/test-concurrent-requests.ts integrations/delete-thought-mcp/index.ts
 *
 * Port 8000 (Deno.serve's default) must be free.
 *
 * Exits 0 when every overlapping request is answered, 1 otherwise.
 */

const target = Deno.args[0];
if (!target) {
  console.error("usage: deno run -A test-concurrent-requests.ts <path/to/index.ts>");
  Deno.exit(2);
}

const KEY = "test-key-concurrency";
const PORT = 8000; // Deno.serve's default; the functions do not choose a port.
const BASE = `http://127.0.0.1:${PORT}/`;
const TIMEOUT_MS = 8000;
const ROUNDS = 8;

// Refuse an occupied port: otherwise the child fails to bind and the checks
// would run against whatever server is already listening there.
try {
  Deno.listen({ hostname: "127.0.0.1", port: PORT }).close();
} catch {
  console.error(`port ${PORT} is in use; stop the process listening there and re-run`);
  Deno.exit(2);
}

// Run from the function's own folder so its deno.json import map applies.
const targetPath = Deno.realPathSync(target);
const child = new Deno.Command(Deno.execPath(), {
  args: ["run", "-A", "--quiet", targetPath],
  cwd: targetPath.slice(0, targetPath.lastIndexOf("/")),
  env: {
    SUPABASE_URL: "http://127.0.0.1:9", // never contacted by handshake/tools/list
    SUPABASE_SERVICE_ROLE_KEY: "test-service-role",
    MCP_ACCESS_KEY: KEY,
    OPENROUTER_API_KEY: "test-openrouter",
  },
  stdout: "null",
  stderr: "null",
}).spawn();
let childExited = false;
child.status.then(() => { childExited = true; });

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// slowBodyMs > 0 streams the body after a delay, the way a body arriving over
// a real network does. The handler has then connected its transport and is
// still reading the body when the next request connects; without that delay
// a local request finishes before the next one starts and the defect hides.
async function post(body: unknown, slowBodyMs = 0): Promise<{ status: number | "timeout"; text: string }> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  const bytes = new TextEncoder().encode(JSON.stringify(body));
  const payload = slowBodyMs > 0
    ? new ReadableStream<Uint8Array>({
      async start(c) {
        await sleep(slowBodyMs);
        c.enqueue(bytes);
        c.close();
      },
    })
    : bytes;
  try {
    const r = await fetch(BASE, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json, text/event-stream",
        "x-brain-key": KEY,
      },
      body: payload,
      signal: ctl.signal,
    });
    return { status: r.status, text: await r.text() };
  } catch {
    return { status: "timeout", text: "" };
  } finally {
    clearTimeout(t);
  }
}

let failed = 0;
function check(ok: boolean, label: string) {
  console.log(`  ${ok ? "✓" : "✗"}  ${label}`);
  if (!ok) failed++;
}

try {
  // Wait for the function to listen.
  let up = false;
  for (let i = 0; i < 100 && !up; i++) {
    if (childExited) throw new Error(`${target} exited before listening`);
    try {
      await fetch(BASE, { method: "OPTIONS" }).then((r) => r.body?.cancel());
      up = true;
    } catch {
      await new Promise((r) => setTimeout(r, 200));
    }
  }
  if (!up || childExited) throw new Error(`${target} did not start on port ${PORT}`);

  console.log(`\n${target}`);
  console.log(`[1] ${ROUNDS} rounds: a request and a notification sent together`);
  for (let i = 0; i < ROUNDS; i++) {
    const [req, note] = await Promise.all([
      post({ jsonrpc: "2.0", id: 1, method: "server/discover", params: {} }, 300),
      sleep(50).then(() => post({ jsonrpc: "2.0", method: "notifications/roots/list_changed", params: {} })),
    ]);
    check(req.status === 200 && req.text.includes('"id":1'), `round ${i + 1}: request answered (${req.status})`);
    check(note.status === 202, `round ${i + 1}: notification accepted (${note.status})`);
  }

  console.log("[2] 6 tools/list requests at once, each answered with its own id");
  const ids = [11, 12, 13, 14, 15, 16];
  const res = await Promise.all(
    ids.map((id, k) => post({ jsonrpc: "2.0", id, method: "tools/list", params: {} }, 100 + 60 * k)),
  );
  res.forEach((r, k) =>
    check(r.status === 200 && r.text.includes(`"id":${ids[k]}`) && r.text.includes('"tools"'), `tools/list id ${ids[k]} (${r.status})`)
  );
} catch (e) {
  console.error(`  ✗  ${(e as Error).message}`);
  failed++;
} finally {
  try { child.kill("SIGTERM"); } catch { /* already gone */ }
  await child.status;
}

console.log(failed ? `FAIL (${failed})\n` : "PASS\n");
Deno.exit(failed ? 1 : 0);
