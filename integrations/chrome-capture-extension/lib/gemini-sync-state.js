/**
 * Open Brain Capture — Gemini sync state machine (pure, node-testable)
 *
 * Phase C helper: the orchestrator in `background/gemini-sync.js` owns all
 * chrome.* interactions; this module owns only the pure state transitions,
 * waiter registry, and progress bookkeeping so they can be unit-tested in a
 * Node context without a browser.
 *
 * States:
 *   idle         — nothing in flight; safe to start
 *   enumerating  — sidebar enumeration running; no per-conversation work yet
 *   syncing      — looping over pending conversation IDs
 *   done         — finished successfully or ran out of work
 *   canceled     — user hit Cancel
 *   failed       — unrecoverable error; payload carries the reason
 */

/* global module */

(function (global) {
  'use strict';

  const STATES = Object.freeze({
    IDLE: 'idle',
    ENUMERATING: 'enumerating',
    SYNCING: 'syncing',
    DONE: 'done',
    CANCELED: 'canceled',
    FAILED: 'failed'
  });

  // State transitions — keys are {from}->{to} pairs; value is true if allowed.
  // Kept conservative: only transitions we actually need are allowed.
  //
  // CANCELED -> SYNCING: the "resume after Google-challenge pause" path.
  // resumeSync() uses this to pick up a paused run with pendingIds still
  // queued. Without it, clicking "Resume Sync" silently no-ops and the
  // main loop breaks on the first iteration.
  const ALLOWED_TRANSITIONS = Object.freeze({
    [STATES.IDLE]: [STATES.ENUMERATING],
    [STATES.ENUMERATING]: [STATES.SYNCING, STATES.CANCELED, STATES.FAILED, STATES.DONE],
    [STATES.SYNCING]: [STATES.DONE, STATES.CANCELED, STATES.FAILED],
    [STATES.DONE]: [STATES.IDLE, STATES.ENUMERATING],
    [STATES.CANCELED]: [STATES.IDLE, STATES.ENUMERATING, STATES.SYNCING],
    [STATES.FAILED]: [STATES.IDLE, STATES.ENUMERATING, STATES.SYNCING]
  });

  function canTransition(fromState, toState) {
    const allowed = ALLOWED_TRANSITIONS[fromState];
    if (!Array.isArray(allowed)) return false;
    return allowed.includes(toState);
  }

  /**
   * Create an initial state record. The orchestrator persists this shape to
   * chrome.storage.local under a single key so SW wake-ups can rehydrate
   * mid-run.
   */
  function createInitialState() {
    return {
      state: STATES.IDLE,
      startedAt: null,
      lastHeartbeatAt: null,
      pendingIds: [],
      completedIds: [],
      failedIds: [],
      totals: {
        captured: 0,
        skippedDup: 0,
        other: 0,
        turnsSeen: 0
      },
      cap: null,
      currentId: null,
      syncTabId: null,
      lastError: '',
      lastSyncAt: null,
      canceledReason: '',
      // Lifetime memory of every conversation id we've ever successfully
      // synced. Used by incremental/auto-sync to skip already-captured
      // conversations. Survives resetToIdle (see preserveAcrossReset).
      everSyncedIds: [],
      // Auto-sync settings. autoSyncEnabled gates the alarm; interval is in
      // minutes. Default OFF to match the rest of the extension's sync
      // toggles (Claude + ChatGPT auto-sync are also opt-in). Users who
      // want hands-free incremental sync can flip it on from the Sync tab.
      autoSyncEnabled: false,
      autoSyncIntervalMinutes: 240,
      lastAutoSyncAt: null,
      // Bumped when we introduce a migration that needs to alter existing
      // stored records. See loadState() in gemini-sync.js for the migration
      // logic.
      schemaVersion: 1
    };
  }

  /**
   * Transition the state record's `state` field if allowed. Returns the new
   * record (same reference if no transition happened). Callers are expected
   * to persist the returned record.
   */
  function transition(record, nextState) {
    if (!record || typeof record !== 'object') {
      throw new Error('transition: record must be an object');
    }
    if (!canTransition(record.state, nextState)) {
      return record;
    }
    record.state = nextState;
    return record;
  }

  /**
   * Reset an in-flight record back to idle. Used by cancel, done, and
   * stale-resume paths.
   */
  function resetToIdle(record) {
    const fresh = createInitialState();
    if (record && typeof record === 'object') {
      // Preserve lastSyncAt across resets; it's a user-visible timestamp.
      fresh.lastSyncAt = record.lastSyncAt || null;
      // Preserve lifetime-synced IDs so incremental/auto-sync can skip
      // already-captured conversations forever.
      if (Array.isArray(record.everSyncedIds)) {
        fresh.everSyncedIds = record.everSyncedIds.slice();
      }
      // Preserve auto-sync settings so toggling is sticky.
      fresh.autoSyncEnabled = Boolean(record.autoSyncEnabled);
      if (Number.isFinite(Number(record.autoSyncIntervalMinutes)) && Number(record.autoSyncIntervalMinutes) > 0) {
        fresh.autoSyncIntervalMinutes = Number(record.autoSyncIntervalMinutes);
      }
      fresh.lastAutoSyncAt = record.lastAutoSyncAt || null;
    }
    return fresh;
  }

  /**
   * Merge the newly-discovered sidebar IDs into the record. Respects the
   * configured cap — never allows more than `cap` IDs in pendingIds, and
   * never re-adds IDs already in completedIds or failedIds.
   *
   * Returns the mutated record for convenience.
   */
  function mergePendingIds(record, discoveredIds, cap) {
    if (!record || typeof record !== 'object') {
      throw new Error('mergePendingIds: record must be an object');
    }
    if (!Array.isArray(discoveredIds)) {
      throw new Error('mergePendingIds: discoveredIds must be an array');
    }

    const effectiveCap = Number.isFinite(cap) && cap > 0
      ? Math.floor(cap)
      : null;
    record.cap = effectiveCap;

    const completedSet = new Set(record.completedIds || []);
    const failedSet = new Set(record.failedIds || []);
    const seenInCombined = new Set();

    const combined = [];
    const appendIfNew = (id) => {
      if (typeof id !== 'string') return;
      const trimmed = id.trim();
      if (!trimmed) return;
      if (completedSet.has(trimmed)) return;
      if (failedSet.has(trimmed)) return;
      if (seenInCombined.has(trimmed)) return;
      seenInCombined.add(trimmed);
      combined.push(trimmed);
    };

    for (const id of discoveredIds) appendIfNew(id);

    // Preserve originally-pending IDs that didn't appear in the new discovery
    // (e.g. mid-run, sidebar DOM fell out of view). They stay queued.
    for (const id of (record.pendingIds || [])) appendIfNew(id);

    if (effectiveCap !== null) {
      const roomLeft = Math.max(0, effectiveCap - completedSet.size - failedSet.size);
      record.pendingIds = combined.slice(0, roomLeft);
    } else {
      record.pendingIds = combined;
    }

    return record;
  }

  /**
   * Called after a conversation completes. Moves `id` from pendingIds into
   * completedIds and folds the per-turn counts into totals.
   *
   * `result` shape: { captured, skippedDup, other, total }
   */
  function recordCompletion(record, id, result) {
    if (!record || typeof record !== 'object') {
      throw new Error('recordCompletion: record must be an object');
    }
    if (typeof id !== 'string' || !id) {
      throw new Error('recordCompletion: id must be a non-empty string');
    }

    record.pendingIds = (record.pendingIds || []).filter((x) => x !== id);
    if (!Array.isArray(record.completedIds)) record.completedIds = [];

    // Idempotence: if this id has already been recorded (duplicate notify
    // from a retry, stale waiter resolving late, etc.), skip totals folding.
    // Without this, a double-callback would inflate captured/dedup counts.
    const alreadyCompleted = record.completedIds.includes(id);
    if (!alreadyCompleted) {
      record.completedIds.push(id);
    }

    // Lifetime memory — survives resetToIdle. Incremental/auto-sync uses
    // this to skip already-captured conversations.
    if (!Array.isArray(record.everSyncedIds)) record.everSyncedIds = [];
    if (!record.everSyncedIds.includes(id)) record.everSyncedIds.push(id);

    if (!alreadyCompleted) {
      const safe = result && typeof result === 'object' ? result : {};
      record.totals = record.totals || { captured: 0, skippedDup: 0, other: 0, turnsSeen: 0 };
      record.totals.captured += Number(safe.captured) || 0;
      record.totals.skippedDup += Number(safe.skippedDup) || 0;
      record.totals.other += Number(safe.other) || 0;
      record.totals.turnsSeen += Number(safe.total) || 0;
    }

    record.currentId = null;
    return record;
  }

  /**
   * Given a list of discovered sidebar conversation IDs, return the ones
   * not yet in `everSyncedIds` (lifetime-synced) — respecting the cap.
   * Used by incremental/auto-sync to navigate only the delta.
   */
  function filterToNewIds(record, discoveredIds, cap) {
    if (!Array.isArray(discoveredIds)) return [];
    const seen = new Set(Array.isArray(record && record.everSyncedIds) ? record.everSyncedIds : []);
    const capNumber = Number.isFinite(Number(cap)) && Number(cap) > 0 ? Math.floor(Number(cap)) : Infinity;
    const out = [];
    for (const id of discoveredIds) {
      if (typeof id !== 'string' || !id) continue;
      if (seen.has(id)) continue;
      seen.add(id);
      out.push(id);
      if (out.length >= capNumber) break;
    }
    return out;
  }

  /**
   * Called when a conversation can't be synced (timeout, navigation error,
   * extractor rejection). Moves id from pendingIds to failedIds.
   */
  function recordFailure(record, id, reason) {
    if (!record || typeof record !== 'object') {
      throw new Error('recordFailure: record must be an object');
    }
    if (typeof id !== 'string' || !id) {
      throw new Error('recordFailure: id must be a non-empty string');
    }

    record.pendingIds = (record.pendingIds || []).filter((x) => x !== id);
    if (!Array.isArray(record.failedIds)) record.failedIds = [];
    if (!record.failedIds.includes(id)) record.failedIds.push(id);
    record.lastError = typeof reason === 'string' ? reason : String(reason || '');
    record.currentId = null;
    return record;
  }

  /**
   * Progress summary for the popup. Safe to derive synchronously from a
   * persisted record.
   */
  function summarizeProgress(record) {
    const completed = (record && Array.isArray(record.completedIds)) ? record.completedIds.length : 0;
    const failed = (record && Array.isArray(record.failedIds)) ? record.failedIds.length : 0;
    const pending = (record && Array.isArray(record.pendingIds)) ? record.pendingIds.length : 0;
    const totals = (record && record.totals) ? record.totals : { captured: 0, skippedDup: 0, other: 0, turnsSeen: 0 };
    const total = completed + failed + pending;
    const done = completed + failed;
    const percent = total > 0 ? Math.floor((done / total) * 100) : 0;
    const lifetimeSynced = (record && Array.isArray(record.everSyncedIds)) ? record.everSyncedIds.length : 0;
    return {
      state: (record && record.state) || STATES.IDLE,
      completed,
      failed,
      pending,
      total,
      percent,
      totals,
      currentId: (record && record.currentId) || null,
      lastError: (record && record.lastError) || '',
      lastSyncAt: (record && record.lastSyncAt) || null,
      canceledReason: (record && record.canceledReason) || '',
      lifetimeSynced,
      autoSyncEnabled: Boolean(record && record.autoSyncEnabled),
      autoSyncIntervalMinutes: Number(record && record.autoSyncIntervalMinutes) || 240,
      lastAutoSyncAt: (record && record.lastAutoSyncAt) || null
    };
  }

  /**
   * Pure waiter registry. The orchestrator registers `{resolve, reject}`
   * callables keyed by Gemini conversation ID; Phase B (gemini-debugger.js)
   * calls `notifyHistoryCaptured(id, result)` when a history capture
   * completes, which resolves the waiter.
   *
   * The registry is intentionally not tied to the state record — it holds
   * live callables that can't be JSON-serialized.
   */
  function createWaiterRegistry() {
    const waiters = new Map();

    function register(id, handlers) {
      if (typeof id !== 'string' || !id) {
        throw new Error('register: id must be a non-empty string');
      }
      if (!handlers || typeof handlers !== 'object') {
        throw new Error('register: handlers must be an object');
      }
      if (typeof handlers.resolve !== 'function' || typeof handlers.reject !== 'function') {
        throw new Error('register: handlers must have resolve and reject functions');
      }
      // If a waiter already exists for this id (reentrant driveConversation
      // or a stale entry that outlived its timeout), reject it before we
      // overwrite. Otherwise the previous promise hangs until abortAll, and
      // the old setTimeout fire path can abort the NEW waiter by id match.
      const existing = waiters.get(id);
      if (existing) {
        try {
          existing.reject(new Error('waiter replaced by new registration'));
        } catch (_err) {
          // Handlers must not throw; swallow defensively.
        }
      }
      waiters.set(id, handlers);
    }

    function notify(id, result) {
      if (typeof id !== 'string' || !id) return false;
      const entry = waiters.get(id);
      if (!entry) return false;
      waiters.delete(id);
      try {
        entry.resolve(result);
      } catch (_err) {
        // Waiter handlers should never throw; if they do, swallow to keep
        // Phase B's call-site safe.
      }
      return true;
    }

    function abort(id, reason) {
      if (typeof id !== 'string' || !id) return false;
      const entry = waiters.get(id);
      if (!entry) return false;
      waiters.delete(id);
      try {
        entry.reject(reason instanceof Error ? reason : new Error(String(reason || 'aborted')));
      } catch (_err) {
        // ditto
      }
      return true;
    }

    function abortAll(reason) {
      const ids = Array.from(waiters.keys());
      for (const id of ids) abort(id, reason);
    }

    function has(id) {
      return waiters.has(id);
    }

    function size() {
      return waiters.size;
    }

    return { register, notify, abort, abortAll, has, size };
  }

  const api = {
    STATES,
    canTransition,
    createInitialState,
    transition,
    resetToIdle,
    mergePendingIds,
    recordCompletion,
    recordFailure,
    filterToNewIds,
    summarizeProgress,
    createWaiterRegistry
  };

  // Expose as classic-script global for the SW scope.
  if (global && typeof global === 'object') {
    global.OBGeminiSyncState = api;
  }

  // Expose as CommonJS for node --test.
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : (typeof self !== 'undefined' ? self : this));
