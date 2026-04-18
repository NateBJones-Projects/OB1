/**
 * Open Brain Capture — ChatGPT sync module.
 *
 * Fetches conversations from ChatGPT's internal API using the browser's
 * existing session, formats them as transcripts, and sends each through the
 * capture pipeline on the Open Brain REST API.
 *
 * API details discovered via:
 *   - https://github.com/pionxzh/chatgpt-exporter
 *   - https://github.com/gin337/ChatGPTReversed
 *
 * Endpoints:
 *   GET /api/auth/session -> { accessToken }
 *   GET /backend-api/conversations?offset=0&limit=28&order=updated -> { items, has_more }
 *   GET /backend-api/conversation/{id} -> { mapping, title, create_time, update_time, current_node }
 */
(function (global) {
  'use strict';

  const BATCH_DELAY_MS = 200;
  const MAX_BACKOFF_MS = 30000;
  const PAGE_SIZE = 28;
  const MIN_CONVERSATION_LENGTH = 50;

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function backoffDelay(attempt) {
    const base = Math.min(Math.pow(2, attempt) * 500, MAX_BACKOFF_MS);
    const jitter = Math.random() * 200;
    return base + jitter;
  }

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
        throw new Error(`ChatGPT API ${response.status}: ${body.slice(0, 200)}`);
      }
      console.warn(`[Open Brain Capture] ChatGPT API returned ${response.status}, retrying in ${Math.round(backoffDelay(i))}ms (attempt ${i + 1}/${attempts})`);
      await sleep(backoffDelay(i));
    }
  }

  async function getAccessToken() {
    const response = await fetchWithRetry('https://chatgpt.com/api/auth/session', {
      method: 'GET',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' }
    });
    const data = await response.json();
    if (!data.accessToken) {
      throw new Error('Could not get ChatGPT access token. Are you logged in to chatgpt.com?');
    }
    return data.accessToken;
  }

  async function listConversations(accessToken) {
    const all = [];
    let offset = 0;
    let hasMore = true;

    while (hasMore) {
      const url = `https://chatgpt.com/backend-api/conversations?offset=${offset}&limit=${PAGE_SIZE}&order=updated`;
      const response = await fetchWithRetry(url, {
        method: 'GET',
        credentials: 'include',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        }
      });
      const data = await response.json();
      const items = data.items || [];

      for (const conv of items) {
        all.push({
          id: conv.id,
          title: conv.title || '(untitled)',
          create_time: conv.create_time,
          update_time: conv.update_time
        });
      }

      hasMore = data.has_more === true;
      offset += items.length;

      if (hasMore) {
        await sleep(BATCH_DELAY_MS);
      }
    }

    return all;
  }

  async function getConversation(accessToken, conversationId) {
    const url = `https://chatgpt.com/backend-api/conversation/${conversationId}`;
    const response = await fetchWithRetry(url, {
      method: 'GET',
      credentials: 'include',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      }
    });
    return response.json();
  }

  function flattenMessageTree(mapping, currentNode) {
    if (!mapping || !currentNode) return [];

    const chain = [];
    let nodeId = currentNode;
    const visited = new Set();

    while (nodeId && mapping[nodeId] && !visited.has(nodeId)) {
      visited.add(nodeId);
      const node = mapping[nodeId];
      if (node.message && node.message.content) {
        chain.push(node.message);
      }
      nodeId = node.parent;
    }

    chain.reverse();
    return chain;
  }

  function extractMessageText(message) {
    if (!message || !message.content) return '';

    const content = message.content;
    if (content.content_type === 'text' && Array.isArray(content.parts)) {
      return content.parts
        .filter((part) => typeof part === 'string')
        .join('\n')
        .trim();
    }

    if (Array.isArray(content.parts)) {
      return content.parts
        .filter((part) => typeof part === 'string')
        .join('\n')
        .trim();
    }

    return '';
  }

  function unixToISO(timestamp) {
    if (!timestamp || typeof timestamp !== 'number') return '';
    return new Date(timestamp * 1000).toISOString();
  }

  function formatForIngest(conversation) {
    const title = conversation.title || '(untitled)';
    const createdAt = unixToISO(conversation.create_time);
    const convId = conversation.conversation_id || conversation.id || '';

    const messages = flattenMessageTree(conversation.mapping, conversation.current_node);
    const lines = [
      `Conversation title: ${title}`,
      createdAt ? `Conversation created at: ${createdAt}` : '',
      ''
    ];

    for (const msg of messages) {
      const role = msg.author?.role;
      if (!role || role === 'system' || role === 'tool') continue;

      const label = role === 'user' ? 'USER' : 'ASSISTANT';
      const text = extractMessageText(msg);
      if (text) {
        lines.push(`${label}: ${text}`);
        lines.push('');
      }
    }

    const fullText = lines.filter((l) => l !== undefined).join('\n').trim();

    return {
      text: fullText,
      platform: 'chatgpt',
      captureMode: 'sync',
      sourceType: 'chatgpt_import',
      sourceLabel: 'chatgpt:sync',
      sourceMetadata: {
        conversation_id: convId,
        conversation_title: title,
        page_url: `https://chatgpt.com/c/${convId}`,
        capture_mode: 'sync',
        export_tool: 'open_brain_capture_extension_sync'
      },
      autoExecute: true
    };
  }

  async function loadSyncTimestamps() {
    const key = OBConfig.STORAGE_KEYS.syncTimestampsChatGPT;
    const result = await chrome.storage.local.get({ [key]: {} });
    return result[key] || {};
  }

  async function saveSyncTimestamps(timestamps) {
    const key = OBConfig.STORAGE_KEYS.syncTimestampsChatGPT;
    await chrome.storage.local.set({ [key]: timestamps });
  }

  async function loadSyncState() {
    const key = OBConfig.STORAGE_KEYS.syncStateChatGPT;
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
    const key = OBConfig.STORAGE_KEYS.syncStateChatGPT;
    await chrome.storage.local.set({ [key]: state });
  }

  async function processOneConversation(accessToken, conv, captureHandler) {
    const fullConv = await getConversation(accessToken, conv.id);
    const formatted = formatForIngest(fullConv);

    if (!formatted.text || formatted.text.length < MIN_CONVERSATION_LENGTH) {
      return { status: 'skipped', reason: 'too_short' };
    }

    return captureHandler(formatted);
  }

  async function syncAll(options) {
    const { captureHandler, onProgress } = options;

    const accessToken = await getAccessToken();
    const conversations = await listConversations(accessToken);
    const total = conversations.length;
    let synced = 0;
    let skipped = 0;
    let errors = 0;
    const timestamps = {};

    for (let i = 0; i < total; i++) {
      const conv = conversations[i];

      if (onProgress) {
        onProgress(i + 1, total, conv.title || '(untitled)');
      }

      try {
        const result = await processOneConversation(accessToken, conv, captureHandler);
        // See REVIEW-CODEX P1 #1: failed ingests must NOT persist the
        // timestamp cursor, otherwise incremental sync skips them forever.
        if (result && result.ok === false) {
          errors++;
        } else if (result && (result.status === 'skipped' || result.status === 'duplicate_fingerprint' ||
            result.status === 'too_short' || result.status === 'restricted_blocked' || result.status === 'existing')) {
          skipped++;
          timestamps[conv.id] = String(conv.update_time);
        } else {
          synced++;
          timestamps[conv.id] = String(conv.update_time);
        }
      } catch (err) {
        console.error(`[Open Brain Capture] Failed to sync ChatGPT conversation "${conv.title}":`, err);
        errors++;
      }

      if (i + 1 < total) {
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

    const accessToken = await getAccessToken();
    const conversations = await listConversations(accessToken);
    const savedTimestamps = await loadSyncTimestamps();

    const changed = conversations.filter((conv) => {
      const lastSynced = savedTimestamps[conv.id];
      if (!lastSynced) return true;
      return String(conv.update_time) !== lastSynced;
    });

    const total = changed.length;
    let synced = 0;
    let skipped = 0;
    let errors = 0;
    const updatedTimestamps = { ...savedTimestamps };

    for (let i = 0; i < total; i++) {
      const conv = changed[i];

      if (onProgress) {
        onProgress(i + 1, total, conv.title || '(untitled)');
      }

      try {
        const result = await processOneConversation(accessToken, conv, captureHandler);
        // See REVIEW-CODEX P1 #1: failed ingests must NOT persist the
        // timestamp cursor, otherwise incremental sync skips them forever.
        if (result && result.ok === false) {
          errors++;
        } else if (result && (result.status === 'skipped' || result.status === 'duplicate_fingerprint' ||
            result.status === 'too_short' || result.status === 'restricted_blocked' || result.status === 'existing')) {
          skipped++;
          updatedTimestamps[conv.id] = String(conv.update_time);
        } else {
          synced++;
          updatedTimestamps[conv.id] = String(conv.update_time);
        }
      } catch (err) {
        console.error(`[Open Brain Capture] Failed to sync ChatGPT conversation "${conv.title}":`, err);
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

  global.OBChatGPTSync = {
    getAccessToken,
    listConversations,
    getConversation,
    flattenMessageTree,
    formatForIngest,
    syncAll,
    syncIncremental,
    loadSyncState,
    saveSyncState
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
