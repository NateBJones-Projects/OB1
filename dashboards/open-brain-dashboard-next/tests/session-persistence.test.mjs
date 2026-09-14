import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import test from 'node:test';
import ts from 'typescript';
import { getIronSession, sealData } from 'iron-session';

const require = createRequire(import.meta.url);
const secret = 'synthetic-test-session-secret-not-a-real-credential';
const day = 86400;
function loadAuth({ local = true, store = cookieStore() } = {}) {
  const source = readFileSync(new URL('../lib/auth.ts', import.meta.url), 'utf8');
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  const exports = {};
  vm.runInNewContext(output, { exports, process: { env: { SESSION_SECRET: secret, LOCAL_DASHBOARD_AUTH: String(local) } },
    require: (id) => id === 'next/headers' ? { cookies: async () => store } :
      id === 'next/navigation' ? { redirect: () => { throw Error('redirect'); } } : require(id), Date });
  return { auth: exports, store };
}
function cookieStore() {
  let cookie;
  return { options: null, get: () => cookie ? { value: cookie } : undefined,
    set(_name, value, options) { cookie = value; this.options = options; } };
}

test('local remembered login survives module restart and retains 30-day expiry', async () => {
  const { auth, store } = loadAuth();
  assert.equal(typeof auth.startSession, 'function', 'missing remembered-session login helper');
  await auth.startSession('synthetic-access-key', true);
  assert.equal(store.options.maxAge, 30 * day - 60);
  assert.equal(store.options.httpOnly, true);
  assert.equal(store.options.sameSite, 'lax');
  assert.equal(store.options.secure, false);
  assert.ok(!store.get().value.includes('synthetic-access-key'));
  const reloaded = loadAuth({ store }).auth;
  assert.equal((await reloaded.requireSession()).apiKey, 'synthetic-access-key');
  const session = await reloaded.getSession();
  const expiry = session.expiresAt;
  await session.save();
  assert.equal((await reloaded.getSession()).expiresAt, expiry);
  assert.ok(store.options.maxAge > 29 * day);
});

test('real encrypted sessions expire at their selected deadline', async () => {
  const realNow = Date.now;
  const now = realNow();
  const remembered = loadAuth();
  const ordinary = loadAuth();
  try {
    Date.now = () => now;
    await remembered.auth.startSession('synthetic-access-key', true);
    await ordinary.auth.startSession('synthetic-access-key', false);
    Date.now = () => now + 2 * day * 1000;
    assert.equal((await loadAuth({ store: remembered.store }).auth.requireSession()).apiKey, 'synthetic-access-key');
    await assert.rejects(loadAuth({ store: ordinary.store }).auth.requireSession(), { name: 'AuthError' });
    Date.now = () => now + 31 * day * 1000;
    await assert.rejects(loadAuth({ store: remembered.store }).auth.requireSession(), { name: 'AuthError' });
  } finally { Date.now = realNow; }
});

test('unchecked and hosted login retain the 24-hour policy', async () => {
  for (const [local, remember] of [[true, false], [false, true]]) {
    const { auth, store } = loadAuth({ local });
    assert.equal(typeof auth.startSession, 'function', 'missing session policy');
    await auth.startSession('synthetic-access-key', remember);
    assert.equal(store.options.maxAge, day - 60);
  }
});

test('expired authenticated payload fails closed even in a freshly sealed cookie', async () => {
  const { auth, store } = loadAuth();
  store.set('open_brain_session', await sealData({ loggedIn: true, apiKey: 'synthetic-access-key', rememberDevice: true, expiresAt: Date.now() - 1 }, { password: secret, ttl: 30 * day }), {});
  await assert.rejects(auth.requireSession(), { name: 'AuthError' });
});

test('tampered cookie and logout deny access', async () => {
  const { auth, store } = loadAuth();
  assert.equal(typeof auth.startSession, 'function', 'missing session login helper');
  await auth.startSession('synthetic-access-key', true);
  const session = await auth.getSession();
  session.destroy();
  assert.equal(store.options.maxAge, 0);
  await assert.rejects(auth.requireSession(), { name: 'AuthError' });
  store.set('open_brain_session', 'not-an-authentic-cookie', {});
  await assert.rejects(auth.requireSession(), { name: 'AuthError' });
});

test('new login clears any previous restricted unlock', async () => {
  const { auth, store } = loadAuth();
  const session = await getIronSession(store, auth.sessionOptions);
  session.restrictedUnlocked = true;
  await session.save();
  assert.equal(typeof auth.startSession, 'function', 'missing session login helper');
  await auth.startSession('synthetic-access-key', true);
  assert.equal((await auth.getSession()).restrictedUnlocked, false);
});

test('login form offers an explicit local-only opt-in and action enforces it', () => {
  const page = readFileSync(new URL('../app/login/page.tsx', import.meta.url), 'utf8');
  const form = readFileSync(new URL('../app/login/LoginForm.tsx', import.meta.url), 'utf8');
  assert.match(page, /startSession\(apiKey, formData.get\("rememberDevice"\) === "on"\)/);
  assert.match(page, /allowRememberDevice=\{process.env.LOCAL_DASHBOARD_AUTH === "true"\}/);
  assert.match(form, /Remember this device for 30 days/);
  assert.match(form, /name="rememberDevice"/);
  assert.doesNotMatch(form, /defaultChecked/);
});
