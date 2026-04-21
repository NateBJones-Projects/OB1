/**
 * Open Brain Capture — Gemini "Sync All History" orchestrator (Phase C)
 *
 * Drives a one-shot full-history backfill by walking the Gemini sidebar,
 * navigating a dedicated background tab to each conversation, and waiting
 * for the Phase B debugger capture (gemini-debugger.js → hNvQHb batchexecute)
 * to call back through `notifyHistoryCaptured(id, result)`.
 *
 * Design principles:
 *   - No DOM scraping for content — Phase B still owns that via chrome.debugger.
 *   - Resumable across MV3 service-worker restarts via chrome.storage.local.
 *   - User-cancelable at any time.
 *   - No per-conversation API calls from this module; it only coordinates.
 *   - No telemetry, no third-party hosts.
 *
 * State transitions and bookkeeping live in the pure helper at
 * `lib/gemini-sync-state.js` (`OBGeminiSyncState`).
 */

/* global chrome, self, OBGeminiSyncState */

(function () {
  'use strict';

  // ---------------------------------------------------------------------------
  // Constants
  // ---------------------------------------------------------------------------

  // Persisted state key. Single object under chrome.storage.local so rehydrate
  // on SW wake is a single read.
  const STATE_STORAGE_KEY = 'ob_gemini_sync_state';

  const GEMINI_APP_URL = 'https://gemini.google.com/app';

  // Hard ceiling to avoid runaway iteration on pathological sidebar DOMs.
  const DEFAULT_CAP = 2000;

  // Gentler cap for auto/incremental runs. Keeps total navigations per
  // scheduled cycle low so we don't tempt Google's bot detector. If there
  // are more than this many new conversations since the last run, the
  // remainder waits for the next alarm.
  const DEFAULT_AUTO_CAP = 20;

  // Max time to wait between navigating the sync tab and Phase B firing the
  // capture callback. A typical hNvQHb round-trip is 0.5s-3s; 15s absorbs
  // slow networks without pinning the orchestrator forever.
  const CAPTURE_WAIT_TIMEOUT_MS = 15000;

  // Max time to wait for Phase B's debugger to re-attach to the sync tab
  // after we navigate. If we don't see OBGeminiDebugger._attachedTabs list
  // our tab within this window, we proceed anyway — capture will either
  // happen or time out via CAPTURE_WAIT_TIMEOUT_MS.
  const ATTACH_WAIT_TIMEOUT_MS = 2000;
  const ATTACH_POLL_INTERVAL_MS = 100;

  // Sidebar enumeration: how long to scroll the sidebar for and how many
  // scrolls to perform before giving up.
  const ENUMERATE_SCROLL_STEPS = 60;
  const ENUMERATE_SCROLL_PAUSE_MS = 250;

  // Heartbeat stale threshold — if we see a record in state=syncing whose
  // heartbeat is older than this, we assume the previous SW died
  // mid-conversation and the user may want to resume manually.
  const STALE_HEARTBEAT_MS = 5 * 60 * 1000;

  // Anti-bot throttle. An earlier experiment with a uniform 4s cadence
  // triggered Google's bot challenge around conversation 21. Mitigations:
  //   - Longer base interval (8s average)
  //   - Randomized jitter (4-12s range) with full-float precision so delays
  //     never cluster on whole-second ticks (a classic bot signature)
  //   - Periodic "reading pauses" every N conversations to break cadence
  const THROTTLE_MIN_MS = 4000;
  const THROTTLE_MAX_MS = 12000;
  const READING_PAUSE_EVERY_N = 10;
  const READING_PAUSE_MIN_MS = 20000;
  const READING_PAUSE_MAX_MS = 35000;

  const LOG = (msg, ...rest) => console.log(`[OB Gemini SYNC] ${msg}`, ...rest);
  const ERR = (msg, ...rest) => console.error(`[OB Gemini SYNC] ${msg}`, ...rest);

  // Live waiter registry for notifyHistoryCaptured. Created lazily because
  // OBGeminiSyncState may not yet be on the global when this IIFE runs;
  // we access it via `getStateModule()` below.
  let waiters = null;

  // In-memory flag to short-circuit the main loop when cancel was requested.
  // Also mirrored into persisted state for resume-after-wake behavior.
  let cancelRequested = false;

  // Guards against concurrent startSync invocations from the popup.
  let syncInFlight = false;

  // ---------------------------------------------------------------------------
  // Lazy accessor for the state helper module
  // ---------------------------------------------------------------------------

  function getStateModule() {
    const mod = self.OBGeminiSyncState;
    if (!mod) {
      throw new Error('OBGeminiSyncState module not loaded');
    }
    return mod;
  }

  function getWaiters() {
    if (!waiters) waiters = getStateModule().createWaiterRegistry();
    return waiters;
  }

  // ---------------------------------------------------------------------------
  // Persistence
  // ---------------------------------------------------------------------------

  async function loadState() {
    try {
      const stored = await chrome.storage.local.get({ [STATE_STORAGE_KEY]: null });
      const raw = stored[STATE_STORAGE_KEY];
      if (!raw || typeof raw !== 'object') {
        return getStateModule().createInitialState();
      }
      // Defensive merge — guarantees shape even if stored record is from
      // an older extension version.
      const fresh = getStateModule().createInitialState();
      const merged = {
        ...fresh,
        ...raw,
        totals: { ...fresh.totals, ...(raw.totals || {}) },
        pendingIds: Array.isArray(raw.pendingIds) ? raw.pendingIds : [],
        completedIds: Array.isArray(raw.completedIds) ? raw.completedIds : [],
        failedIds: Array.isArray(raw.failedIds) ? raw.failedIds : []
      };
      return merged;
    } catch (err) {
      ERR('loadState failed — returning initial:', err?.message || err);
      return getStateModule().createInitialState();
    }
  }

  async function saveState(record) {
    try {
      await chrome.storage.local.set({ [STATE_STORAGE_KEY]: record });
    } catch (err) {
      ERR('saveState failed:', err?.message || err);
    }
  }

  async function updateState(mutator) {
    const record = await loadState();
    const next = mutator(record) || record;
    await saveState(next);
    return next;
  }

  // ---------------------------------------------------------------------------
  // Sidebar enumeration — runs in the page via chrome.scripting.executeScript
  // ---------------------------------------------------------------------------

  /**
   * Page-context function. Scrolls the sidebar conversation list and returns
   * every conversation id it can find as hrefs of the form `/app/<id>`.
   *
   * Gemini's DOM changes frequently. We cast a wide net: any anchor whose
   * href matches /app/[a-z0-9]+ is treated as a conversation link. Duplicates
   * are collapsed.
   */
  function enumerateSidebar(scrollSteps, scrollPauseMs) {
    const isValidId = (id) => typeof id === 'string' && /^[a-z0-9]{8,}$/i.test(id);

    const collect = () => {
      const ids = new Set();
      const anchors = document.querySelectorAll('a[href*="/app/"]');
      for (const anchor of anchors) {
        const href = anchor.getAttribute('href') || '';
        const m = href.match(/\/app\/([a-z0-9]+)/i);
        if (m && isValidId(m[1])) ids.add(m[1]);
      }
      return ids;
    };

    // Find the most likely scroll container. Gemini's sidebar is typically
    // a `<nav>` or `<side-navigation>` element with an internal scrollable
    // div. We walk candidates in rough order of specificity.
    const scrollableCandidates = [];
    const pushIf = (el) => {
      if (!el) return;
      if (el.scrollHeight > el.clientHeight + 20) scrollableCandidates.push(el);
    };
    pushIf(document.querySelector('[data-test-id="conversations-list"]'));
    pushIf(document.querySelector('conversations-list'));
    pushIf(document.querySelector('side-navigation'));
    pushIf(document.querySelector('nav'));
    // Fallback: document.scrollingElement
    if (document.scrollingElement) scrollableCandidates.push(document.scrollingElement);

    return new Promise((resolve) => {
      const seen = new Set();
      let stepsLeft = Math.max(1, Number(scrollSteps) || 1);
      let noGrowthInARow = 0;
      const MAX_NO_GROWTH = 3;

      const tick = () => {
        const before = seen.size;
        for (const id of collect()) seen.add(id);
        const grew = seen.size > before;
        if (!grew) noGrowthInARow += 1; else noGrowthInARow = 0;

        if (stepsLeft <= 0 || noGrowthInARow >= MAX_NO_GROWTH) {
          resolve({ ids: Array.from(seen), scrolledFor: (scrollSteps - stepsLeft) });
          return;
        }

        for (const el of scrollableCandidates) {
          try { el.scrollTop = el.scrollHeight; } catch (_) { /* ignore */ }
        }
        stepsLeft -= 1;
        setTimeout(tick, Math.max(50, Number(scrollPauseMs) || 250));
      };

      tick();
    });
  }

  /**
   * Open a transient foreground-ish tab to list the sidebar, enumerate, then
   * close it. The tab is created inactive to avoid disrupting the user.
   */
  async function enumerateConversationsViaTab() {
    let tab = null;
    try {
      tab = await chrome.tabs.create({ url: GEMINI_APP_URL, active: false });
    } catch (err) {
      ERR('enumerate: failed to open tab:', err?.message || err);
      throw err;
    }

    try {
      await waitForTabComplete(tab.id);
      // Brief pause to let client-side rendering settle after 'complete'.
      await delay(600);

      let results;
      try {
        results = await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: enumerateSidebar,
          args: [ENUMERATE_SCROLL_STEPS, ENUMERATE_SCROLL_PAUSE_MS],
          world: 'MAIN'
        });
      } catch (err) {
        ERR('enumerate: executeScript failed:', err?.message || err);
        throw err;
      }

      // executeScript returns an array (one entry per frame). We only care
      // about the top frame, but if multiple frames return IDs we merge them.
      const merged = new Set();
      let scrolledFor = 0;
      for (const r of (Array.isArray(results) ? results : [])) {
        const value = r && r.result;
        if (!value || typeof value !== 'object') continue;
        if (Array.isArray(value.ids)) {
          for (const id of value.ids) {
            if (typeof id === 'string' && id.trim()) merged.add(id.trim());
          }
        }
        if (Number.isFinite(value.scrolledFor)) {
          scrolledFor = Math.max(scrolledFor, value.scrolledFor);
        }
      }

      const ids = Array.from(merged);
      LOG(`enumeration discovered ${ids.length} conversation id(s) (scrolledFor=${scrolledFor})`);
      return ids;
    } finally {
      if (tab && typeof tab.id === 'number') {
        try { await chrome.tabs.remove(tab.id); } catch (_err) { /* ignore */ }
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Tab lifecycle for the dedicated sync tab
  // ---------------------------------------------------------------------------

  async function ensureSyncTab(existingTabId) {
    if (typeof existingTabId === 'number') {
      try {
        const tab = await chrome.tabs.get(existingTabId);
        if (tab && typeof tab.id === 'number') return tab.id;
      } catch (_err) {
        // Tab gone; fall through to create a new one.
      }
    }
    try {
      const tab = await chrome.tabs.create({ url: GEMINI_APP_URL, active: false });
      return tab.id;
    } catch (err) {
      ERR('ensureSyncTab: failed to create sync tab:', err?.message || err);
      throw err;
    }
  }

  async function closeSyncTab(tabId) {
    if (typeof tabId !== 'number') return;
    try {
      await chrome.tabs.remove(tabId);
    } catch (_err) {
      // Already closed, ignore.
    }
  }

  function waitForTabComplete(tabId) {
    return new Promise((resolve, reject) => {
      if (typeof tabId !== 'number') {
        reject(new Error('waitForTabComplete: invalid tabId'));
        return;
      }

      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        try { chrome.tabs.onUpdated.removeListener(listener); } catch (_e) { /* ignore */ }
        reject(new Error('waitForTabComplete: timeout'));
      }, 30000);

      const listener = (updatedTabId, changeInfo) => {
        if (updatedTabId !== tabId) return;
        if (changeInfo.status !== 'complete') return;
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        try { chrome.tabs.onUpdated.removeListener(listener); } catch (_e) { /* ignore */ }
        resolve();
      };

      try {
        chrome.tabs.onUpdated.addListener(listener);
      } catch (err) {
        clearTimeout(timer);
        reject(err);
        return;
      }

      // Race: tab may already be 'complete' before we attached the listener.
      chrome.tabs.get(tabId).then((tab) => {
        if (tab && tab.status === 'complete' && !settled) {
          settled = true;
          clearTimeout(timer);
          try { chrome.tabs.onUpdated.removeListener(listener); } catch (_e) { /* ignore */ }
          resolve();
        }
      }).catch(() => {
        // Ignore — the listener path will either resolve or time out.
      });
    });
  }

  async function waitForDebuggerAttach(tabId) {
    const deadline = Date.now() + ATTACH_WAIT_TIMEOUT_MS;
    while (Date.now() < deadline) {
      const dbg = self.OBGeminiDebugger;
      if (dbg && dbg._attachedTabs && typeof dbg._attachedTabs.has === 'function') {
        if (dbg._attachedTabs.has(tabId)) return true;
      }
      await delay(ATTACH_POLL_INTERVAL_MS);
    }
    LOG(`attach wait timed out tab=${tabId} — proceeding anyway`);
    return false;
  }

  // ---------------------------------------------------------------------------
  // Per-conversation drive
  // ---------------------------------------------------------------------------

  async function driveConversation(syncTabId, conversationId) {
    const url = `${GEMINI_APP_URL}/${encodeURIComponent(conversationId)}`;
    LOG(`drive → ${conversationId}`);

    // Heartbeat before the nav so resume logic knows we're live.
    await updateState((rec) => {
      rec.lastHeartbeatAt = Date.now();
      rec.currentId = conversationId;
      return rec;
    });

    // Pre-register the waiter BEFORE navigating so there's no window where
    // Phase B fires before we're listening.
    const capturePromise = new Promise((resolve, reject) => {
      getWaiters().register(conversationId, {
        resolve: (result) => resolve(result),
        reject: (reason) => reject(reason)
      });
    });

    const timeoutHandle = setTimeout(() => {
      getWaiters().abort(
        conversationId,
        new Error(`capture timeout after ${CAPTURE_WAIT_TIMEOUT_MS}ms`)
      );
    }, CAPTURE_WAIT_TIMEOUT_MS);

    try {
      try {
        await chrome.tabs.update(syncTabId, { url, active: false });
      } catch (err) {
        throw new Error(`tabs.update failed: ${err?.message || err}`);
      }

      try {
        await waitForTabComplete(syncTabId);
      } catch (err) {
        throw new Error(`tab load wait failed: ${err?.message || err}`);
      }

      // Give the Phase B debugger a moment to re-attach to the tab after
      // the navigation (chrome.tabs.onUpdated handler in gemini-debugger.js
      // drives this). If it's not attached within the budget we proceed;
      // the page fetches its own history and Phase B will capture if it
      // can, else we'll time out.
      await waitForDebuggerAttach(syncTabId);

      // Wait for Phase B's notifyHistoryCaptured → resolves the promise.
      const result = await capturePromise;
      return result;
    } finally {
      clearTimeout(timeoutHandle);
      // If the promise was already settled, abort() is a no-op.
      getWaiters().abort(conversationId, new Error('drive cleanup'));
    }
  }

  // ---------------------------------------------------------------------------
  // Main loop
  // ---------------------------------------------------------------------------

  async function mainLoop() {
    const stateMod = getStateModule();

    while (true) {
      // Cancel check between every iteration.
      let record = await loadState();
      if (cancelRequested || record.state === stateMod.STATES.CANCELED) {
        LOG('cancel observed — breaking loop');
        break;
      }

      const pending = Array.isArray(record.pendingIds) ? record.pendingIds : [];
      if (pending.length === 0) {
        break;
      }

      // Health check BEFORE each navigation. Catches the case where the
      // sync tab has been redirected off Gemini (CAPTCHA challenge / login
      // prompt / etc.) — Phase B's tab-updated listener has already
      // detached the debugger in that case, so continuing would just
      // silently time out every remaining conversation. Instead: stop
      // gracefully, save state with a reason, let the user solve the
      // challenge and click Resume.
      const health = await checkSyncTabHealthy(record.syncTabId);
      if (!health.healthy) {
        LOG(`paused: ${health.reason}`);
        await updateState((rec) => {
          stateMod.transition(rec, stateMod.STATES.CANCELED);
          rec.lastError = `paused: ${health.reason}`;
          rec.canceledReason = health.reason;
          return rec;
        });
        break;
      }

      const conversationId = pending[0];

      try {
        const result = await driveConversation(record.syncTabId, conversationId);
        await updateState((rec) => stateMod.recordCompletion(rec, conversationId, result));
        LOG(`ok ${conversationId} captured=${result?.captured || 0} dedup=${result?.skippedDup || 0} other=${result?.other || 0} total=${result?.total || 0}`);
      } catch (err) {
        const reason = err?.message || String(err);
        ERR(`fail ${conversationId}: ${reason}`);
        await updateState((rec) => stateMod.recordFailure(rec, conversationId, reason));

        // If the failure was because the tab state is broken, pause now
        // instead of burning through the rest of the queue.
        const postHealth = await checkSyncTabHealthy(record.syncTabId);
        if (!postHealth.healthy) {
          LOG(`paused post-failure: ${postHealth.reason}`);
          await updateState((rec) => {
            stateMod.transition(rec, stateMod.STATES.CANCELED);
            rec.lastError = `paused: ${postHealth.reason}`;
            rec.canceledReason = postHealth.reason;
            return rec;
          });
          break;
        }
      }

      // Jittered throttle. Sub-millisecond precision avoids whole-second
      // clustering. Every N conversations, insert a longer "reading pause"
      // to further break the cadence.
      const after = await loadState();
      const completedSoFar = Array.isArray(after.completedIds) ? after.completedIds.length : 0;
      const failedSoFar = Array.isArray(after.failedIds) ? after.failedIds.length : 0;
      const processed = completedSoFar + failedSoFar;
      const longPause = processed > 0 && processed % READING_PAUSE_EVERY_N === 0;
      const throttleMs = longPause
        ? randomJitter(READING_PAUSE_MIN_MS, READING_PAUSE_MAX_MS)
        : randomJitter(THROTTLE_MIN_MS, THROTTLE_MAX_MS);
      LOG(`throttle ${throttleMs.toFixed(2)}ms${longPause ? ' (reading pause)' : ''}`);
      await delay(throttleMs);
    }
  }

  // ---------------------------------------------------------------------------
  // Public entry points
  // ---------------------------------------------------------------------------

  async function startSync(options) {
    if (syncInFlight) {
      return { ok: false, error: 'sync already running' };
    }
    syncInFlight = true;
    cancelRequested = false;

    const stateMod = getStateModule();
    const cap = options && Number.isFinite(Number(options.cap))
      ? Math.floor(Number(options.cap))
      : DEFAULT_CAP;

    try {
      // Transition: idle/done/canceled/failed → enumerating.
      await updateState((rec) => {
        const fresh = stateMod.resetToIdle(rec);
        stateMod.transition(fresh, stateMod.STATES.ENUMERATING);
        fresh.startedAt = Date.now();
        fresh.lastHeartbeatAt = Date.now();
        fresh.cap = cap;
        return fresh;
      });

      LOG('start: enumerating sidebar...');
      let discoveredIds = [];
      try {
        discoveredIds = await enumerateConversationsViaTab();
      } catch (err) {
        const reason = err?.message || String(err);
        ERR('enumeration failed:', reason);
        await updateState((rec) => {
          stateMod.transition(rec, stateMod.STATES.FAILED);
          rec.lastError = `enumeration failed: ${reason}`;
          return rec;
        });
        return { ok: false, error: `enumeration failed: ${reason}` };
      }

      if (!Array.isArray(discoveredIds) || discoveredIds.length === 0) {
        LOG('no conversations found — marking done');
        await updateState((rec) => {
          stateMod.transition(rec, stateMod.STATES.DONE);
          rec.lastSyncAt = new Date().toISOString();
          return rec;
        });
        return { ok: true, total: 0 };
      }

      const syncTabId = await ensureSyncTab(null);

      await updateState((rec) => {
        stateMod.mergePendingIds(rec, discoveredIds, cap);
        stateMod.transition(rec, stateMod.STATES.SYNCING);
        rec.syncTabId = syncTabId;
        rec.lastHeartbeatAt = Date.now();
        return rec;
      });

      LOG(`syncing ${discoveredIds.length} conversation(s) via tab=${syncTabId}`);
      await mainLoop();

      // Loop exited — either pending drained, user canceled, or an error
      // short-circuited it.
      const final = await loadState();
      if (cancelRequested || final.state === stateMod.STATES.CANCELED) {
        await updateState((rec) => {
          stateMod.transition(rec, stateMod.STATES.CANCELED);
          rec.lastError = rec.lastError || 'user canceled';
          return rec;
        });
        await closeSyncTab(final.syncTabId);
        return { ok: true, canceled: true };
      }

      const complete = await updateState((rec) => {
        stateMod.transition(rec, stateMod.STATES.DONE);
        rec.lastSyncAt = new Date().toISOString();
        return rec;
      });

      await closeSyncTab(complete.syncTabId);
      const summary = stateMod.summarizeProgress(complete);
      LOG(`done — completed=${summary.completed} failed=${summary.failed} captured=${summary.totals.captured} dedup=${summary.totals.skippedDup}`);
      return { ok: true, ...summary };
    } catch (err) {
      const reason = err?.message || String(err);
      ERR('startSync threw:', reason);
      await updateState((rec) => {
        stateMod.transition(rec, stateMod.STATES.FAILED);
        rec.lastError = reason;
        return rec;
      });
      const failedState = await loadState();
      await closeSyncTab(failedState.syncTabId);
      return { ok: false, error: reason };
    } finally {
      // Abort any dangling waiters so callers of driveConversation can't
      // hang past the end of a sync run.
      try { getWaiters().abortAll(new Error('sync ended')); } catch (_err) { /* ignore */ }
      syncInFlight = false;
    }
  }

  /**
   * Incremental/auto-sync. Enumerates sidebar, filters against lifetime
   * everSyncedIds (so already-captured conversations are skipped entirely),
   * and navigates only the delta. Safe for scheduled use.
   *
   * Options: { cap, trigger } where trigger is 'manual' | 'alarm' for
   * diagnostics only.
   */
  async function syncIncremental(options) {
    if (syncInFlight) {
      return { ok: false, error: 'sync already running' };
    }
    syncInFlight = true;
    cancelRequested = false;

    const stateMod = getStateModule();
    const cap = options && Number.isFinite(Number(options.cap))
      ? Math.floor(Number(options.cap))
      : DEFAULT_AUTO_CAP;
    const trigger = (options && options.trigger) || 'manual';

    try {
      // Transition to enumerating, preserving lifetime state via resetToIdle.
      await updateState((rec) => {
        const fresh = stateMod.resetToIdle(rec);
        stateMod.transition(fresh, stateMod.STATES.ENUMERATING);
        fresh.startedAt = Date.now();
        fresh.lastHeartbeatAt = Date.now();
        fresh.cap = cap;
        return fresh;
      });

      LOG(`incremental (${trigger}): enumerating sidebar...`);
      let discoveredIds = [];
      try {
        discoveredIds = await enumerateConversationsViaTab();
      } catch (err) {
        const reason = err?.message || String(err);
        ERR('incremental enumeration failed:', reason);
        await updateState((rec) => {
          stateMod.transition(rec, stateMod.STATES.FAILED);
          rec.lastError = `incremental enumeration failed: ${reason}`;
          return rec;
        });
        return { ok: false, error: `enumeration failed: ${reason}` };
      }

      const pre = await loadState();
      const newIds = stateMod.filterToNewIds(pre, discoveredIds, cap);
      LOG(`incremental: discovered=${discoveredIds.length} new=${newIds.length} (cap=${cap})`);

      if (newIds.length === 0) {
        await updateState((rec) => {
          stateMod.transition(rec, stateMod.STATES.DONE);
          rec.lastSyncAt = new Date().toISOString();
          rec.lastAutoSyncAt = new Date().toISOString();
          return rec;
        });
        // Close the sync tab if the enumerate step opened one and we
        // didn't navigate anywhere — otherwise it stays parked harmlessly.
        const after = await loadState();
        await closeSyncTab(after.syncTabId);
        return { ok: true, total: 0, message: 'nothing new' };
      }

      const syncTabId = await ensureSyncTab(null);
      await updateState((rec) => {
        stateMod.mergePendingIds(rec, newIds, cap);
        stateMod.transition(rec, stateMod.STATES.SYNCING);
        rec.syncTabId = syncTabId;
        rec.lastHeartbeatAt = Date.now();
        return rec;
      });

      LOG(`incremental syncing ${newIds.length} new conversation(s) via tab=${syncTabId}`);
      await mainLoop();

      const final = await loadState();
      if (cancelRequested || final.state === stateMod.STATES.CANCELED) {
        // Paused (e.g., Google challenge). Leave state as CANCELED so the
        // user can click Resume; don't auto-retry from the alarm since
        // that'd just re-trigger the challenge.
        await closeSyncTab(final.syncTabId);
        return { ok: true, canceled: true };
      }

      const complete = await updateState((rec) => {
        stateMod.transition(rec, stateMod.STATES.DONE);
        rec.lastSyncAt = new Date().toISOString();
        rec.lastAutoSyncAt = new Date().toISOString();
        return rec;
      });
      await closeSyncTab(complete.syncTabId);
      const summary = stateMod.summarizeProgress(complete);
      LOG(`incremental done — completed=${summary.completed} failed=${summary.failed} captured=${summary.totals.captured}`);
      return { ok: true, ...summary };
    } catch (err) {
      const reason = err?.message || String(err);
      ERR('syncIncremental threw:', reason);
      await updateState((rec) => {
        stateMod.transition(rec, stateMod.STATES.FAILED);
        rec.lastError = reason;
        return rec;
      });
      const failedState = await loadState();
      await closeSyncTab(failedState.syncTabId);
      return { ok: false, error: reason };
    } finally {
      try { getWaiters().abortAll(new Error('incremental ended')); } catch (_err) { /* ignore */ }
      syncInFlight = false;
    }
  }

  /**
   * Update the persisted auto-sync settings. Returns the new settings.
   * Caller (service-worker.js) manages the alarm lifecycle based on this.
   */
  async function setAutoSync(enabled, intervalMinutes) {
    const nextEnabled = Boolean(enabled);
    const nextInterval = (Number.isFinite(Number(intervalMinutes)) && Number(intervalMinutes) > 0)
      ? Number(intervalMinutes)
      : null;
    const updated = await updateState((rec) => {
      rec.autoSyncEnabled = nextEnabled;
      if (nextInterval !== null) rec.autoSyncIntervalMinutes = nextInterval;
      return rec;
    });
    LOG(`auto-sync ${nextEnabled ? 'enabled' : 'disabled'} interval=${updated.autoSyncIntervalMinutes}min`);
    return {
      ok: true,
      autoSyncEnabled: updated.autoSyncEnabled,
      autoSyncIntervalMinutes: updated.autoSyncIntervalMinutes
    };
  }

  async function cancelSync() {
    cancelRequested = true;
    const stateMod = getStateModule();
    const record = await loadState();
    if (record.state !== stateMod.STATES.ENUMERATING && record.state !== stateMod.STATES.SYNCING) {
      return { ok: true, status: record.state };
    }
    LOG('cancel requested');
    // Flip state early so the popup reflects it even before the main loop ticks.
    await updateState((rec) => {
      stateMod.transition(rec, stateMod.STATES.CANCELED);
      return rec;
    });
    // Abort any in-flight waiter so driveConversation resolves and the loop
    // exits promptly.
    try { getWaiters().abortAll(new Error('canceled')); } catch (_err) { /* ignore */ }
    return { ok: true };
  }

  async function getStatus() {
    const stateMod = getStateModule();
    const record = await loadState();
    const summary = stateMod.summarizeProgress(record);
    return {
      ok: true,
      status: summary
    };
  }

  /**
   * Resume a previously-paused run. Distinct from startSync (which resets
   * and re-enumerates) and resumeIfInterrupted (which only fires on SW wake
   * for SYNCING state). Used when the run hit a Google challenge and we
   * transitioned to CANCELED with pendingIds still queued — after the user
   * solves the CAPTCHA they click Resume in the popup.
   */
  async function resumeSync() {
    if (syncInFlight) {
      return { ok: false, error: 'sync already running' };
    }
    const stateMod = getStateModule();
    const record = await loadState();
    const pending = Array.isArray(record.pendingIds) ? record.pendingIds : [];
    if (pending.length === 0) {
      return { ok: false, error: 'nothing to resume (no pending ids)' };
    }

    syncInFlight = true;
    cancelRequested = false;
    try {
      LOG(`resume: ${pending.length} pending conversation(s)`);
      const syncTabId = await ensureSyncTab(record.syncTabId);
      await updateState((rec) => {
        rec.syncTabId = syncTabId;
        rec.lastHeartbeatAt = Date.now();
        rec.lastError = '';
        rec.canceledReason = '';
        stateMod.transition(rec, stateMod.STATES.SYNCING);
        return rec;
      });
      await mainLoop();

      const final = await loadState();
      if (!cancelRequested && final.state === stateMod.STATES.SYNCING) {
        await updateState((rec) => {
          stateMod.transition(rec, stateMod.STATES.DONE);
          rec.lastSyncAt = new Date().toISOString();
          return rec;
        });
        await closeSyncTab(final.syncTabId);
      }
      return { ok: true };
    } catch (err) {
      ERR('resume failed:', err?.message || err);
      await updateState((rec) => {
        stateMod.transition(rec, stateMod.STATES.FAILED);
        rec.lastError = `resume failed: ${err?.message || err}`;
        return rec;
      });
      return { ok: false, error: err?.message || String(err) };
    } finally {
      try { getWaiters().abortAll(new Error('resume ended')); } catch (_err) { /* ignore */ }
      syncInFlight = false;
    }
  }

  /**
   * Phase B (gemini-debugger.js) calls this at the end of
   * `routeHistoryThroughCapturePipeline` with the per-conversation totals.
   * Resolves the matching waiter if one is pending.
   */
  function notifyHistoryCaptured(conversationId, result) {
    if (typeof conversationId !== 'string' || !conversationId) return false;
    try {
      return getWaiters().notify(conversationId, result || {});
    } catch (err) {
      ERR('notifyHistoryCaptured failed:', err?.message || err);
      return false;
    }
  }

  // ---------------------------------------------------------------------------
  // Resume-on-wake
  // ---------------------------------------------------------------------------

  async function resumeIfInterrupted() {
    const stateMod = getStateModule();
    const record = await loadState();

    if (record.state !== stateMod.STATES.SYNCING && record.state !== stateMod.STATES.ENUMERATING) {
      return;
    }

    const lastBeat = Number(record.lastHeartbeatAt) || 0;
    const age = Date.now() - lastBeat;

    if (!lastBeat || age > STALE_HEARTBEAT_MS) {
      LOG(`stale state detected (age=${age}ms) — resetting to idle`);
      await updateState((rec) => {
        const fresh = stateMod.resetToIdle(rec);
        fresh.lastError = 'interrupted by service worker restart';
        return fresh;
      });
      return;
    }

    LOG(`warm state detected (age=${age}ms) — resuming sync with ${record.pendingIds.length} pending`);
    // The previous SW's tab may or may not still exist; ensureSyncTab handles
    // both. We skip re-enumeration on resume to avoid re-adding completed IDs
    // (they'd be filtered by mergePendingIds anyway, but the extra work is
    // wasteful).
    syncInFlight = true;
    cancelRequested = false;
    try {
      const syncTabId = await ensureSyncTab(record.syncTabId);
      await updateState((rec) => {
        rec.syncTabId = syncTabId;
        rec.lastHeartbeatAt = Date.now();
        // If we were in 'enumerating' we failed before the transition to
        // 'syncing' — treat the pending list as the truth and go straight in.
        if (rec.state === stateMod.STATES.ENUMERATING) {
          stateMod.transition(rec, stateMod.STATES.SYNCING);
        }
        return rec;
      });
      await mainLoop();

      const final = await loadState();
      if (!cancelRequested && final.state === stateMod.STATES.SYNCING) {
        await updateState((rec) => {
          stateMod.transition(rec, stateMod.STATES.DONE);
          rec.lastSyncAt = new Date().toISOString();
          return rec;
        });
      }
      await closeSyncTab(final.syncTabId);
    } catch (err) {
      ERR('resume failed:', err?.message || err);
      await updateState((rec) => {
        stateMod.transition(rec, stateMod.STATES.FAILED);
        rec.lastError = `resume failed: ${err?.message || err}`;
        return rec;
      });
    } finally {
      try { getWaiters().abortAll(new Error('resume ended')); } catch (_err) { /* ignore */ }
      syncInFlight = false;
    }
  }

  // ---------------------------------------------------------------------------
  // Utilities
  // ---------------------------------------------------------------------------

  function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, Math.max(0, Number(ms) || 0)));
  }

  // Returns a float in [minMs, maxMs). Math.random() produces IEEE double
  // precision (~15 decimal digits), so the result is sub-millisecond jittered
  // — no whole-second cluster that a bot detector could fingerprint.
  function randomJitter(minMs, maxMs) {
    const lo = Number(minMs) || 0;
    const hi = Math.max(lo, Number(maxMs) || 0);
    return lo + Math.random() * (hi - lo);
  }

  // Checks whether the sync tab is in a healthy state for the next nav.
  // Unhealthy signals:
  //   - Tab no longer exists (user closed it, or Chrome killed it)
  //   - Tab URL navigated off gemini.google.com (CAPTCHA, login prompt, ...)
  //   - Phase B's debugger isn't attached to our sync tab
  //
  // Returns { healthy: boolean, reason?: string }.
  async function checkSyncTabHealthy(syncTabId) {
    if (typeof syncTabId !== 'number') {
      return { healthy: false, reason: 'sync tab id missing' };
    }
    let tab;
    try {
      tab = await chrome.tabs.get(syncTabId);
    } catch (err) {
      return { healthy: false, reason: `sync tab gone (${err?.message || 'tabs.get failed'})` };
    }
    const url = typeof tab?.url === 'string' ? tab.url : '';
    if (!url.startsWith('https://gemini.google.com/')) {
      let host = '(empty)';
      try {
        host = url ? new URL(url).host : '(empty)';
      } catch (_e) {
        host = '(unparseable)';
      }
      return {
        healthy: false,
        reason: `sync tab navigated away (${host}) — likely Google challenge`
      };
    }
    const attachedTabs = self.OBGeminiDebugger && self.OBGeminiDebugger._attachedTabs;
    if (attachedTabs && typeof attachedTabs.has === 'function' && !attachedTabs.has(syncTabId)) {
      return { healthy: false, reason: 'debugger not attached to sync tab' };
    }
    return { healthy: true };
  }

  // ---------------------------------------------------------------------------
  // Wire exports and kick the resume check
  // ---------------------------------------------------------------------------

  self.OBGeminiSync = {
    startSync,
    syncIncremental,
    setAutoSync,
    cancelSync,
    resumeSync,
    getStatus,
    notifyHistoryCaptured,
    // Internals for diagnostics.
    STATE_STORAGE_KEY,
    DEFAULT_CAP,
    DEFAULT_AUTO_CAP,
    CAPTURE_WAIT_TIMEOUT_MS,
    ATTACH_WAIT_TIMEOUT_MS,
    STALE_HEARTBEAT_MS,
    THROTTLE_MIN_MS,
    THROTTLE_MAX_MS,
    _loadState: loadState,
    _saveState: saveState,
    _checkSyncTabHealthy: checkSyncTabHealthy,
    _randomJitter: randomJitter
  };

  // Resume-on-wake. Fire and forget; errors already logged in the function.
  resumeIfInterrupted().catch((err) => ERR('resumeIfInterrupted threw:', err?.message || err));
})();
