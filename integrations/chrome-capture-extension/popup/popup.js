(function () {
  'use strict';

  const statusDot = document.getElementById('status-dot');
  const configMissing = document.getElementById('config-missing');
  const openConfigBtn = document.getElementById('open-config-btn');
  const reconfigureBtn = document.getElementById('reconfigure-btn');
  const tabs = Array.from(document.querySelectorAll('.tab'));
  const panels = Array.from(document.querySelectorAll('.tab-panel'));
  const sentCount = document.getElementById('sent-count');
  const queuedCount = document.getElementById('queued-count');
  const skippedCount = document.getElementById('skipped-count');
  const failedCount = document.getElementById('failed-count');
  const platformSummary = document.getElementById('platform-summary');
  const minLengthSummary = document.getElementById('min-length-summary');
  const endpointSummary = document.getElementById('endpoint-summary');
  const captureLog = document.getElementById('capture-log');
  const enabledChatgpt = document.getElementById('enabled-chatgpt');
  const enabledClaude = document.getElementById('enabled-claude');
  const enabledGemini = document.getElementById('enabled-gemini');
  const minLengthInput = document.getElementById('min-length');
  const minLengthValue = document.getElementById('min-length-value');
  const captureCurrentButton = document.getElementById('capture-current');
  const captureResult = document.getElementById('capture-result');
  const testConnectionButton = document.getElementById('test-connection');
  const flushRetryButton = document.getElementById('flush-retry');
  const clearHistoryButton = document.getElementById('clear-history');
  const testResult = document.getElementById('test-result');

  // Sync tab elements (Claude)
  const syncLastTime = document.getElementById('sync-last-time');
  const syncAllBtn = document.getElementById('sync-all-btn');
  const syncIncrementalBtn = document.getElementById('sync-incremental-btn');
  const syncProgressArea = document.getElementById('sync-progress-area');
  const syncProgressBar = document.getElementById('sync-progress-bar');
  const syncProgressText = document.getElementById('sync-progress-text');
  const syncResult = document.getElementById('sync-result');
  const syncAutoToggle = document.getElementById('sync-auto-toggle');
  const syncLog = document.getElementById('sync-log');

  // Sync tab elements (ChatGPT)
  const chatgptSyncLastTime = document.getElementById('chatgpt-sync-last-time');
  const chatgptSyncAllBtn = document.getElementById('chatgpt-sync-all-btn');
  const chatgptSyncIncrementalBtn = document.getElementById('chatgpt-sync-incremental-btn');
  const chatgptSyncAutoToggle = document.getElementById('chatgpt-sync-auto-toggle');

  function setStatusDot(connected, errored) {
    statusDot.className = 'status-dot';
    if (errored) {
      statusDot.classList.add('error');
      statusDot.title = 'Configuration or API error';
      return;
    }
    if (connected) {
      statusDot.classList.add('connected');
      statusDot.title = 'Open Brain API configured';
      return;
    }
    statusDot.classList.add('disconnected');
    statusDot.title = 'Open Brain not configured';
  }

  function showResult(message, kind) {
    testResult.textContent = message;
    testResult.className = `result ${kind || ''}`.trim();
  }

  function formatTime(timestamp) {
    const date = new Date(timestamp);
    if (Number.isNaN(date.getTime())) {
      return '';
    }
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  function formatPlatformSummary(enabledPlatforms) {
    return Object.entries(enabledPlatforms)
      .filter((entry) => entry[1])
      .map((entry) => OBConfig.getPlatformDefinition(entry[0])?.label || entry[0])
      .join(', ') || 'None enabled';
  }

  function openConfigPage() {
    chrome.tabs.create({ url: chrome.runtime.getURL('popup/config.html') });
  }

  async function saveMutableSettings() {
    // NOTE: API URL and key are only editable on the config page. Here we
    // only persist toggles and thresholds so accidental popup edits can't
    // nuke the user's configured credentials.
    const current = await OBConfig.getConfig();
    const merged = OBConfig.mergeSettings({
      ...current,
      enabledPlatforms: {
        chatgpt: enabledChatgpt.checked,
        claude: enabledClaude.checked,
        gemini: enabledGemini.checked
      },
      minResponseLength: Number(minLengthInput.value)
    });

    await chrome.runtime.sendMessage({ type: 'SAVE_CONFIG', config: merged });
    renderSettings(merged);
  }

  function renderSettings(config) {
    enabledChatgpt.checked = Boolean(config.enabledPlatforms.chatgpt);
    enabledClaude.checked = Boolean(config.enabledPlatforms.claude);
    enabledGemini.checked = Boolean(config.enabledPlatforms.gemini);
    minLengthInput.value = config.minResponseLength;
    minLengthValue.textContent = String(config.minResponseLength);

    platformSummary.textContent = formatPlatformSummary(config.enabledPlatforms);
    minLengthSummary.textContent = `${config.minResponseLength} chars`;
    endpointSummary.textContent = config.apiEndpoint || '(not configured)';

    const isConfigured = OBConfig.isConfigured(config);
    configMissing.hidden = isConfigured;
    setStatusDot(isConfigured, false);
  }

  async function loadStatus() {
    const status = await chrome.runtime.sendMessage({ type: 'GET_STATUS' });
    if (!status || !status.ok) {
      setStatusDot(false, true);
      return;
    }

    const metrics = status.sessionMetrics || {};
    sentCount.textContent = String(metrics.sent || 0);
    queuedCount.textContent = String(metrics.queued || 0);
    skippedCount.textContent = String(metrics.skipped || 0);
    failedCount.textContent = String(metrics.failed || 0);

    if (!status.configured) {
      configMissing.hidden = false;
      setStatusDot(false, false);
      return;
    }

    configMissing.hidden = true;
    setStatusDot(true, Boolean(metrics.lastError));
  }

  async function loadActivityLog() {
    const result = await chrome.storage.local.get({
      [OBConfig.STORAGE_KEYS.captureLog]: []
    });
    const log = result[OBConfig.STORAGE_KEYS.captureLog] || [];

    if (log.length === 0) {
      captureLog.innerHTML = '';
      const emptyState = document.createElement('p');
      emptyState.className = 'empty-state';
      emptyState.textContent = 'No extension activity yet.';
      captureLog.appendChild(emptyState);
      return;
    }

    captureLog.innerHTML = '';
    [...log].reverse().forEach((entry) => {
      const item = document.createElement('div');
      item.className = `log-item ${entry.status || 'info'}`;

      const line = document.createElement('div');
      line.className = 'log-line';

      const status = document.createElement('span');
      status.className = 'log-status';
      status.textContent = entry.status || 'info';
      line.appendChild(status);

      const time = document.createElement('span');
      time.className = 'log-time';
      time.textContent = formatTime(entry.timestamp);
      line.appendChild(time);

      const preview = document.createElement('div');
      preview.className = 'log-preview';
      preview.textContent = entry.preview || '(no preview)';

      const detail = document.createElement('div');
      detail.className = 'log-detail';
      detail.textContent = entry.detail || '';

      item.appendChild(line);
      item.appendChild(preview);
      item.appendChild(detail);
      captureLog.appendChild(item);
    });
  }

  async function refresh() {
    const config = await OBConfig.getConfig();
    renderSettings(config);
    await loadStatus();
    await loadActivityLog();
    await loadSyncStates();
  }

  tabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      tabs.forEach((candidate) => candidate.classList.remove('active'));
      panels.forEach((candidate) => candidate.classList.remove('active'));
      tab.classList.add('active');
      document.getElementById(`tab-${tab.dataset.tab}`).classList.add('active');
    });
  });

  [enabledChatgpt, enabledClaude, enabledGemini, minLengthInput].forEach((element) => {
    element.addEventListener('input', saveMutableSettings);
    element.addEventListener('change', saveMutableSettings);
  });

  minLengthInput.addEventListener('input', () => {
    minLengthValue.textContent = minLengthInput.value;
  });

  openConfigBtn.addEventListener('click', openConfigPage);
  reconfigureBtn.addEventListener('click', openConfigPage);

  function showCaptureResult(message, kind) {
    captureResult.textContent = message;
    captureResult.className = `result ${kind || ''}`.trim();
  }

  captureCurrentButton.addEventListener('click', async () => {
    captureCurrentButton.disabled = true;
    showCaptureResult('Capturing...', '');

    try {
      const response = await chrome.runtime.sendMessage({ type: 'CAPTURE_ACTIVE_TAB' });

      if (!response || !response.ok) {
        throw new Error(response?.error || 'Capture failed');
      }

      const status = response.status || 'captured';
      if (status === 'duplicate_fingerprint') {
        showCaptureResult('Already captured (duplicate).', 'success');
      } else if (status === 'restricted_blocked') {
        showCaptureResult('Blocked: contains restricted content.', 'error');
      } else if (status === 'queued_retry') {
        showCaptureResult('Network error — queued for retry.', 'error');
      } else {
        showCaptureResult('Captured successfully!', 'success');
      }

      await refresh();
    } catch (error) {
      showCaptureResult(error.message, 'error');
    } finally {
      captureCurrentButton.disabled = false;
    }
  });

  testConnectionButton.addEventListener('click', async () => {
    testConnectionButton.disabled = true;
    showResult('Testing connection...', '');

    try {
      const config = await OBConfig.getConfig();
      if (!OBConfig.isConfigured(config)) {
        throw new Error('Open Brain is not configured. Click "Reconfigure API URL & Key" on the Settings tab.');
      }
      const response = await chrome.runtime.sendMessage({
        type: 'TEST_CONNECTION',
        config
      });

      if (!response || !response.ok) {
        throw new Error(response?.error || 'Connection test failed');
      }

      showResult(`Connected: ${response.result?.service || 'open-brain-rest'} is healthy`, 'success');
      setStatusDot(true, false);
    } catch (error) {
      showResult(error.message, 'error');
      setStatusDot(false, true);
    } finally {
      testConnectionButton.disabled = false;
    }
  });

  flushRetryButton.addEventListener('click', async () => {
    flushRetryButton.disabled = true;
    showResult('Processing retry queue...', '');

    try {
      const response = await chrome.runtime.sendMessage({ type: 'FLUSH_RETRY_QUEUE' });
      if (!response || !response.ok) {
        throw new Error(response?.error || 'Retry flush failed');
      }
      showResult(`Processed ${response.processed} queued item(s), ${response.remaining} remaining`, 'success');
      await refresh();
    } catch (error) {
      showResult(error.message, 'error');
    } finally {
      flushRetryButton.disabled = false;
    }
  });

  clearHistoryButton.addEventListener('click', async () => {
    await chrome.runtime.sendMessage({ type: 'CLEAR_ACTIVITY_LOG' });
    await loadActivityLog();
  });

  // --- Sync tab logic ---

  function showSyncResult(message, kind) {
    syncResult.textContent = message;
    syncResult.className = `result ${kind || ''}`.trim();
  }

  function formatSyncTime(isoString) {
    if (!isoString) return 'Never';
    const date = new Date(isoString);
    if (Number.isNaN(date.getTime())) return 'Never';
    return date.toLocaleString([], {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  }

  async function loadSyncStates() {
    try {
      const response = await chrome.runtime.sendMessage({ type: 'GET_SYNC_STATE' });
      if (response && response.ok && response.syncState) {
        syncLastTime.textContent = formatSyncTime(response.syncState.lastSyncAt);
        syncAutoToggle.checked = Boolean(response.syncState.autoSyncEnabled);
      }
    } catch (err) {
      console.error('[Open Brain Capture] Failed to load Claude sync state', err);
    }
    try {
      const response = await chrome.runtime.sendMessage({ type: 'GET_CHATGPT_SYNC_STATE' });
      if (response && response.ok && response.syncState) {
        chatgptSyncLastTime.textContent = formatSyncTime(response.syncState.lastSyncAt);
        chatgptSyncAutoToggle.checked = Boolean(response.syncState.autoSyncEnabled);
      }
    } catch (err) {
      console.error('[Open Brain Capture] Failed to load ChatGPT sync state', err);
    }
  }

  function addSyncLogEntry(message) {
    const emptyState = syncLog.querySelector('.empty-state');
    if (emptyState) emptyState.remove();

    const item = document.createElement('div');
    item.className = 'log-item captured';
    const line = document.createElement('div');
    line.className = 'log-line';
    const time = document.createElement('span');
    time.className = 'log-time';
    time.textContent = formatTime(new Date().toISOString());
    line.appendChild(time);
    const detail = document.createElement('div');
    detail.className = 'log-preview';
    detail.textContent = message;
    item.appendChild(line);
    item.appendChild(detail);

    syncLog.prepend(item);
    while (syncLog.children.length > 10) {
      syncLog.removeChild(syncLog.lastChild);
    }
  }

  async function runSync(type, platform) {
    const prefix = platform === 'chatgpt' ? 'CHATGPT_' : '';
    const messageType = type === 'all' ? `${prefix}SYNC_ALL` : `${prefix}SYNC_INCREMENTAL`;
    const platformLabel = platform === 'chatgpt' ? 'ChatGPT' : 'Claude';
    const label = `${platformLabel} ${type === 'all' ? 'full sync' : 'incremental sync'}`;

    syncAllBtn.disabled = true;
    syncIncrementalBtn.disabled = true;
    chatgptSyncAllBtn.disabled = true;
    chatgptSyncIncrementalBtn.disabled = true;
    syncProgressArea.style.display = 'block';
    syncProgressBar.style.width = '0%';
    syncProgressText.textContent = `Starting ${label.toLowerCase()}...`;
    showSyncResult('', '');

    try {
      const response = await chrome.runtime.sendMessage({ type: messageType });

      syncProgressBar.style.width = '100%';

      if (!response || response.error) {
        throw new Error(response?.error || `${label} failed`);
      }

      const total = response.total || 0;
      const synced = response.synced || 0;
      const skipped = response.skipped || 0;
      const errors = response.errors || 0;

      const summary = `${label}: ${synced} captured, ${skipped} skipped, ${errors} errors (${total} total)`;
      syncProgressText.textContent = summary;
      showSyncResult(summary, errors > 0 ? 'error' : 'success');
      addSyncLogEntry(summary);

      await loadSyncStates();
      await loadActivityLog();
    } catch (err) {
      syncProgressText.textContent = 'Sync failed';
      showSyncResult(err.message, 'error');
      addSyncLogEntry(`Error: ${err.message}`);
    } finally {
      syncAllBtn.disabled = false;
      syncIncrementalBtn.disabled = false;
      chatgptSyncAllBtn.disabled = false;
      chatgptSyncIncrementalBtn.disabled = false;
    }
  }

  syncAllBtn.addEventListener('click', () => runSync('all', 'claude'));
  syncIncrementalBtn.addEventListener('click', () => runSync('incremental', 'claude'));

  syncAutoToggle.addEventListener('change', async () => {
    try {
      await chrome.runtime.sendMessage({
        type: 'SET_AUTO_SYNC',
        enabled: syncAutoToggle.checked,
        intervalMinutes: 15
      });
      showSyncResult(
        syncAutoToggle.checked ? 'Claude auto-sync enabled (every 15 min)' : 'Claude auto-sync disabled',
        'success'
      );
    } catch (err) {
      showSyncResult(err.message, 'error');
    }
  });

  chatgptSyncAllBtn.addEventListener('click', () => runSync('all', 'chatgpt'));
  chatgptSyncIncrementalBtn.addEventListener('click', () => runSync('incremental', 'chatgpt'));

  chatgptSyncAutoToggle.addEventListener('change', async () => {
    try {
      await chrome.runtime.sendMessage({
        type: 'SET_CHATGPT_AUTO_SYNC',
        enabled: chatgptSyncAutoToggle.checked,
        intervalMinutes: 15
      });
      showSyncResult(
        chatgptSyncAutoToggle.checked ? 'ChatGPT auto-sync enabled (every 15 min)' : 'ChatGPT auto-sync disabled',
        'success'
      );
    } catch (err) {
      showSyncResult(err.message, 'error');
    }
  });

  refresh().catch((error) => {
    console.error('[Open Brain Capture] Popup init failed', error);
    showResult(error.message, 'error');
    setStatusDot(false, true);
  });
})();
