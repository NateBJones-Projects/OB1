(function (global) {
  'use strict';

  const BATCH_SIZE = 30;
  const BATCH_DELAY_MS = 100;
  const MAX_BACKOFF_MS = 30000;

  /**
   * Sleep for a given number of milliseconds.
   */
  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Exponential backoff delay for retryable errors (429, 5xx).
   * Returns delay in ms: min(2^attempt * 500, MAX_BACKOFF_MS) + jitter.
   */
  function backoffDelay(attempt) {
    const base = Math.min(Math.pow(2, attempt) * 500, MAX_BACKOFF_MS);
    const jitter = Math.random() * 200;
    return base + jitter;
  }

  /**
   * Fetch with retry on 429 and 5xx errors. Max 3 attempts.
   */
  async function fetchWithRetry(url, options, maxAttempts) {
    const attempts = maxAttempts || 3;
    for (let i = 0; i < attempts; i++) {
      const response = await fetch(url, options);
      if (response.ok) {
        return response;
      }
      const isRetryable = response.status === 429 || response.status >= 500;
      if (!isRetryable || i === attempts - 1) {
        const body = await response.text().catch(() => '');
        throw new Error(`Claude API ${response.status}: ${body.slice(0, 200)}`);
      }
      console.warn(`[Open Brain Capture] Claude API returned ${response.status}, retrying in ${Math.round(backoffDelay(i))}ms (attempt ${i + 1}/${attempts})`);
      await sleep(backoffDelay(i));
    }
  }

  /**
   * Get the organization ID from the lastActiveOrg cookie on claude.ai.
   */
  async function getOrgId() {
    const cookie = await chrome.cookies.get({
      url: 'https://claude.ai',
      name: 'lastActiveOrg'
    });
    if (!cookie || !cookie.value) {
      throw new Error('Could not find lastActiveOrg cookie. Are you logged in to claude.ai?');
    }
    return decodeURIComponent(cookie.value);
  }

  async function listConversations(orgId) {
    const url = `https://claude.ai/api/organizations/${orgId}/chat_conversations`;
    const response = await fetchWithRetry(url, {
      method: 'GET',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' }
    });
    const data = await response.json();

    if (!Array.isArray(data)) {
      throw new Error('Unexpected response format from Claude conversations API');
    }

    return data.map((conv) => ({
      uuid: conv.uuid,
      name: conv.name || '(untitled)',
      created_at: conv.created_at,
      updated_at: conv.updated_at
    }));
  }

  async function getConversation(orgId, uuid) {
    const url = `https://claude.ai/api/organizations/${orgId}/chat_conversations/${uuid}?tree=True&rendering_mode=messages&render_all_tools=true`;
    const response = await fetchWithRetry(url, {
      method: 'GET',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' }
    });
    return response.json();
  }

  function extractMessageText(content) {
    if (typeof content === 'string') {
      return content;
    }
    if (!Array.isArray(content)) {
      return '';
    }
    return content
      .filter((block) => block.type === 'text' && block.text)
      .map((block) => block.text)
      .join('\n');
  }

  function flattenMessages(conversation) {
    const messages = conversation.chat_messages || [];
    const sorted = [...messages].sort((a, b) => {
      if (typeof a.index === 'number' && typeof b.index === 'number') {
        return a.index - b.index;
      }
      return (a.created_at || '').localeCompare(b.created_at || '');
    });
    return sorted;
  }

  function formatForIngest(conversation) {
    const name = conversation.name || '(untitled)';
    const createdAt = conversation.created_at || '';
    const uuid = conversation.uuid || '';

    const messages = flattenMessages(conversation);
    const lines = [`Conversation title: ${name}`, `Conversation created at: ${createdAt}`, ''];

    for (const msg of messages) {
      const role = msg.sender === 'human' ? 'USER' : 'ASSISTANT';
      const text = extractMessageText(msg.content || msg.text || '');
      if (text.trim()) {
        lines.push(`${role}: ${text}`);
        lines.push('');
      }
    }

    const fullText = lines.join('\n').trim();

    return {
      text: fullText,
      platform: 'claude',
      captureMode: 'sync',
      sourceType: 'claude_import',
      sourceLabel: `claude:sync`,
      sourceMetadata: {
        conversation_id: uuid,
        conversation_title: name,
        page_url: `https://claude.ai/chat/${uuid}`,
        capture_mode: 'sync',
        export_tool: 'open_brain_capture_extension_sync'
      },
      autoExecute: true
    };
  }

  async function loadSyncTimestamps() {
    const key = OBConfig.STORAGE_KEYS.syncTimestamps;
    const result = await chrome.storage.local.get({ [key]: {} });
    return result[key] || {};
  }

  async function saveSyncTimestamps(timestamps) {
    const key = OBConfig.STORAGE_KEYS.syncTimestamps;
    await chrome.storage.local.set({ [key]: timestamps });
  }

  async function loadSyncState() {
    const key = OBConfig.STORAGE_KEYS.syncState;
    const result = await chrome.storage.local.get({
      [key]: {
        lastSyncAt: null,
        autoSyncEnabled: false,
        autoSyncIntervalMinutes: 15
      }
    });
    return result[key];
  }

  async function saveSyncState(state) {
    const key = OBConfig.STORAGE_KEYS.syncState;
    await chrome.storage.local.set({ [key]: state });
  }

  async function processOneConversation(orgId, conv, captureHandler) {
    const fullConv = await getConversation(orgId, conv.uuid);
    const formatted = formatForIngest(fullConv);

    if (!formatted.text || formatted.text.length < 50) {
      return { status: 'skipped', reason: 'too_short' };
    }

    const result = await captureHandler(formatted);
    return result;
  }

  async function syncAll(options) {
    const { captureHandler, onProgress } = options;

    let orgId;
    try {
      orgId = await getOrgId();
    } catch (err) {
      throw new Error(`Cannot sync: ${err.message}`);
    }

    const conversations = await listConversations(orgId);
    const total = conversations.length;
    let synced = 0;
    let skipped = 0;
    let errors = 0;
    const timestamps = {};

    for (let i = 0; i < total; i++) {
      const conv = conversations[i];

      if (onProgress) {
        onProgress(i + 1, total, conv.name || '(untitled)');
      }

      try {
        const result = await processOneConversation(orgId, conv, captureHandler);
        if (result && (result.status === 'skipped' || result.status === 'duplicate_fingerprint' || result.status === 'too_short' || result.status === 'restricted_blocked' || result.status === 'existing')) {
          skipped++;
        } else {
          synced++;
        }
        timestamps[conv.uuid] = conv.updated_at;
      } catch (err) {
        console.error(`[Open Brain Capture] Failed to sync conversation "${conv.name}":`, err);
        errors++;
      }

      if (i + 1 < total) {
        await sleep(BATCH_DELAY_MS);
      }
      if ((i + 1) % BATCH_SIZE === 0 && i + 1 < total) {
        await sleep(BATCH_DELAY_MS);
      }
    }

    await saveSyncTimestamps(timestamps);
    const syncState = await loadSyncState();
    syncState.lastSyncAt = new Date().toISOString();
    await saveSyncState(syncState);

    return { total, synced, skipped, errors };
  }

  async function syncIncremental(options) {
    const { captureHandler, onProgress } = options;

    let orgId;
    try {
      orgId = await getOrgId();
    } catch (err) {
      throw new Error(`Cannot sync: ${err.message}`);
    }

    const conversations = await listConversations(orgId);
    const savedTimestamps = await loadSyncTimestamps();

    const changed = conversations.filter((conv) => {
      const lastSynced = savedTimestamps[conv.uuid];
      if (!lastSynced) return true;
      return conv.updated_at !== lastSynced;
    });

    const total = changed.length;
    let synced = 0;
    let skipped = 0;
    let errors = 0;
    const updatedTimestamps = { ...savedTimestamps };

    for (let i = 0; i < total; i++) {
      const conv = changed[i];

      if (onProgress) {
        onProgress(i + 1, total, conv.name || '(untitled)');
      }

      try {
        const result = await processOneConversation(orgId, conv, captureHandler);
        if (result && (result.status === 'skipped' || result.status === 'duplicate_fingerprint' || result.status === 'too_short' || result.status === 'restricted_blocked' || result.status === 'existing')) {
          skipped++;
        } else {
          synced++;
        }
        updatedTimestamps[conv.uuid] = conv.updated_at;
      } catch (err) {
        console.error(`[Open Brain Capture] Failed to sync conversation "${conv.name}":`, err);
        errors++;
      }

      if (i + 1 < total) {
        await sleep(BATCH_DELAY_MS);
      }
    }

    await saveSyncTimestamps(updatedTimestamps);
    const syncState = await loadSyncState();
    syncState.lastSyncAt = new Date().toISOString();
    await saveSyncState(syncState);

    return { total, synced, skipped, errors };
  }

  global.OBClaudeSync = {
    getOrgId,
    listConversations,
    getConversation,
    formatForIngest,
    syncAll,
    syncIncremental,
    loadSyncState,
    saveSyncState
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
