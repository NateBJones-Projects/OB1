importScripts(
  '../lib/config.js',
  '../lib/api-client.js',
  '../lib/fingerprint.js',
  '../lib/sensitivity.js',
  '../lib/sync-claude.js',
  '../lib/sync-chatgpt.js'
);

const RETRY_ALARM_NAME = 'ob_capture_retry_queue';
const SYNC_ALARM_NAME = 'ob_capture_sync';
const CHATGPT_SYNC_ALARM_NAME = 'ob_capture_chatgpt_sync';
const MAX_CAPTURE_LOG = 100;
const MAX_RETRY_ATTEMPTS = 5;
const MAX_SEEN_FINGERPRINTS = 100000;

let _storageLock = Promise.resolve();
const processingFingerprints = new Set();

let sessionMetrics = {
  queued: 0,
  sent: 0,
  skipped: 0,
  failed: 0,
  lastError: ''
};

const REDACTED_RESTRICTED_PREVIEW = '[restricted content blocked locally]';
const NOT_CONFIGURED_ERROR = 'Open Brain is not configured. Click the extension icon and complete the Configure screen.';

function withStorageLock(fn) {
  _storageLock = _storageLock.then(fn, fn);
  return _storageLock;
}

function createStateDefaults() {
  return {
    [OBConfig.STORAGE_KEYS.captureLog]: [],
    [OBConfig.STORAGE_KEYS.retryQueue]: [],
    [OBConfig.STORAGE_KEYS.seenFingerprints]: []
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

function readSeenFingerprints(state) {
  return state[OBConfig.STORAGE_KEYS.seenFingerprints] || [];
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

async function hasKnownFingerprint(fingerprint) {
  const state = await getLocalState();
  const seen = readSeenFingerprints(state);
  const queue = readRetryQueue(state);
  return processingFingerprints.has(fingerprint) ||
    seen.includes(fingerprint) ||
    queue.some((entry) => entry.fingerprint === fingerprint);
}

async function rememberFingerprint(fingerprint) {
  return withStorageLock(async () => {
    const state = await getLocalState();
    const seen = readSeenFingerprints(state);
    if (seen.includes(fingerprint)) {
      return false;
    }

    const nextSeen = [...seen, fingerprint].slice(-MAX_SEEN_FINGERPRINTS);
    await chrome.storage.local.set({
      [OBConfig.STORAGE_KEYS.seenFingerprints]: nextSeen
    });
    return true;
  });
}

function updateBadge(config) {
  // Show "!" badge when unconfigured, sent count when working, clear otherwise.
  if (config && !OBConfig.isConfigured(config)) {
    chrome.action.setBadgeText({ text: '!' });
    chrome.action.setBadgeBackgroundColor({ color: '#d6a53d' });
    return;
  }
  const badgeText = sessionMetrics.sent > 0 ? String(sessionMetrics.sent) : '';
  chrome.action.setBadgeText({ text: badgeText });
  chrome.action.setBadgeBackgroundColor({ color: '#27784c' });
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

    await chrome.storage.local.set({
      [OBConfig.STORAGE_KEYS.retryQueue]: queue
    });
    sessionMetrics.queued = queue.length;
    sessionMetrics.lastError = errorMessage;
    await refreshBadge();
    return { deadLettered: false, queueLength: queue.length };
  });
}

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
      await queueRetry(item, error.message);
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
});

chrome.runtime.onInstalled.addListener((details) => {
  chrome.alarms.create(RETRY_ALARM_NAME, { periodInMinutes: 5 });
  ensureSyncAlarm();
  ensureChatGPTSyncAlarm();
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

chrome.runtime.onStartup.addListener(() => {
  chrome.alarms.create(RETRY_ALARM_NAME, { periodInMinutes: 5 });
  ensureSyncAlarm();
  ensureChatGPTSyncAlarm();
  sessionMetrics = {
    queued: 0,
    sent: 0,
    skipped: 0,
    failed: 0,
    lastError: ''
  };
  refreshBadge();
});
