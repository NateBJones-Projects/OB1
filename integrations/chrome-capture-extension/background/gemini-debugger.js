/**
 * Open Brain Capture — Gemini durable history capture via chrome.debugger
 *
 * Phase B: attach chrome.debugger to https://gemini.google.com/* tabs, watch
 * for the batchexecute `rpcids=hNvQHb` request/response (Gemini's internal
 * conversation-history loader), pair the request+response so MV3 service-
 * worker suspensions don't lose state mid-response, fetch the response body
 * on loadingFinished, and funnel extracted turns through
 * `processCaptureRequest`.
 *
 * What this file does NOT do:
 *   - It does NOT observe StreamGenerate (the live per-turn stream). That
 *     path would be ambient capture, which the extension deliberately
 *     dropped in the initial public release (see service-worker.js notes).
 *     Only Phase B's history-load path ships here, and it only fires when
 *     the user (or the Sync All orchestrator on their behalf) opens a
 *     conversation.
 *
 * Coordination with the sync orchestrator:
 *   - When Phase C's gemini-sync.js drives a bulk backfill it navigates a
 *     hidden tab to `/app/<conversationId>` and waits on a per-conversation
 *     waiter. The page loads the conversation by firing the hNvQHb RPC; we
 *     observe the response here, funnel every turn through the capture
 *     pipeline (retry queue, sensitivity filter, fingerprint dedup), and
 *     then ping `OBGeminiSync.notifyHistoryCaptured(conversationId, totals)`
 *     so the orchestrator's waiter resolves and it can drive the next
 *     conversation.
 *
 * Respects the user's Gemini toggle: if the user disables Gemini capture in
 * the popup settings, this module detaches from all tabs and stops listening
 * until re-enabled. No probes, no telemetry, no third-party hosts.
 */

/* global chrome, OBConfig */

(function () {
  'use strict';

  // Phase B: conversation history is loaded via a batchexecute RPC.
  // `rpcids=hNvQHb` is the history-load variant, confirmed via the Gemini
  // network research referenced in the README. Other batchexecute rpcids
  // (MaZiqc, ESY5D, L5adhe, etc.) handle sidebar/settings/status and are
  // ignored by the URL guard below.
  const BATCHEXECUTE_PATH = 'batchexecute';
  const HISTORY_RPCID = 'hNvQHb';
  const DEBUGGER_PROTOCOL_VERSION = '1.3';
  const REQUEST_STASH_TTL_MS = 120 * 1000;
  const GEMINI_URL_PATTERN = 'https://gemini.google.com/';

  // chrome.storage.session key prefix for the pending-request stash.
  // Full key: `${STASH_KEY_PREFIX}${tabId}:${requestId}`.
  const STASH_KEY_PREFIX = 'ob_gemini_stash_';

  // chrome.storage.local key the popup reads to show the paused indicator.
  const PAUSED_STATE_KEY = 'ob_gemini_paused';

  // In-memory mirror of the persisted stash for speed. Canonical copy lives
  // in chrome.storage.session; this map is always re-derivable from there.
  const pendingRequests = new Map();

  const attachedTabs = new Set();
  let capturePausedByUser = false;
  let geminiEnabled = true;
  let initialized = false;

  const LOG = (msg, ...rest) => console.log(`[OB Gemini] ${msg}`, ...rest);
  const ERR = (msg, ...rest) => console.error(`[OB Gemini] ${msg}`, ...rest);

  function isHistoryUrl(url) {
    return typeof url === 'string'
      && url.includes(BATCHEXECUTE_PATH)
      && url.includes(`rpcids=${HISTORY_RPCID}`);
  }

  // ---------------------------------------------------------------------------
  // Stash — chrome.storage.session-backed, in-memory mirrored
  // ---------------------------------------------------------------------------

  function stashKey(tabId, requestId) {
    return `${STASH_KEY_PREFIX}${tabId}:${requestId}`;
  }

  async function stashSet(tabId, requestId, entry) {
    const key = stashKey(tabId, requestId);
    pendingRequests.set(key, entry);
    try {
      await chrome.storage.session.set({ [key]: entry });
    } catch (err) {
      ERR(`stashSet failed key=${key}:`, err?.message || err);
    }
  }

  async function stashDelete(tabId, requestId) {
    const key = stashKey(tabId, requestId);
    pendingRequests.delete(key);
    try {
      await chrome.storage.session.remove(key);
    } catch (err) {
      ERR(`stashDelete failed key=${key}:`, err?.message || err);
    }
  }

  function stashGet(tabId, requestId) {
    const entry = pendingRequests.get(stashKey(tabId, requestId));
    if (!entry) return null;
    if (Date.now() - entry.startedAt > REQUEST_STASH_TTL_MS) return null;
    return entry;
  }

  async function stashRehydrate() {
    try {
      const all = await chrome.storage.session.get(null);
      const now = Date.now();
      const expired = [];
      let live = 0;
      for (const [key, value] of Object.entries(all)) {
        if (!key.startsWith(STASH_KEY_PREFIX)) continue;
        if (!value || typeof value !== 'object' || typeof value.startedAt !== 'number') {
          expired.push(key);
          continue;
        }
        if (now - value.startedAt > REQUEST_STASH_TTL_MS) {
          expired.push(key);
          continue;
        }
        pendingRequests.set(key, value);
        live += 1;
      }
      if (expired.length) {
        await chrome.storage.session.remove(expired);
      }
      LOG(`stash rehydrate live=${live} expired=${expired.length}`);
    } catch (err) {
      ERR('stashRehydrate failed:', err?.message || err);
    }
  }

  async function stashDropForTab(tabId) {
    const prefix = `${STASH_KEY_PREFIX}${tabId}:`;
    const keys = [];
    for (const key of pendingRequests.keys()) {
      if (key.startsWith(prefix)) keys.push(key);
    }
    if (!keys.length) return;
    for (const key of keys) pendingRequests.delete(key);
    try {
      await chrome.storage.session.remove(keys);
    } catch (err) {
      ERR(`stashDropForTab failed tab=${tabId}:`, err?.message || err);
    }
  }

  // ---------------------------------------------------------------------------
  // Paused-state flag — persisted for the popup
  // ---------------------------------------------------------------------------

  async function setPausedByUser(paused) {
    capturePausedByUser = Boolean(paused);
    try {
      await chrome.storage.local.set({ [PAUSED_STATE_KEY]: capturePausedByUser });
    } catch (err) {
      ERR('setPausedByUser failed:', err?.message || err);
    }
  }

  function isCapturePausedByUser() {
    return capturePausedByUser;
  }

  // ---------------------------------------------------------------------------
  // Settings — read Gemini toggle from user config
  // ---------------------------------------------------------------------------

  async function readGeminiEnabled() {
    try {
      const config = await OBConfig.getConfig();
      return config?.enabledPlatforms?.gemini !== false;
    } catch (err) {
      ERR('readGeminiEnabled failed — defaulting to enabled:', err?.message || err);
      return true;
    }
  }

  async function applyEnabledState(nextEnabled) {
    const prevEnabled = geminiEnabled;
    geminiEnabled = Boolean(nextEnabled);

    if (geminiEnabled && !prevEnabled) {
      LOG('gemini capture enabled — attaching to open tabs');
      await attachToOpenGeminiTabs();
    } else if (!geminiEnabled && prevEnabled) {
      LOG('gemini capture disabled — detaching all tabs');
      await detachFromAllTabs();
    }
  }

  // ---------------------------------------------------------------------------
  // Attach lifecycle
  // ---------------------------------------------------------------------------

  async function attachToGeminiTab(tabId) {
    if (!geminiEnabled) return;
    if (attachedTabs.has(tabId)) return;
    try {
      await chrome.debugger.attach({ tabId }, DEBUGGER_PROTOCOL_VERSION);
      await chrome.debugger.sendCommand({ tabId }, 'Network.enable', {});
      attachedTabs.add(tabId);
      LOG(`attached tab=${tabId}`);
      // A successful attach clears any prior "user canceled" paused state.
      if (capturePausedByUser) await setPausedByUser(false);
    } catch (err) {
      ERR(`attach failed tab=${tabId}:`, err?.message || String(err));
    }
  }

  async function detachFromTab(tabId) {
    if (!attachedTabs.has(tabId)) {
      await stashDropForTab(tabId);
      return;
    }
    try {
      await chrome.debugger.detach({ tabId });
      LOG(`detached tab=${tabId}`);
    } catch (err) {
      // detach often fails if the tab is already closed; not fatal
      ERR(`detach failed tab=${tabId}:`, err?.message || String(err));
    }
    attachedTabs.delete(tabId);
    await stashDropForTab(tabId);
  }

  async function attachToOpenGeminiTabs() {
    try {
      const tabs = await chrome.tabs.query({ url: 'https://gemini.google.com/*' });
      LOG(`startup scan: ${tabs.length} Gemini tab(s) open`);
      for (const tab of tabs) {
        if (typeof tab.id === 'number') await attachToGeminiTab(tab.id);
      }
    } catch (err) {
      ERR('attachToOpenGeminiTabs failed:', err?.message || err);
    }
  }

  async function detachFromAllTabs() {
    const snapshot = Array.from(attachedTabs);
    for (const tabId of snapshot) await detachFromTab(tabId);
  }

  // ---------------------------------------------------------------------------
  // Event wiring
  // ---------------------------------------------------------------------------

  function wireTabListeners() {
    chrome.tabs.onUpdated.addListener(async (tabId, changeInfo) => {
      if (typeof changeInfo.url !== 'string') return;
      if (changeInfo.url.startsWith(GEMINI_URL_PATTERN)) {
        await attachToGeminiTab(tabId);
      } else if (attachedTabs.has(tabId)) {
        await detachFromTab(tabId);
      }
    });

    chrome.tabs.onRemoved.addListener(async (tabId) => {
      if (attachedTabs.has(tabId)) {
        await detachFromTab(tabId);
      } else {
        await stashDropForTab(tabId);
      }
    });
  }

  function wireDebuggerListeners() {
    chrome.debugger.onDetach.addListener(async (source, reason) => {
      const tabId = source.tabId;
      if (typeof tabId !== 'number') return;
      LOG(`onDetach tab=${tabId} reason=${reason}`);
      attachedTabs.delete(tabId);
      await stashDropForTab(tabId);
      if (reason === 'canceled_by_user') {
        await setPausedByUser(true);
      }
    });

    chrome.debugger.onEvent.addListener((source, method, params) => {
      const tabId = source.tabId;
      if (typeof tabId !== 'number' || !attachedTabs.has(tabId)) return;

      if (method === 'Network.requestWillBeSent') {
        handleRequestWillBeSent(tabId, params).catch((err) =>
          ERR(`requestWillBeSent handler failed tab=${tabId}:`, err?.message || err)
        );
      } else if (method === 'Network.loadingFinished') {
        handleLoadingFinished(tabId, params).catch((err) =>
          ERR(`loadingFinished handler failed tab=${tabId}:`, err?.message || err)
        );
      }
    });
  }

  function wireSettingsListener() {
    // OBConfig stores non-secret platform toggles in chrome.storage.sync under
    // STORAGE_KEYS.settings (and falls back to chrome.storage.local if sync
    // is unavailable). Watch both so enabling/disabling Gemini capture takes
    // effect regardless of which area currently holds the settings blob.
    const settingsKey = OBConfig.STORAGE_KEYS.settings;
    chrome.storage.onChanged.addListener(async (changes, areaName) => {
      if (areaName !== 'sync' && areaName !== 'local') return;
      if (!(settingsKey in changes)) return;
      const next = await readGeminiEnabled();
      await applyEnabledState(next);
    });
  }

  // ---------------------------------------------------------------------------
  // Request/response handlers
  // ---------------------------------------------------------------------------

  async function handleRequestWillBeSent(tabId, params) {
    const url = params?.request?.url ?? '';
    const requestId = params.requestId;

    // Phase B: history load for a conversation the user (or the sync
    // orchestrator) opened. The request body isn't needed — the user prompts
    // and assistant turns are all embedded in the response body.
    if (isHistoryUrl(url)) {
      const entry = {
        tabId,
        requestId,
        url,
        kind: 'history',
        startedAt: Date.now()
      };
      await stashSet(tabId, requestId, entry);
      LOG(`requestWillBeSent tab=${tabId} requestId=${requestId} kind=history`);
      return;
    }

    // Not a URL we care about.
  }

  async function handleLoadingFinished(tabId, params) {
    const requestId = params.requestId;
    const entry = stashGet(tabId, requestId);
    if (!entry) return;

    const elapsed = Date.now() - entry.startedAt;
    LOG(`loadingFinished tab=${tabId} requestId=${requestId} kind=${entry.kind || 'unknown'} elapsed=${elapsed}ms`);

    let body = null;
    try {
      const result = await chrome.debugger.sendCommand(
        { tabId },
        'Network.getResponseBody',
        { requestId }
      );
      body = typeof result?.body === 'string' ? result.body : null;
      const bodyLen = body ? body.length : 0;
      LOG(`body received tab=${tabId} length=${bodyLen} base64=${Boolean(result?.base64Encoded)}`);
    } catch (err) {
      ERR(`getResponseBody failed tab=${tabId} requestId=${requestId}:`, err?.message || err);
      await stashDelete(tabId, requestId);
      return;
    }

    // Phase B is the only request kind we handle here.
    if (entry.kind === 'history') {
      try {
        await routeHistoryThroughCapturePipeline({ tabId, requestId, responseBody: body });
      } finally {
        await stashDelete(tabId, requestId);
      }
      return;
    }

    // Unknown kind — drop defensively.
    await stashDelete(tabId, requestId);
  }

  async function routeHistoryThroughCapturePipeline({ tabId, requestId, responseBody }) {
    const extractor = self.OBGeminiHistoryExtractor;
    if (!extractor || typeof extractor.extractGeminiHistory !== 'function') {
      ERR(`OBGeminiHistoryExtractor unavailable — dropping tab=${tabId} requestId=${requestId}`);
      return;
    }

    const turns = extractor.extractGeminiHistory({ responseBody });
    if (!Array.isArray(turns) || turns.length === 0) {
      LOG(`history extractor returned empty tab=${tabId} requestId=${requestId} — dropping`);
      return;
    }

    const captureHandler = self.processCaptureRequest;
    if (typeof captureHandler !== 'function') {
      ERR(`processCaptureRequest unavailable in SW scope — dropping tab=${tabId} requestId=${requestId}`);
      return;
    }

    // Loop the turns serially to keep the ingest pipeline's retry queue,
    // sensitivity filter, and fingerprint dedup operating predictably per
    // turn. Fingerprint dedup guarantees that re-opening the same
    // conversation does NOT produce duplicate thoughts; each turn either
    // ingests new or returns 'duplicate_fingerprint' / 'existing'.
    LOG(`history load tab=${tabId} requestId=${requestId} turns=${turns.length}`);

    let captured = 0;
    let skippedDup = 0;
    let other = 0;

    for (const turn of turns) {
      const combinedText = `User: ${turn.userPrompt}\n\nAssistant: ${turn.assistantText}`;
      try {
        const result = await captureHandler({
          platform: 'gemini',
          captureMode: 'sync',
          text: combinedText,
          sourceMetadata: {
            gemini_conversation_id: turn.conversationId,
            gemini_response_id: turn.responseId,
            gemini_candidate_id: turn.candidateId,
            gemini_language: turn.language,
            gemini_model: turn.model,
            gemini_user_prompt: turn.userPrompt,
            gemini_assistant_text: turn.assistantText,
            gemini_captured_at: turn.capturedAt,
            gemini_history_order: turn.historyOrder,
            gemini_capture_kind: 'history'
          },
          assistantLength: turn.assistantText.length,
          preview: turn.assistantText
        });

        const status = result?.status || 'unknown';
        if (status === 'duplicate_fingerprint' || status === 'existing') {
          skippedDup += 1;
        } else if (status === 'complete' || status === 'captured' || status === 'inserted') {
          captured += 1;
        } else {
          other += 1;
          LOG(`history turn[${turn.historyOrder}] tab=${tabId} status=${status}`);
        }
      } catch (err) {
        other += 1;
        ERR(`history turn[${turn.historyOrder}] threw tab=${tabId}:`, err?.message || err);
      }
    }

    LOG(`history captured tab=${tabId} requestId=${requestId} captured=${captured} dedup=${skippedDup} other=${other} total=${turns.length}`);

    // Phase C hook: notify the sync orchestrator (if present) so it can
    // un-block its per-conversation waiter. Use the first turn's
    // conversation ID — all turns in a single hNvQHb response share it.
    //
    // The sync orchestrator keys its waiters by the BARE conversation hash
    // (derived from the /app/<hash> URL it navigates to). Our extractor
    // returns the PREFIXED form (c_<hash>) straight from Gemini's JSON.
    // Strip the prefix at the notify boundary so sync's Map lookup hits.
    // The stored metadata on the thought keeps the prefixed form — that's
    // canonical for retrieval. This normalization is sync-waiter-only.
    //
    // Silently no-ops when Phase C isn't loaded or no sync is in flight.
    const rawConversationId = turns[0]?.conversationId;
    const firstConversationId =
      typeof rawConversationId === 'string' && rawConversationId.startsWith('c_')
        ? rawConversationId.slice(2)
        : rawConversationId;
    if (
      typeof firstConversationId === 'string' &&
      firstConversationId &&
      self.OBGeminiSync &&
      typeof self.OBGeminiSync.notifyHistoryCaptured === 'function'
    ) {
      try {
        self.OBGeminiSync.notifyHistoryCaptured(firstConversationId, {
          captured,
          skippedDup,
          other,
          total: turns.length
        });
      } catch (err) {
        ERR(`notifyHistoryCaptured threw tab=${tabId}:`, err?.message || err);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Init
  // ---------------------------------------------------------------------------

  async function initGeminiDebugger() {
    if (initialized) return;
    initialized = true;

    LOG('init');

    geminiEnabled = await readGeminiEnabled();
    LOG(`gemini capture enabled=${geminiEnabled}`);

    await stashRehydrate();

    wireDebuggerListeners();
    wireTabListeners();
    wireSettingsListener();

    if (geminiEnabled) {
      await attachToOpenGeminiTabs();
    }

    LOG('event listeners wired');
  }

  // Auto-initialize on SW wake. Idempotent.
  initGeminiDebugger().catch((err) => ERR('init failed:', err?.message || err));

  // Expose to the classic importScripts service-worker global scope.
  self.OBGeminiDebugger = {
    initGeminiDebugger,
    attachToGeminiTab,
    detachFromTab,
    detachFromAllTabs,
    isCapturePausedByUser,
    // Constants for tests and later wiring.
    DEBUGGER_PROTOCOL_VERSION,
    REQUEST_STASH_TTL_MS,
    GEMINI_URL_PATTERN,
    STASH_KEY_PREFIX,
    PAUSED_STATE_KEY,
    // Read-only views of internal state.
    _attachedTabs: attachedTabs,
    _pendingRequests: pendingRequests
  };
})();
