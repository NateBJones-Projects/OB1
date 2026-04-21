/**
 * Unit tests for the Gemini sync state helper (Phase C).
 *
 * The helper at `../gemini-sync-state.js` is a classic-script IIFE (service
 * worker land, no ESM). To load it in a Node ESM test we evaluate its source
 * inside a tiny vm sandbox that supplies a `self` global for the IIFE to
 * attach onto, mirroring the SW runtime. The tests then exercise the
 * resulting `OBGeminiSyncState` object.
 *
 * Run with: node --test lib/__tests__/gemini-sync-state.test.js
 */

import test from 'node:test';
// Non-strict assert: deepEqual tolerates cross-realm prototypes for arrays
// created inside the vm sandbox (they're still structurally `Array`-shaped
// but not `instanceof` the host realm's Array). All value checks below are
// structural, so this looser comparison is exactly what we want.
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import vm from 'node:vm';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const helperPath = path.resolve(__dirname, '..', 'gemini-sync-state.js');
const helperSource = readFileSync(helperPath, 'utf8');

function loadStateModule() {
  // The IIFE attaches its API to whichever of globalThis/self exists. In the
  // vm sandbox, `globalThis` IS the context object. We expose `self` as the
  // same reference so either branch lands in the same place and we can read
  // `OBGeminiSyncState` off the sandbox.
  const sandbox = { console, setTimeout, clearTimeout };
  sandbox.self = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(helperSource, sandbox, { filename: helperPath });
  if (!sandbox.OBGeminiSyncState) {
    throw new Error('Helper did not attach OBGeminiSyncState to global');
  }
  return sandbox.OBGeminiSyncState;
}

const stateMod = loadStateModule();

// ── State transitions ───────────────────────────────────────────────────────

test('createInitialState returns idle with zeroed counters', () => {
  const s = stateMod.createInitialState();
  assert.equal(s.state, 'idle');
  assert.deepEqual(s.pendingIds, []);
  assert.deepEqual(s.completedIds, []);
  assert.deepEqual(s.failedIds, []);
  assert.equal(s.totals.captured, 0);
  assert.equal(s.totals.skippedDup, 0);
  assert.equal(s.totals.turnsSeen, 0);
});

test('canTransition allows idle → enumerating', () => {
  assert.equal(stateMod.canTransition('idle', 'enumerating'), true);
});

test('canTransition allows enumerating → syncing', () => {
  assert.equal(stateMod.canTransition('enumerating', 'syncing'), true);
});

test('canTransition allows syncing → done', () => {
  assert.equal(stateMod.canTransition('syncing', 'done'), true);
});

test('canTransition allows syncing → canceled', () => {
  assert.equal(stateMod.canTransition('syncing', 'canceled'), true);
});

test('canTransition rejects idle → syncing (must go through enumerating)', () => {
  assert.equal(stateMod.canTransition('idle', 'syncing'), false);
});

test('canTransition rejects done → syncing directly', () => {
  assert.equal(stateMod.canTransition('done', 'syncing'), false);
});

test('canTransition allows canceled → syncing (resume path)', () => {
  // Required for the Resume Sync button: when a run was paused by Google's
  // bot challenge, state is CANCELED with pendingIds > 0. resumeSync()
  // transitions CANCELED → SYNCING to pick up where we left off.
  assert.equal(stateMod.canTransition('canceled', 'syncing'), true);
});

test('canTransition allows failed → syncing (recover path)', () => {
  assert.equal(stateMod.canTransition('failed', 'syncing'), true);
});

test('transition mutates state when allowed', () => {
  const s = stateMod.createInitialState();
  stateMod.transition(s, 'enumerating');
  assert.equal(s.state, 'enumerating');
  stateMod.transition(s, 'syncing');
  assert.equal(s.state, 'syncing');
  stateMod.transition(s, 'done');
  assert.equal(s.state, 'done');
});

test('transition is a no-op when disallowed', () => {
  const s = stateMod.createInitialState();
  stateMod.transition(s, 'syncing');
  assert.equal(s.state, 'idle'); // blocked, no change
});

test('full happy-path chain idle→enumerating→syncing→done', () => {
  const s = stateMod.createInitialState();
  assert.equal(s.state, 'idle');
  stateMod.transition(s, 'enumerating');
  assert.equal(s.state, 'enumerating');
  stateMod.transition(s, 'syncing');
  assert.equal(s.state, 'syncing');
  stateMod.transition(s, 'done');
  assert.equal(s.state, 'done');
});

test('cancel path syncing→canceled→idle', () => {
  const s = stateMod.createInitialState();
  stateMod.transition(s, 'enumerating');
  stateMod.transition(s, 'syncing');
  stateMod.transition(s, 'canceled');
  assert.equal(s.state, 'canceled');
  stateMod.transition(s, 'idle');
  assert.equal(s.state, 'idle');
});

// ── mergePendingIds / completedIds monotonicity ─────────────────────────────

test('mergePendingIds deduplicates and filters non-strings', () => {
  const s = stateMod.createInitialState();
  stateMod.mergePendingIds(s, ['abc', 'abc', 'def', null, undefined, 42, '', '   '], 100);
  assert.deepEqual(s.pendingIds, ['abc', 'def']);
});

test('mergePendingIds skips already-completed IDs', () => {
  const s = stateMod.createInitialState();
  s.completedIds = ['already_done'];
  stateMod.mergePendingIds(s, ['new1', 'already_done', 'new2'], 100);
  assert.deepEqual(s.pendingIds, ['new1', 'new2']);
});

test('mergePendingIds skips already-failed IDs', () => {
  const s = stateMod.createInitialState();
  s.failedIds = ['broken_id'];
  stateMod.mergePendingIds(s, ['new1', 'broken_id'], 100);
  assert.deepEqual(s.pendingIds, ['new1']);
});

test('mergePendingIds enforces cap strictly', () => {
  const s = stateMod.createInitialState();
  const many = Array.from({ length: 50 }, (_, i) => `id${i}`);
  stateMod.mergePendingIds(s, many, 10);
  assert.equal(s.pendingIds.length, 10);
  assert.equal(s.cap, 10);
});

test('mergePendingIds cap accounts for already-completed IDs', () => {
  const s = stateMod.createInitialState();
  s.completedIds = ['done1', 'done2', 'done3'];
  const newOnes = Array.from({ length: 50 }, (_, i) => `new${i}`);
  stateMod.mergePendingIds(s, newOnes, 10);
  // Cap 10 minus 3 already complete = 7 slots left.
  assert.equal(s.pendingIds.length, 7);
});

test('mergePendingIds preserves existing pendingIds across re-enumeration', () => {
  const s = stateMod.createInitialState();
  s.pendingIds = ['old1', 'old2'];
  stateMod.mergePendingIds(s, ['new1'], 100);
  assert.ok(s.pendingIds.includes('old1'));
  assert.ok(s.pendingIds.includes('old2'));
  assert.ok(s.pendingIds.includes('new1'));
});

test('completedIds grows monotonically across recordCompletion calls', () => {
  const s = stateMod.createInitialState();
  s.pendingIds = ['a', 'b', 'c'];
  stateMod.recordCompletion(s, 'a', { captured: 3, skippedDup: 1, other: 0, total: 4 });
  assert.deepEqual(s.completedIds, ['a']);
  assert.deepEqual(s.pendingIds, ['b', 'c']);
  stateMod.recordCompletion(s, 'b', { captured: 2, skippedDup: 0, other: 1, total: 3 });
  assert.deepEqual(s.completedIds, ['a', 'b']);
  assert.deepEqual(s.pendingIds, ['c']);
  assert.equal(s.completedIds.length >= 2, true);
});

test('recordCompletion folds totals', () => {
  const s = stateMod.createInitialState();
  s.pendingIds = ['x', 'y'];
  stateMod.recordCompletion(s, 'x', { captured: 5, skippedDup: 2, other: 1, total: 8 });
  stateMod.recordCompletion(s, 'y', { captured: 3, skippedDup: 0, other: 0, total: 3 });
  assert.equal(s.totals.captured, 8);
  assert.equal(s.totals.skippedDup, 2);
  assert.equal(s.totals.other, 1);
  assert.equal(s.totals.turnsSeen, 11);
});

test('recordCompletion handles missing result gracefully', () => {
  const s = stateMod.createInitialState();
  s.pendingIds = ['only'];
  stateMod.recordCompletion(s, 'only', null);
  assert.deepEqual(s.completedIds, ['only']);
  assert.equal(s.totals.captured, 0);
});

test('recordFailure moves id to failedIds and stores reason', () => {
  const s = stateMod.createInitialState();
  s.pendingIds = ['good', 'bad'];
  stateMod.recordFailure(s, 'bad', 'timeout');
  assert.deepEqual(s.failedIds, ['bad']);
  assert.deepEqual(s.pendingIds, ['good']);
  assert.equal(s.lastError, 'timeout');
});

test('recordCompletion is idempotent for the same id', () => {
  const s = stateMod.createInitialState();
  s.pendingIds = ['dup'];
  stateMod.recordCompletion(s, 'dup', { captured: 1, total: 1 });
  stateMod.recordCompletion(s, 'dup', { captured: 99, total: 99 });
  assert.deepEqual(s.completedIds, ['dup']);
});

test('recordCompletion does NOT fold totals twice for a duplicate id', () => {
  // Prevents a late/retried notifyHistoryCaptured from inflating the
  // captured/dedup/turnsSeen counts after the id is already completed.
  const s = stateMod.createInitialState();
  s.pendingIds = ['dup'];
  stateMod.recordCompletion(s, 'dup', { captured: 3, skippedDup: 1, other: 0, total: 4 });
  stateMod.recordCompletion(s, 'dup', { captured: 10, skippedDup: 5, other: 2, total: 17 });
  assert.equal(s.totals.captured, 3);
  assert.equal(s.totals.skippedDup, 1);
  assert.equal(s.totals.other, 0);
  assert.equal(s.totals.turnsSeen, 4);
});

// ── summarizeProgress ───────────────────────────────────────────────────────

test('summarizeProgress computes percent from completed + failed', () => {
  const s = stateMod.createInitialState();
  s.pendingIds = ['a', 'b'];
  s.completedIds = ['c', 'd'];
  s.failedIds = ['e'];
  const p = stateMod.summarizeProgress(s);
  assert.equal(p.total, 5);
  assert.equal(p.completed, 2);
  assert.equal(p.failed, 1);
  assert.equal(p.pending, 2);
  assert.equal(p.percent, 60); // (2+1)/5 = 60%
});

test('summarizeProgress returns zero percent for empty state', () => {
  const s = stateMod.createInitialState();
  const p = stateMod.summarizeProgress(s);
  assert.equal(p.percent, 0);
  assert.equal(p.state, 'idle');
});

// ── Waiter registry ─────────────────────────────────────────────────────────

test('notify resolves a pending waiter keyed by conversation ID', async () => {
  const registry = stateMod.createWaiterRegistry();
  const received = new Promise((resolve, reject) => {
    registry.register('conv123', {
      resolve: (val) => resolve(val),
      reject: (err) => reject(err)
    });
  });

  const returned = registry.notify('conv123', { captured: 7, skippedDup: 2, other: 0, total: 9 });
  assert.equal(returned, true);

  const result = await received;
  assert.equal(result.captured, 7);
  assert.equal(result.skippedDup, 2);
  assert.equal(result.total, 9);
});

test('notify for an unknown ID is a no-op returning false', () => {
  const registry = stateMod.createWaiterRegistry();
  const ok = registry.notify('never-registered', { captured: 1, total: 1 });
  assert.equal(ok, false);
});

test('notify clears the waiter so a second notify returns false', () => {
  const registry = stateMod.createWaiterRegistry();
  registry.register('only-once', { resolve: () => {}, reject: () => {} });
  assert.equal(registry.size(), 1);
  const first = registry.notify('only-once', {});
  assert.equal(first, true);
  assert.equal(registry.size(), 0);
  const second = registry.notify('only-once', {});
  assert.equal(second, false);
});

test('abort rejects a pending waiter with the supplied reason', async () => {
  const registry = stateMod.createWaiterRegistry();
  const p = new Promise((resolve, reject) => {
    registry.register('will-abort', {
      resolve: (v) => resolve(v),
      reject: (e) => reject(e)
    });
  });

  registry.abort('will-abort', new Error('stop'));

  await assert.rejects(p, /stop/);
});

test('abortAll rejects every pending waiter', async () => {
  const registry = stateMod.createWaiterRegistry();
  const captured = [];
  const promises = [];
  for (const id of ['a', 'b', 'c']) {
    promises.push(new Promise((resolve, reject) => {
      registry.register(id, {
        resolve,
        reject: (e) => { captured.push(e.message); reject(e); }
      });
    }).catch(() => { /* swallow */ }));
  }

  registry.abortAll('mass cancel');
  await Promise.all(promises);

  assert.equal(captured.length, 3);
  assert.equal(registry.size(), 0);
});

test('register replaces an existing waiter for the same ID', () => {
  const registry = stateMod.createWaiterRegistry();
  registry.register('slot', { resolve: () => {}, reject: () => {} });
  registry.register('slot', { resolve: () => {}, reject: () => {} });
  assert.equal(registry.size(), 1);
});

test('register rejects the previous waiter when replaced (no hanging promise)', async () => {
  // A reentrant driveConversation or a stale slot outliving its timeout
  // would otherwise leave the old promise unresolved forever.
  const registry = stateMod.createWaiterRegistry();
  const firstRejection = new Promise((resolve, reject) => {
    registry.register('slot', {
      resolve: (v) => resolve({ resolved: v }),
      reject: (e) => resolve({ rejected: e.message })
    });
  });
  registry.register('slot', { resolve: () => {}, reject: () => {} });
  const outcome = await firstRejection;
  assert.equal(outcome.rejected, 'waiter replaced by new registration');
});

test('register throws on invalid id', () => {
  const registry = stateMod.createWaiterRegistry();
  assert.throws(() => registry.register('', { resolve: () => {}, reject: () => {} }),
    /non-empty string/);
});

test('register throws on missing handlers', () => {
  const registry = stateMod.createWaiterRegistry();
  assert.throws(() => registry.register('id', null), /object/);
});

// ── resetToIdle ─────────────────────────────────────────────────────────────

test('resetToIdle wipes run state but preserves lastSyncAt', () => {
  const s = stateMod.createInitialState();
  s.state = 'syncing';
  s.pendingIds = ['x', 'y'];
  s.completedIds = ['done'];
  s.lastSyncAt = '2026-04-20T12:00:00Z';

  const fresh = stateMod.resetToIdle(s);
  assert.equal(fresh.state, 'idle');
  assert.deepEqual(fresh.pendingIds, []);
  assert.deepEqual(fresh.completedIds, []);
  assert.equal(fresh.lastSyncAt, '2026-04-20T12:00:00Z');
});
