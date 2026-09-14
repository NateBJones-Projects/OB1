import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

// Synthetic local-only integration: no real Open Brain keys or data.
const root = process.cwd();
const state = await mkdtemp(path.join(tmpdir(), 'ob-auth-smoke-'));
const node = process.execPath;
let child;
let output = '';
const api = createServer((req, res) => {
  res.writeHead(req.url === '/health' && req.headers['x-brain-key'] === 'synthetic-smoke-key' ? 200 : 401, { 'Content-Type': 'application/json' });
  res.end('{}');
});
await new Promise(resolve => api.listen(3051, '127.0.0.1', resolve));
const base = 'http://127.0.0.1:3050';
async function start() {
  const helper = path.join(root, 'scripts/local-session-secret.ps1').replaceAll("'", "''");
  const dir = state.replaceAll("'", "''");
  const command = `. '${helper}'; $env:SESSION_SECRET = Get-LocalDashboardSessionSecret -StoreDirectory '${dir}'; & '${node.replaceAll("'", "''")}' './node_modules/next/dist/bin/next' start -H 127.0.0.1 -p 3050`;
  child = spawn('pwsh.exe', ['-NoProfile', '-Command', command], {
    cwd: root, windowsHide: true, env: { ...process.env, LOCAL_DASHBOARD_AUTH: 'true', OB1_DEMO_AUTH_BYPASS: 'false', NEXT_PUBLIC_API_URL: 'http://127.0.0.1:3051', NEXT_PUBLIC_ALLOW_HARD_DELETE: 'false', RESTRICTED_PASSPHRASE_HASH: '' }, stdio: ['ignore', 'pipe', 'pipe']
  });
  child.stdout.on('data', b => output += b.toString());
  child.stderr.on('data', b => output += b.toString());
  const deadline = Date.now() + 45000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw Error(`Test dashboard exited: ${output}`);
    try { if ((await fetch(base + '/login')).status === 200) return; } catch {}
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw Error(`Test dashboard failed readiness: ${output}`);
}
async function stop() {
  if (!child || child.exitCode !== null) return;
  const killer = spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
  await new Promise(resolve => killer.once('exit', resolve));
  await new Promise(resolve => child.exitCode !== null ? resolve() : child.once('exit', resolve));
}
async function login(remember, key = 'synthetic-smoke-key') {
  const html = await (await fetch(base + '/login')).text();
  assert.ok(html.includes('Remember this device for 30 days'));
  const manifest = JSON.parse(await readFile(path.join(root, '.next/server/server-reference-manifest.json'), 'utf8'));
  const action = Object.entries(manifest.node).find(([, value]) => Object.keys(value.workers).includes('app/login/page'))?.[0];
  assert.ok(action, 'Built login Server Action identifier is present');
  // React Server Action wire encoding for the single FormData argument.
  const form = new FormData();
  form.set('_1_apiKey', key);
  if (remember) form.set('_1_rememberDevice', 'on');
  form.set('0', '["$K1"]');
  return fetch(base + '/login', { method: 'POST', headers: { Origin: base, 'Next-Action': action, Accept: 'text/x-component' }, body: form, redirect: 'manual' });
}
try {
  await start();
  assert.equal((await fetch(base + '/api/restricted')).status, 401);
  const invalid = await login(true, 'invalid-synthetic-key');
  assert.equal(invalid.headers.get('set-cookie'), null);
  const ordinary = await login(false);
  assert.equal(ordinary.status, 200);
  assert.match(ordinary.headers.get('x-action-redirect'), /^\/;/);
  assert.match(ordinary.headers.get('set-cookie'), /Max-Age=86340/i);
  const remembered = await login(true);
  assert.equal(remembered.status, 200);
  assert.match(remembered.headers.get('x-action-redirect'), /^\/;/);
  const setCookie = remembered.headers.get('set-cookie');
  assert.match(setCookie, /Max-Age=2591940/i);
  assert.match(setCookie, /HttpOnly/i);
  assert.match(setCookie, /SameSite=lax/i);
  const cookie = setCookie.split(';')[0];
  assert.equal((await fetch(base + '/api/restricted', { headers: { Cookie: cookie } })).status, 200);
  await stop();
  await start();
  assert.equal((await fetch(base + '/api/restricted', { headers: { Cookie: cookie } })).status, 200, 'remembered cookie must survive a real server restart');
  const logout = await fetch(base + '/api/logout', { method: 'POST', headers: { Cookie: cookie, Origin: base }, redirect: 'manual' });
  assert.match(logout.headers.get('set-cookie'), /Max-Age=0/i);
  assert.equal((await fetch(base + '/api/restricted', { headers: { Cookie: logout.headers.get('set-cookie').split(';')[0] } })).status, 401);
  const protectedText = await readFile(path.join(state, 'session-secret.dpapi'), 'utf8');
  assert.ok(protectedText.length > 100);
  console.log('PASS: real login action, rejected bad key, 24h/30d cookie lifetimes, HttpOnly/SameSite, server restart persistence, logout, unauthenticated denial. Synthetic loopback API only.');
} finally {
  await stop(); api.close(); await rm(state, { recursive: true, force: true });
}
