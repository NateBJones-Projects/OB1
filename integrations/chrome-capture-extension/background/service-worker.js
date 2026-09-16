importScripts(
  '../lib/config.js',
  '../lib/api-client.js',
  '../lib/fingerprint.js',
  '../lib/sensitivity.js',
  '../lib/sync-claude.js',
  '../lib/sync-chatgpt.js',
  '../lib/extractor-gemini-history.js',
  '../lib/gemini-sync-state.js',
  './gemini-debugger.js',
  './gemini-sync.js'
);

const RETRY_ALARM_NAME = 'ob_capture_retry_queue';
const SYNC_ALARM_NAME = 'ob_capture_sync';
const CHATGPT_SYNC_ALARM_NAME = 'ob_capture_chatgpt_sync';
const GEMINI_SYNC_ALARM_NAME = 'ob_capture_gemini_sync';
const MAX_CAPTURE_LOG = 100;
const MAX_RETRY_ATTEMPTS = 5;
const MAX_SEEN_FINGERPRINTS = 100000;
// Retry entries carry full transcripts; unbounded growth during an outage
// can blow the 10MB chrome.storage.local quota and take every later write
// down with it. Oldest entries dead-letter past this cap.
const MAX_RETRY_QUEUE_ITEMS = 200;

// Fingerprints are sharded across 16 bucket keys by first hex char. The
// legacy single-array layout meant every capture re-read and re-wrote up
// to ~6.5MB of JSON with an O(n) scan; buckets make membership O(1) via
// the in-memory cache and writes touch ~1/16th of the data.
const SEEN_FP_BUCKET_PREFIX = 'ob_capture_seen_fp_';
const SEEN_FP_BUCKET_CHARS = '0123456789abcdef'.split('');
const MAX_SEEN_PER_BUCKET = Math.ceil(MAX_SEEN_FINGERPRINTS / SEEN_FP_BUCKET_CHARS.length);

const SESSION_METRICS_KEY = 'ob_capture_session_metrics';

let _storageLock = Promise.resolve();
const processingFingerprints = new Set();

let sessionMetrics = {
  queued: 0,
  sent: 0,
  skipped: 0,
  failed: 0,
  lastError: ''
};

// sessionMetrics lives in chrome.storage.session so MV3 worker recycling
// (minutes of idle) doesn't zero the popup counters mid-browser-session.
// storage.session clears itself when the browser exits.
function persistSessionMetrics() {
  if (!chrome.storage.session) return;
  try {
    chrome.storage.session.set({ [SESSION_METRICS_KEY]: sessionMetrics }).catch((err) => {
      console.warn('[Open Brain Capture] persistSessionMetrics failed', err);
    });
  } catch (err) {
    console.warn('[Open Brain Capture] persistSessionMetrics threw', err);
  }
}

async function restoreSessionMetrics() {
  try {
    if (chrome.storage.session) {
      const stored = await chrome.storage.session.get({ [SESSION_METRICS_KEY]: null });
      const saved = stored[SESSION_METRICS_KEY];
      if (saved && typeof saved === 'object') {
        sessionMetrics = { ...sessionMetrics, ...saved };
      }
    }
  } catch (err) {
    console.warn('[Open Brain Capture] restoreSessionMetrics failed', err);
  }
  await refreshBadge();
}

const REDACTED_RESTRICTED_PREVIEW = '[restricted content blocked locally]';
const NOT_CONFIGURED_ERROR = 'Open Brain is not configured. Click the extension icon and complete the Configure screen.';

function withStorageLock(fn) {
  _storageLock = _storageLock.then(fn, fn);
  return _storageLock;
}

function createStateDefaults() {
  return {
    [OBConfig.STORAGE_KEYS.captureLog]: [],
    [OBConfig.STORAGE_KEYS.retryQueue]: []
  };
}

async function getLocalState() {
  return chrome.storage.local.get(createStateDefaults());
}

function readCaptureLog(state) {
  return state[OBConfig.STORAGE_KEYS.captureLog] || [];
}

function readRetryQueue(state) {
  return state[OBConfig.STORAGE_KEYS.retryQueue] || [];
}

async function appendCaptureLog(entry) {
  return withStorageLock(async () => {
    const state = await getLocalState();
    const nextLog = [...readCaptureLog(state), entry].slice(-MAX_CAPTURE_LOG);
    await chrome.storage.local.set({
      [OBConfig.STORAGE_KEYS.captureLog]: nextLog
    });
    return nextLog;
  });
}

async function clearCaptureLog() {
  return withStorageLock(async () => {
    await chrome.storage.local.set({
      [OBConfig.STORAGE_KEYS.captureLog]: []
    });
  });
}

async function getRetryQueue() {
  const state = await getLocalState();
  return readRetryQueue(state);
}

// --- Seen-fingerprint cache (bucketed) -------------------------------------

let seenFpCache = null; // Set<string>, authoritative for this SW lifetime
let seenFpCachePromise = null;

function seenFpBucketKey(fingerprint) {
  const c = String(fingerprint).charAt(0).toLowerCase();
  return SEEN_FP_BUCKET_PREFIX + (SEEN_FP_BUCKET_CHARS.includes(c) ? c : '0');
}

async function ensureSeenFpCache() {
  if (seenFpCache) return seenFpCache;
  if (!seenFpCachePromise) {
    seenFpCachePromise = (async () => {
      const bucketKeys = SEEN_FP_BUCKET_CHARS.map((c) => SEEN_FP_BUCKET_PREFIX + c);
      const legacyKey = OBConfig.STORAGE_KEYS.seenFingerprints;
      const stored = await chrome.storage.local.get([...bucketKeys, legacyKey]);

      const cache = new Set();
      for (const key of bucketKeys) {
        const bucket = stored[key];
        if (bucket && typeof bucket === 'object') {
          for (const fp of Object.keys(bucket)) cache.add(fp);
        }
      }

      // One-time migration from the legacy flat array layout.
      const legacy = stored[legacyKey];
      if (Array.isArray(legacy) && legacy.length > 0) {
        const buckets = {};
        const now = Date.now();
        for (const fp of legacy) {
          if (typeof fp !== 'string' || !fp) continue;
          cache.add(fp);
          const key = seenFpBucketKey(fp);
          if (!buckets[key]) {
            const existing = stored[key];
            buckets[key] = existing && typeof existing === 'object' ? { ...existing } : {};
          }
          buckets[key][fp] = now;
        }
        await chrome.storage.local.set(buckets);
        await chrome.storage.local.remove(legacyKey);
        console.log(`[Open Brain Capture] Migrated ${legacy.length} fingerprints to bucketed storage`);
      }

      seenFpCache = cache;
      return cache;
    })().catch((err) => {
      // Don't cache a failed init; next call retries.
      seenFpCachePromise = null;
      throw err;
    });
  }
  return seenFpCachePromise;
}

async function hasKnownFingerprint(fingerprint) {
  if (processingFingerprints.has(fingerprint)) return true;
  const cache = await ensureSeenFpCache();
  if (cache.has(fingerprint)) return true;
  const queue = await getRetryQueue();
  return queue.some((entry) => entry.fingerprint === fingerprint);
}

async function rememberFingerprint(fingerprint) {
  const cache = await ensureSeenFpCache();
  if (cache.has(fingerprint)) {
    return false;
  }
  cache.add(fingerprint);

  return withStorageLock(async () => {
    const key = seenFpBucketKey(fingerprint);
    const stored = await chrome.storage.local.get({ [key]: {} });
    const bucket = stored[key] && typeof stored[key] === 'object' ? stored[key] : {};
    bucket[fingerprint] = Date.now();

    // Evict oldest entries past the per-bucket cap. The brain's server-side
    // content_fingerprint dedup remains the correctness backstop for
    // anything evicted here.
    const entries = Object.keys(bucket);
    if (entries.length > MAX_SEEN_PER_BUCKET) {
      entries.sort((a, b) => Number(bucket[a]) - Number(bucket[b]));
      const evictCount = entries.length - MAX_SEEN_PER_BUCKET;
      for (let i = 0; i < evictCount; i++) {
        delete bucket[entries[i]];
        cache.delete(entries[i]);
      }
    }

    try {
      await chrome.storage.local.set({ [key]: bucket });
    } catch (err) {
      // Quota or IO failure: keep the in-memory entry so this SW lifetime
      // still dedups, but surface the problem instead of failing silently.
      console.error('[Open Brain Capture] Failed to persist fingerprint bucket', err);
      sessionMetrics.lastError = `Fingerprint store write failed: ${err.message}`;
      persistSessionMetrics();
    }
    return true;
  });
}

function updateBadge(config) {
  // Show "!" badge when unconfigured, sent count when working, clear otherwise.
  if (config && !OBConfig.isConfigured(config)) {
    chrome.action.setBadgeText({ text: '!' });
    chrome.action.setBadgeBackgroundColor({ color: '#d6a53d' });
    persistSessionMetrics();
    return;
  }
  const badgeText = sessionMetrics.sent > 0 ? String(sessionMetrics.sent) : '';
  chrome.action.setBadgeText({ text: badgeText });
  chrome.action.setBadgeBackgroundColor({ color: '#27784c' });
  persistSessionMetrics();
}

async function refreshBadge() {
  try {
    const config = await OBConfig.getConfig();
    updateBadge(config);
  } catch (err) {
    console.error('[Open Brain Capture] Failed to refresh badge', err);
  }
}

function buildPreview(text) {
  return String(text || '').replace(/\s+/g, ' ').trim().slice(0, 120);
}

function buildRetryDelayMinutes(attempts) {
  const clampedAttempts = Math.max(1, attempts);
  return Math.min(Math.pow(2, clampedAttempts - 1), 60);
}

// 4xx responses (bad key, bad payload, not found) will fail identically on
// every retry — queueing them just produces a 5-minute error drip until
// dead-letter. Only network failures, timeouts, 429 and 5xx are retryable.
function isPermanentIngestError(error) {
  const status = Number(error && error.status);
  return status >= 400 && status < 500 && status !== 429;
}

function describeIngestError(error) {
  const status = Number(error && error.status);
  if (status === 401 || status === 403) {
    return `API key rejected (HTTP ${status}) — check the key in the Configure screen`;
  }
  return error && error.message ? error.message : String(error);
}

async function recordRejectedCapture(platform, preview, fingerprint, errorMessage) {
  sessionMetrics.failed += 1;
  sessionMetrics.lastError = errorMessage;
  await appendCaptureLog({
    timestamp: new Date().toISOString(),
    platform: platform || 'unknown',
    status: 'rejected',
    preview,
    detail: errorMessage,
    fingerprint: String(fingerprint || '').slice(0, 16)
  });
  await refreshBadge();
}

async function queueRetry(item, errorMessage) {
  return withStorageLock(async () => {
    const state = await getLocalState();
    const queue = [...readRetryQueue(state)];
    const nextAttempts = Number(item.attempts || 0) + 1;
    const retryEntry = {
      ...item,
      attempts: nextAttempts,
      lastError: errorMessage,
      nextRetryAt: new Date(Date.now() + buildRetryDelayMinutes(nextAttempts) * 60 * 1000).toISOString()
    };

    if (nextAttempts >= MAX_RETRY_ATTEMPTS) {
      const nextLog = [...readCaptureLog(state), {
        timestamp: new Date().toISOString(),
        platform: retryEntry.platform || 'unknown',
        status: 'dead_letter',
        preview: retryEntry.preview,
        detail: errorMessage,
        fingerprint: String(retryEntry.fingerprint || '').slice(0, 16)
      }].slice(-MAX_CAPTURE_LOG);

      sessionMetrics.failed += 1;
      sessionMetrics.queued = queue.length;
      sessionMetrics.lastError = errorMessage;
      await chrome.storage.local.set({
        [OBConfig.STORAGE_KEYS.captureLog]: nextLog
      });
      await refreshBadge();
      return { deadLettered: true, queueLength: queue.length };
    }

    const existingIndex = queue.findIndex((entry) => entry.fingerprint === retryEntry.fingerprint);
    if (existingIndex >= 0) {
      queue[existingIndex] = retryEntry;
    } else {
      queue.push(retryEntry);
    }

    // Cap the queue: entries carry full transcripts, and an unbounded queue
    // during an outage can blow the storage quota. Oldest items dead-letter.
    const overflowLogEntries = [];
    while (queue.length > MAX_RETRY_QUEUE_ITEMS) {
      const evicted = queue.shift();
      overflowLogEntries.push({
        timestamp: new Date().toISOString(),
        platform: evicted.platform || 'unknown',
        status: 'dead_letter',
        preview: evicted.preview,
        detail: `Retry queue full (${MAX_RETRY_QUEUE_ITEMS}) — oldest entry dropped`,
        fingerprint: String(evicted.fingerprint || '').slice(0, 16)
      });
      sessionMetrics.failed += 1;
    }

    const writes = {
      [OBConfig.STORAGE_KEYS.retryQueue]: queue
    };
    if (overflowLogEntries.length > 0) {
      writes[OBConfig.STORAGE_KEYS.captureLog] =
        [...readCaptureLog(state), ...overflowLogEntries].slice(-MAX_CAPTURE_LOG);
    }
    await chrome.storage.local.set(writes);
    sessionMetrics.queued = queue.length;
    sessionMetrics.lastError = errorMessage;
    await refreshBadge();
    return { deadLettered: false, queueLength: queue.length };
  });
}

// Expose processCaptureRequest on the SW global so the Gemini debugger
// module (background/gemini-debugger.js) can dispatch extracted history
// turns through the same capture pipeline as manual capture and the
// Claude/ChatGPT bulk-sync paths. Classic-script function declarations
// are already global in the SW scope, but pinning the reference here
// makes the cross-module contract explicit.
self.processCaptureRequest = processCaptureRequest;

function normalizeCaptureRequest(message) {
  const platform = String(message.platform || '').trim().toLowerCase();
  const text = String(message.text || message.content || '').trim();
  // Capture mode is now either 'manual' (user click) or 'sync' (bulk import).
  // Ambient capture was removed in the initial public release because it was
  // never wired up; no producer in this extension emits 'ambient'.
  const captureMode = String(message.captureMode || 'manual').trim().toLowerCase();
  const sourceType = String(message.sourceType || '').trim() || OBConfig.getSourceType(platform, captureMode);
  const sourceLabel = String(message.sourceLabel || `${platform || 'unknown'}:${captureMode}`);
  const sourceMetadata = message.sourceMetadata && typeof message.sourceMetadata === 'object'
    ? message.sourceMetadata
    : {};

  return {
    platform,
    text,
    captureMode,
    sourceType,
    sourceLabel,
    sourceMetadata,
    autoExecute: message.autoExecute !== false,
    assistantLength: Number(message.assistantLength || message.textLength || text.length || 0),
    preview: buildPreview(message.preview || text)
  };
}

async function processCaptureRequest(message) {
  const capture = normalizeCaptureRequest(message);
  const config = await OBConfig.getConfig();

  if (!capture.text) {
    throw new Error('Capture request is missing text');
  }

  if (!OBConfig.isConfigured(config)) {
    throw new Error(NOT_CONFIGURED_ERROR);
  }

  if (capture.platform && config.enabledPlatforms[capture.platform] === false) {
    sessionMetrics.skipped += 1;
    return { ok: true, status: 'disabled_platform' };
  }

  // Ambient capture was removed — no passive observer ships yet. Manual
  // clicks and bulk sync are the only remaining paths and both capture
  // unconditionally: the user (or a user-triggered sync) explicitly
  // asked for this turn to be captured, so there is no length gate here.

  const sensitivity = await OBSensitivity.detectSensitivity(capture.text);
  if (sensitivity.tier === 'restricted') {
    sessionMetrics.skipped += 1;
    await appendCaptureLog({
      timestamp: new Date().toISOString(),
      platform: capture.platform || 'unknown',
      status: 'restricted_blocked',
      preview: REDACTED_RESTRICTED_PREVIEW,
      detail: sensitivity.labels.join(', ')
    });
    return { ok: true, status: 'restricted_blocked', labels: sensitivity.labels };
  }

  const fingerprint = await OBFingerprint.compute(capture.text);
  if (await hasKnownFingerprint(fingerprint)) {
    sessionMetrics.skipped += 1;
    return { ok: true, status: 'duplicate_fingerprint', fingerprint };
  }

  // Important: the add() and all mutation that follows lives inside the
  // try block so the finally guarantees cleanup. If an exception were to
  // fire between add() and the ingest call, the old code would leak the
  // fingerprint into processingFingerprints forever and hasKnownFingerprint
  // would silently suppress any future capture of the same content.
  let payload;
  try {
    processingFingerprints.add(fingerprint);

    payload = {
      text: capture.text,
      source_label: capture.sourceLabel,
      source_type: capture.sourceType,
      auto_execute: capture.autoExecute,
      source_metadata: {
        ...capture.sourceMetadata,
        extension_capture_mode: capture.captureMode,
        extension_platform: capture.platform,
        content_fingerprint: fingerprint
      }
    };

    try {
      const result = await OBApiClient.ingestDocument(payload, {
        apiKey: config.apiKey,
        endpoint: config.apiEndpoint
      });

      await rememberFingerprint(fingerprint);
      await appendCaptureLog({
        timestamp: new Date().toISOString(),
        platform: capture.platform || 'unknown',
        status: result && result.status ? result.status : 'captured',
        preview: capture.preview,
        detail: result && result.message ? result.message : '',
        fingerprint: fingerprint.slice(0, 16)
      });

      if (result && result.status === 'existing') {
        sessionMetrics.skipped += 1;
      } else {
        sessionMetrics.sent += 1;
      }
      sessionMetrics.lastError = '';
      await refreshBadge();

      return {
        ok: true,
        status: result && result.status ? result.status : 'captured',
        result,
        fingerprint
      };
    } catch (error) {
      if (isPermanentIngestError(error)) {
        const detail = describeIngestError(error);
        await recordRejectedCapture(capture.platform, capture.preview, fingerprint, detail);
        return {
          ok: false,
          status: 'rejected',
          error: detail,
          fingerprint
        };
      }

      const retryItem = {
        platform: capture.platform || 'unknown',
        preview: capture.preview,
        payload,
        fingerprint,
        attempts: 0,
        queuedAt: new Date().toISOString()
      };

      await queueRetry(retryItem, error.message);
      await appendCaptureLog({
        timestamp: new Date().toISOString(),
        platform: capture.platform || 'unknown',
        status: 'queued_retry',
        preview: capture.preview,
        detail: error.message,
        fingerprint: fingerprint.slice(0, 16)
      });

      return {
        ok: false,
        status: 'queued_retry',
        error: error.message,
        fingerprint
      };
    }
  } finally {
    processingFingerprints.delete(fingerprint);
  }
}

async function claimRetryQueueItems(forceAll) {
  return withStorageLock(async () => {
    const state = await getLocalState();
    const queue = readRetryQueue(state);

    if (queue.length === 0) {
      sessionMetrics.queued = 0;
      await refreshBadge();
      return { dueItems: [], remainingCount: 0 };
    }

    const now = Date.now();
    const dueItems = [];
    const remaining = [];

    for (const item of queue) {
      const nextRetryAt = item.nextRetryAt ? Date.parse(item.nextRetryAt) : 0;
      if (!forceAll && nextRetryAt && nextRetryAt > now) {
        remaining.push(item);
      } else {
        dueItems.push(item);
      }
    }

    await chrome.storage.local.set({
      [OBConfig.STORAGE_KEYS.retryQueue]: remaining
    });
    sessionMetrics.queued = remaining.length;
    await refreshBadge();

    return { dueItems, remainingCount: remaining.length };
  });
}

async function processRetryQueue(forceAll) {
  const config = await OBConfig.getConfig();
  if (!OBConfig.isConfigured(config)) {
    return { ok: false, error: NOT_CONFIGURED_ERROR };
  }

  const { dueItems, remainingCount } = await claimRetryQueueItems(forceAll);
  if (dueItems.length === 0) {
    return { ok: true, processed: 0, remaining: remainingCount };
  }

  let processed = 0;

  for (const item of dueItems) {
    processingFingerprints.add(item.fingerprint);
    try {
      const result = await OBApiClient.ingestDocument(item.payload, {
        apiKey: config.apiKey,
        endpoint: config.apiEndpoint
      });

      processed += 1;
      await rememberFingerprint(item.fingerprint);
      const resultStatus = result && result.status ? result.status : 'captured';
      const logStatus = resultStatus === 'existing' ? 'retry_existing' : 'retry_sent';
      if (resultStatus === 'existing') {
        sessionMetrics.skipped += 1;
      } else {
        sessionMetrics.sent += 1;
      }
      sessionMetrics.lastError = '';
      await appendCaptureLog({
        timestamp: new Date().toISOString(),
        platform: item.platform || 'unknown',
        status: logStatus,
        preview: item.preview,
        detail: result && result.message ? result.message : 'Retry queue delivery succeeded',
        fingerprint: String(item.fingerprint || '').slice(0, 16)
      });
    } catch (error) {
      if (isPermanentIngestError(error)) {
        await recordRejectedCapture(item.platform, item.preview, item.fingerprint, describeIngestError(error));
      } else {
        await queueRetry(item, error.message);
      }
    } finally {
      processingFingerprints.delete(item.fingerprint);
    }
  }

  const finalQueue = await getRetryQueue();
  sessionMetrics.queued = finalQueue.length;
  await refreshBadge();

  return {
    ok: true,
    processed,
    remaining: finalQueue.length
  };
}

async function getStatus() {
  const config = await OBConfig.getConfig();
  const queue = await getRetryQueue();
  return {
    ok: true,
    configured: OBConfig.isConfigured(config),
    settings: {
      apiEndpoint: config.apiEndpoint,
      apiKeyConfigured: Boolean(config.apiKey),
      enabledPlatforms: config.enabledPlatforms
    },
    sessionMetrics: {
      ...sessionMetrics,
      queued: queue.length
    }
  };
}

async function captureActiveTab() {
  const config = await OBConfig.getConfig();
  if (!OBConfig.isConfigured(config)) {
    throw new Error(NOT_CONFIGURED_ERROR);
  }

  const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!activeTab || !activeTab.url) {
    throw new Error('No active tab found.');
  }

  const platform = OBConfig.resolvePlatformFromUrl(activeTab.url);
  if (!platform) {
    throw new Error('This page is not a supported platform. Navigate to a Claude, ChatGPT, or Gemini conversation first.');
  }

  if (config.enabledPlatforms[platform] === false) {
    throw new Error(`${platform} capture is disabled in settings.`);
  }

  let extraction;
  try {
    extraction = await chrome.tabs.sendMessage(activeTab.id, { type: 'EXTRACT_VISIBLE_RESPONSE' });
  } catch (err) {
    throw new Error(`Cannot reach the page. Try refreshing the tab and retrying.`);
  }

  if (!extraction || !extraction.ok) {
    throw new Error(extraction?.error || 'Extraction returned no data.');
  }

  return processCaptureRequest(extraction.capture);
}

async function getSyncState() {
  const state = await OBClaudeSync.loadSyncState();
  return { ok: true, syncState: state };
}

async function setAutoSync(enabled, intervalMinutes) {
  const state = await OBClaudeSync.loadSyncState();
  state.autoSyncEnabled = Boolean(enabled);
  if (typeof intervalMinutes === 'number' && intervalMinutes > 0) {
    state.autoSyncIntervalMinutes = intervalMinutes;
  }
  await OBClaudeSync.saveSyncState(state);

  if (state.autoSyncEnabled) {
    chrome.alarms.create(SYNC_ALARM_NAME, { periodInMinutes: state.autoSyncIntervalMinutes });
  } else {
    chrome.alarms.clear(SYNC_ALARM_NAME);
  }

  return { ok: true, syncState: state };
}

async function ensureSyncAlarm() {
  const state = await OBClaudeSync.loadSyncState();
  if (state.autoSyncEnabled) {
    chrome.alarms.create(SYNC_ALARM_NAME, { periodInMinutes: state.autoSyncIntervalMinutes || 15 });
  }
}

async function getChatGPTSyncState() {
  const state = await OBChatGPTSync.loadSyncState();
  return { ok: true, syncState: state };
}

async function setChatGPTAutoSync(enabled, intervalMinutes) {
  const state = await OBChatGPTSync.loadSyncState();
  state.autoSyncEnabled = Boolean(enabled);
  if (typeof intervalMinutes === 'number' && intervalMinutes > 0) {
    state.autoSyncIntervalMinutes = intervalMinutes;
  }
  await OBChatGPTSync.saveSyncState(state);

  if (state.autoSyncEnabled) {
    chrome.alarms.create(CHATGPT_SYNC_ALARM_NAME, { periodInMinutes: state.autoSyncIntervalMinutes });
  } else {
    chrome.alarms.clear(CHATGPT_SYNC_ALARM_NAME);
  }

  return { ok: true, syncState: state };
}

async function ensureChatGPTSyncAlarm() {
  const state = await OBChatGPTSync.loadSyncState();
  if (state.autoSyncEnabled) {
    chrome.alarms.create(CHATGPT_SYNC_ALARM_NAME, { periodInMinutes: state.autoSyncIntervalMinutes || 15 });
  }
}

// ── Gemini bulk history sync (Phase B/C) ────────────────────────────────
//
// Phase C lives in background/gemini-sync.js (OBGeminiSync) and only loads
// if gemini-sync-state.js loaded first. The service worker touches it only
// through the OBGeminiSync.* API and the alarm lifecycle mirrors the Claude
// and ChatGPT paths above.

async function setGeminiAutoSync(enabled, intervalMinutes) {
  if (!self.OBGeminiSync || typeof self.OBGeminiSync.setAutoSync !== 'function') {
    return { ok: false, error: 'OBGeminiSync unavailable' };
  }
  const result = await self.OBGeminiSync.setAutoSync(enabled, intervalMinutes);
  if (result && result.ok !== false) {
    if (result.autoSyncEnabled) {
      chrome.alarms.create(GEMINI_SYNC_ALARM_NAME, { periodInMinutes: result.autoSyncIntervalMinutes || 240 });
    } else {
      chrome.alarms.clear(GEMINI_SYNC_ALARM_NAME);
    }
  }
  return result;
}

async function ensureGeminiSyncAlarm() {
  if (!self.OBGeminiSync || typeof self.OBGeminiSync.getStatus !== 'function') return;
  try {
    const status = await self.OBGeminiSync.getStatus();
    const s = status && status.status;
    if (s && s.autoSyncEnabled) {
      chrome.alarms.create(GEMINI_SYNC_ALARM_NAME, { periodInMinutes: s.autoSyncIntervalMinutes || 240 });
    }
  } catch (err) {
    console.error('[Open Brain Capture] ensureGeminiSyncAlarm failed', err);
  }
}

async function handleMessage(message) {
  switch (message.type) {
    case 'GET_STATUS':
      return getStatus();
    case 'GET_CONFIG':
      return { ok: true, config: await OBConfig.getConfig() };
    case 'SAVE_CONFIG': {
      const saved = await OBConfig.setConfig(message.config || {});
      await refreshBadge();
      return { ok: true, config: saved };
    }
    case 'TEST_CONNECTION': {
      const incoming = message.config || message.settings || {};
      const current = await OBConfig.getConfig();
      const merged = OBConfig.mergeSettings({ ...current, ...incoming });
      if (!OBConfig.isConfigured(merged)) {
        return { ok: false, error: NOT_CONFIGURED_ERROR };
      }
      const result = await OBApiClient.healthCheck({
        apiKey: merged.apiKey,
        endpoint: merged.apiEndpoint
      });
      sessionMetrics.lastError = '';
      return { ok: true, result };
    }
    case 'QUEUE_CAPTURE':
      return processCaptureRequest(message.capture || {});
    case 'CAPTURE_ACTIVE_TAB':
      return captureActiveTab();
    case 'FLUSH_RETRY_QUEUE':
      return processRetryQueue(true);
    case 'CLEAR_ACTIVITY_LOG':
      await clearCaptureLog();
      return { ok: true };
    case 'SYNC_ALL':
      return OBClaudeSync.syncAll({
        captureHandler: processCaptureRequest,
        onProgress: null
      });
    case 'SYNC_INCREMENTAL':
      return OBClaudeSync.syncIncremental({
        captureHandler: processCaptureRequest,
        onProgress: null
      });
    case 'GET_SYNC_STATE':
      return getSyncState();
    case 'SET_AUTO_SYNC':
      return setAutoSync(message.enabled, message.intervalMinutes);
    case 'CHATGPT_SYNC_ALL':
      return OBChatGPTSync.syncAll({
        captureHandler: processCaptureRequest,
        onProgress: null
      });
    case 'CHATGPT_SYNC_INCREMENTAL':
      return OBChatGPTSync.syncIncremental({
        captureHandler: processCaptureRequest,
        onProgress: null
      });
    case 'GET_CHATGPT_SYNC_STATE':
      return getChatGPTSyncState();
    case 'SET_CHATGPT_AUTO_SYNC':
      return setChatGPTAutoSync(message.enabled, message.intervalMinutes);
    case 'GEMINI_SYNC_START':
      if (!self.OBGeminiSync || typeof self.OBGeminiSync.startSync !== 'function') {
        return { ok: false, error: 'OBGeminiSync unavailable' };
      }
      return self.OBGeminiSync.startSync(message.options || {});
    case 'GEMINI_SYNC_CANCEL':
      if (!self.OBGeminiSync || typeof self.OBGeminiSync.cancelSync !== 'function') {
        return { ok: false, error: 'OBGeminiSync unavailable' };
      }
      return self.OBGeminiSync.cancelSync();
    case 'GEMINI_SYNC_RESUME':
      if (!self.OBGeminiSync || typeof self.OBGeminiSync.resumeSync !== 'function') {
        return { ok: false, error: 'OBGeminiSync unavailable' };
      }
      return self.OBGeminiSync.resumeSync();
    case 'GEMINI_SYNC_INCREMENTAL':
      if (!self.OBGeminiSync || typeof self.OBGeminiSync.syncIncremental !== 'function') {
        return { ok: false, error: 'OBGeminiSync unavailable' };
      }
      return self.OBGeminiSync.syncIncremental({ trigger: 'manual' });
    case 'SET_GEMINI_AUTO_SYNC':
      return setGeminiAutoSync(message.enabled, message.intervalMinutes);
    case 'GEMINI_SYNC_STATUS':
      if (!self.OBGeminiSync || typeof self.OBGeminiSync.getStatus !== 'function') {
        return { ok: false, error: 'OBGeminiSync unavailable' };
      }
      return self.OBGeminiSync.getStatus();
    default:
      return { ok: false, error: `Unknown message type: ${message.type}` };
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message)
    .then((response) => sendResponse(response))
    .catch((error) => {
      sessionMetrics.lastError = error.message;
      sendResponse({ ok: false, error: error.message });
    });

  return true;
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === RETRY_ALARM_NAME) {
    processRetryQueue(false).catch((error) => {
      console.error('[Open Brain Capture] Retry queue processing failed', error);
    });
  }
  if (alarm.name === SYNC_ALARM_NAME) {
    OBClaudeSync.syncIncremental({
      captureHandler: processCaptureRequest,
      onProgress: null
    }).then((result) => {
      console.log(`[Open Brain Capture] Claude auto-sync complete: ${result.synced} synced, ${result.skipped} skipped, ${result.errors} errors`);
    }).catch((error) => {
      console.error('[Open Brain Capture] Claude auto-sync failed', error);
    });
  }
  if (alarm.name === CHATGPT_SYNC_ALARM_NAME) {
    OBChatGPTSync.syncIncremental({
      captureHandler: processCaptureRequest,
      onProgress: null
    }).then((result) => {
      console.log(`[Open Brain Capture] ChatGPT auto-sync complete: ${result.synced} synced, ${result.skipped} skipped, ${result.errors} errors`);
    }).catch((error) => {
      console.error('[Open Brain Capture] ChatGPT auto-sync failed', error);
    });
  }
  if (alarm.name === GEMINI_SYNC_ALARM_NAME) {
    if (!self.OBGeminiSync || typeof self.OBGeminiSync.syncIncremental !== 'function') {
      console.warn('[Open Brain Capture] Gemini auto-sync fired but OBGeminiSync is unavailable');
      return;
    }
    // If the previous run is paused on a Google challenge (state=canceled
    // with pendingIds still queued), DO NOT start a fresh incremental from
    // the alarm — it would just re-enumerate the sidebar in a new tab and
    // most likely re-trigger the challenge. The user resumes manually from
    // the popup after solving the CAPTCHA.
    (async () => {
      try {
        const status = await self.OBGeminiSync.getStatus();
        const s = status && status.status;
        if (s && s.state === 'canceled' && Number(s.pending) > 0) {
          console.log('[Open Brain Capture] Gemini auto-sync skipped: previous run paused (resume from popup)');
          return;
        }
        const result = await self.OBGeminiSync.syncIncremental({ trigger: 'alarm' });
        console.log(`[Open Brain Capture] Gemini auto-sync complete:`,
          result && (result.message || `captured=${result.totals?.captured || 0} completed=${result.completed || 0}`));
      } catch (error) {
        console.error('[Open Brain Capture] Gemini auto-sync failed', error);
      }
    })();
  }
});

chrome.runtime.onInstalled.addListener((details) => {
  chrome.alarms.create(RETRY_ALARM_NAME, { periodInMinutes: 5 });
  ensureSyncAlarm();
  ensureChatGPTSyncAlarm();
  ensureGeminiSyncAlarm();
  refreshBadge();

  // Only auto-open the Configure tab on a fresh install. onInstalled also
  // fires for every update (including silent self-updates from the Chrome
  // Web Store), and we don't want to fling the config page at users every
  // time they get a patch release. The yellow "!" badge and the popup's
  // config-missing banner are enough of a surface when setup is needed.
  if (details.reason !== 'install') return;
  OBConfig.getConfig().then((config) => {
    if (!OBConfig.isConfigured(config)) {
      chrome.tabs.create({ url: chrome.runtime.getURL('popup/config.html') });
    }
  }).catch((err) => console.error('[Open Brain Capture] Install config check failed', err));
});

// Rehydrate metrics (and repaint the badge) on every service-worker wake,
// not just browser startup — MV3 recycles the worker after minutes of idle.
restoreSessionMetrics();

chrome.runtime.onStartup.addListener(() => {
  chrome.alarms.create(RETRY_ALARM_NAME, { periodInMinutes: 5 });
  ensureSyncAlarm();
  ensureChatGPTSyncAlarm();
  ensureGeminiSyncAlarm();
  sessionMetrics = {
    queued: 0,
    sent: 0,
    skipped: 0,
    failed: 0,
    lastError: ''
  };
  persistSessionMetrics();
  refreshBadge();
});
