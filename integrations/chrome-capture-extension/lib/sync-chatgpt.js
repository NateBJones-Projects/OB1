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

  const BATCH_DELAY_MS = 200; // More conservative than Claude (ChatGPT has stricter rate limits)
  // Below Chrome's ~30s MV3 idle threshold — a 30s setTimeout sleep is a
  // 30s window for Chrome to kill the worker mid-run.
  const MAX_BACKOFF_MS = 20000;
  const PAGE_SIZE = 28; // ChatGPT's default page size
  const MAX_PAGES = 400; // Hard stop for pagination (~11k conversations)
  const MIN_CONVERSATION_LENGTH = 50;
  // Skip conversations updated within this window during incremental sync —
  // see sync-claude.js SETTLE_WINDOW_MS for rationale.
  const SETTLE_WINDOW_MS = 30 * 60 * 1000;
  const CURSOR_FLUSH_EVERY_N = 10;

  // Only these statuses advance the per-conversation cursor; see
  // sync-claude.js CURSOR_ADVANCE_STATUSES for rationale.
  const CURSOR_ADVANCE_STATUSES = new Set([
    'captured', 'complete', 'inserted', 'existing',
    'duplicate_fingerprint', 'skipped', 'too_short', 'restricted_blocked'
  ]);
  const SYNCED_STATUSES = new Set(['captured', 'complete', 'inserted']);

  let syncInFlight = false;

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
        const error = new Error(`ChatGPT API ${response.status}: ${body.slice(0, 200)}`);
        error.status = response.status;
        throw error;
      }
      const delayMs = backoffDelay(i);
      console.warn(`[Open Brain Capture] ChatGPT API returned ${response.status}, retrying in ${Math.round(delayMs)}ms (attempt ${i + 1}/${attempts})`);
      await sleep(delayMs);
    }
  }

  /**
   * Get access token from ChatGPT's session endpoint.
   * Uses the __Secure-next-auth.session-token cookie automatically via credentials: 'include'.
   */
  async function getAccessToken() {
    const response = await fetchWithRetry('https://chatgpt.com/api/auth/session', {
      method: 'GET',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' }
    });
    // Logged-out or challenge states can return 200 with an HTML page;
    // response.json() then throws a cryptic SyntaxError. Map both that and
    // a missing token to the one error the user can act on.
    let data;
    try {
      data = await response.json();
    } catch {
      data = null;
    }
    if (!data || !data.accessToken) {
      const error = new Error('Could not get ChatGPT access token. Are you logged in to chatgpt.com?');
      error.authExpired = true;
      throw error;
    }
    return data.accessToken;
  }

  function isAuthError(err) {
    return Boolean(err && (err.authExpired || err.status === 401 || err.status === 403));
  }

  async function markAuthExpired() {
    const state = await loadSyncState();
    state.authExpired = true;
    state.authExpiredAt = new Date().toISOString();
    await saveSyncState(state);
  }

  async function clearAuthExpired() {
    const state = await loadSyncState();
    if (state.authExpired) {
      delete state.authExpired;
      delete state.authExpiredAt;
      await saveSyncState(state);
    }
  }

  function authExpiredResult() {
    return {
      total: 0,
      synced: 0,
      skipped: 0,
      errors: 1,
      authExpired: true,
      error: 'ChatGPT session expired — open chatgpt.com, log in, then run a sync from the popup.'
    };
  }

  async function isPlatformEnabled() {
    try {
      const stored = await chrome.storage.sync.get({
        [OBConfig.STORAGE_KEYS.settings]: OBConfig.DEFAULT_SETTINGS
      });
      const merged = OBConfig.mergeSettings(stored[OBConfig.STORAGE_KEYS.settings]);
      return merged.enabledPlatforms.chatgpt !== false;
    } catch (err) {
      console.error('[Open Brain Capture] ChatGPT sync: failed to read settings, assuming enabled', err);
      return true;
    }
  }

  /**
   * List all conversations from ChatGPT, handling pagination.
   * Returns array of { id, title, create_time, update_time }.
   */
  async function listConversations(accessToken) {
    const all = [];
    let offset = 0;
    let hasMore = true;
    let pages = 0;

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

      // Forward-progress guards: the API has been observed to return
      // has_more=true with an empty page near archived/deleted ranges,
      // which would otherwise spin this loop forever at the same offset.
      if (items.length === 0) {
        break;
      }

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
      pages += 1;
      if (pages >= MAX_PAGES) {
        console.warn(`[Open Brain Capture] ChatGPT pagination stopped at ${pages} pages (${all.length} conversations) — raise MAX_PAGES if this is a real account size`);
        break;
      }

      if (hasMore) {
        await sleep(BATCH_DELAY_MS);
      }
    }

    return all;
  }

  /**
   * Get full conversation content including message tree.
   */
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

  /**
   * Flatten the ChatGPT message tree into chronological order.
   *
   * ChatGPT stores messages in a `mapping` object: { nodeId: { message, parent, children } }.
   * We walk backward from `current_node` to build the conversation chain.
   */
  function flattenMessageTree(mapping, currentNode) {
    if (!mapping || !currentNode) return [];

    // Walk backward from current_node to root via parent pointers
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

    // Reverse to get chronological order
    chain.reverse();

    return chain;
  }

  /**
   * Extract text from a ChatGPT message's content.
   * Content has { content_type, parts[] }. We join the text parts.
   */
  function extractMessageText(message) {
    if (!message || !message.content) return '';

    const content = message.content;
    if (content.content_type === 'text' && Array.isArray(content.parts)) {
      return content.parts
        .filter((part) => typeof part === 'string')
        .join('\n')
        .trim();
    }

    // Fallback for other content types (code, image, etc.)
    if (Array.isArray(content.parts)) {
      return content.parts
        .filter((part) => typeof part === 'string')
        .join('\n')
        .trim();
    }

    return '';
  }

  /**
   * Convert Unix timestamp (float) to ISO string.
   */
  function unixToISO(timestamp) {
    if (!timestamp || typeof timestamp !== 'number') return '';
    return new Date(timestamp * 1000).toISOString();
  }

  /**
   * Format a conversation for the Open Brain capture pipeline.
   */
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

  // ── Storage ──────────────────────────────────────────────────────────────

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

  // ── Sync Operations ──────────────────────────────────────────────────────

  async function processOneConversation(accessToken, conv, captureHandler) {
    const fullConv = await getConversation(accessToken, conv.id);
    const formatted = formatForIngest(fullConv);

    if (!formatted.text || formatted.text.length < MIN_CONVERSATION_LENGTH) {
      return { status: 'skipped', reason: 'too_short' };
    }

    return captureHandler(formatted);
  }

  /**
   * Full sync: fetch all ChatGPT conversations and send each to the capture pipeline.
   */
  async function runConversationLoop(accessToken, conversations, savedTimestamps, captureHandler, onProgress) {
    const total = conversations.length;
    let synced = 0;
    let skipped = 0;
    let errors = 0;
    const updatedTimestamps = { ...savedTimestamps };

    for (let i = 0; i < total; i++) {
      const conv = conversations[i];

      if (onProgress) {
        onProgress(i + 1, total, conv.title || '(untitled)');
      }

      try {
        const result = await processOneConversation(accessToken, conv, captureHandler);
        // Persist cursor only on real success. result.ok === false means the
        // payload went to retry queue; persisting would cause incremental sync
        // to skip this conversation forever if retry later dead-letters.
        if (result && result.ok === false) {
          errors++;
        } else if (result && CURSOR_ADVANCE_STATUSES.has(result.status)) {
          if (SYNCED_STATUSES.has(result.status)) {
            synced++;
          } else {
            skipped++;
          }
          updatedTimestamps[conv.id] = String(conv.update_time);
        } else {
          console.warn(`[Open Brain Capture] ChatGPT sync: not advancing cursor for "${conv.title}" (status=${result?.status || 'none'})`);
          errors++;
        }
      } catch (err) {
        console.error(`[Open Brain Capture] Failed to sync ChatGPT conversation "${conv.title}":`, err);
        errors++;
        if (isAuthError(err)) {
          await saveSyncTimestamps(updatedTimestamps);
          await markAuthExpired();
          return { total, synced, skipped, errors, authExpired: true, aborted: true };
        }
      }

      if ((i + 1) % CURSOR_FLUSH_EVERY_N === 0) {
        await saveSyncTimestamps(updatedTimestamps);
      }

      if (i + 1 < total) {
        await sleep(BATCH_DELAY_MS);
      }
    }

    await saveSyncTimestamps(updatedTimestamps);
    return { total, synced, skipped, errors };
  }

  async function finishRun(result) {
    const syncState = await loadSyncState();
    syncState.lastSyncAt = new Date().toISOString();
    await saveSyncState(syncState);
    return result;
  }

  async function syncAll(options) {
    const { captureHandler, onProgress } = options;

    if (syncInFlight) {
      return { total: 0, synced: 0, skipped: 0, errors: 0, inFlight: true, error: 'ChatGPT sync already running' };
    }
    if (!(await isPlatformEnabled())) {
      return { total: 0, synced: 0, skipped: 0, errors: 0, disabled: true, error: 'ChatGPT capture is disabled in settings' };
    }

    syncInFlight = true;
    try {
      let accessToken;
      let conversations;
      try {
        accessToken = await getAccessToken();
        conversations = await listConversations(accessToken);
      } catch (err) {
        if (isAuthError(err)) {
          await markAuthExpired();
          return authExpiredResult();
        }
        throw err;
      }
      await clearAuthExpired();

      // Merge into existing cursors so interrupted runs and conversations
      // missing from this listing don't drop other cursors.
      const savedTimestamps = await loadSyncTimestamps();
      const result = await runConversationLoop(accessToken, conversations, savedTimestamps, captureHandler, onProgress);
      return finishRun(result);
    } finally {
      syncInFlight = false;
    }
  }

  /**
   * Incremental sync: only fetch conversations that changed since last sync.
   */
  async function syncIncremental(options) {
    const { captureHandler, onProgress } = options;

    if (syncInFlight) {
      return { total: 0, synced: 0, skipped: 0, errors: 0, inFlight: true, error: 'ChatGPT sync already running' };
    }
    if (!(await isPlatformEnabled())) {
      return { total: 0, synced: 0, skipped: 0, errors: 0, disabled: true, error: 'ChatGPT capture is disabled in settings' };
    }

    syncInFlight = true;
    try {
      let accessToken;
      let conversations;
      try {
        accessToken = await getAccessToken();
        conversations = await listConversations(accessToken);
      } catch (err) {
        if (isAuthError(err)) {
          await markAuthExpired();
          return authExpiredResult();
        }
        throw err;
      }
      await clearAuthExpired();

      const savedTimestamps = await loadSyncTimestamps();

      // Changed conversations that have also settled (update_time is unix
      // seconds) — see sync-claude.js for the near-duplicate rationale.
      const now = Date.now();
      const changed = conversations.filter((conv) => {
        const lastSynced = savedTimestamps[conv.id];
        if (lastSynced && String(conv.update_time) === lastSynced) return false;
        const updatedMs = Number(conv.update_time) * 1000;
        if (Number.isFinite(updatedMs) && now - updatedMs < SETTLE_WINDOW_MS) return false;
        return true;
      });

      const result = await runConversationLoop(accessToken, changed, savedTimestamps, captureHandler, onProgress);
      return finishRun(result);
    } finally {
      syncInFlight = false;
    }
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
