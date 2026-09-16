(function (global) {
  'use strict';

  const BATCH_DELAY_MS = 100;
  // Cap below Chrome's ~30s MV3 service-worker idle threshold: a setTimeout
  // sleep does not keep the worker alive, so a 30s backoff is a 30s window
  // for Chrome to kill the run.
  const MAX_BACKOFF_MS = 20000;
  // Skip conversations updated within this window during incremental sync.
  // Each capture re-ingests the full transcript with a new fingerprint, so
  // syncing a conversation the user is actively working in produces a
  // near-duplicate thought every 15-minute alarm tick. Waiting for the
  // conversation to settle captures it once instead.
  const SETTLE_WINDOW_MS = 30 * 60 * 1000;
  // Persist cursor progress every N conversations so an MV3 worker death
  // mid-run doesn't lose the whole run's bookkeeping.
  const CURSOR_FLUSH_EVERY_N = 10;

  // Statuses that mean "content is in the brain or intentionally excluded
  // by its content" — only these advance the per-conversation cursor.
  // Anything else (disabled_platform, manual_mode, unknown future statuses)
  // must NOT advance it, or the conversation is skipped forever once the
  // condition clears.
  const CURSOR_ADVANCE_STATUSES = new Set([
    'captured', 'complete', 'inserted', 'existing',
    'duplicate_fingerprint', 'skipped', 'too_short', 'restricted_blocked'
  ]);
  const SYNCED_STATUSES = new Set(['captured', 'complete', 'inserted']);

  // Guards against the 15-minute alarm firing while a popup-initiated run
  // is still in flight (concurrent runs double-fetch and race on cursors).
  let syncInFlight = false;

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
        const error = new Error(`Claude API ${response.status}: ${body.slice(0, 200)}`);
        error.status = response.status;
        throw error;
      }
      const delayMs = backoffDelay(i);
      console.warn(`[Open Brain Capture] Claude API returned ${response.status}, retrying in ${Math.round(delayMs)}ms (attempt ${i + 1}/${attempts})`);
      await sleep(delayMs);
    }
  }

  /**
   * Get the organization ID from the lastActiveOrg cookie on claude.ai.
   * Returns the decoded org ID string.
   */
  async function getOrgId() {
    const cookie = await chrome.cookies.get({
      url: 'https://claude.ai',
      name: 'lastActiveOrg'
    });
    if (!cookie || !cookie.value) {
      const error = new Error('Could not find lastActiveOrg cookie. Are you logged in to claude.ai?');
      error.authExpired = true;
      throw error;
    }
    return decodeURIComponent(cookie.value);
  }

  /**
   * Auth failures are permanent until the user logs back in. Repeating the
   * full sync (and its raw 401 error) every alarm tick is pure noise — the
   * caller persists this state and reports it once, quietly.
   */
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
      error: 'Claude session expired — open claude.ai, log in, then run a sync from the popup.'
    };
  }

  /**
   * Reads enabledPlatforms from extension settings. Sync must not run (and
   * must not advance cursors) while the platform is disabled.
   */
  async function isPlatformEnabled() {
    try {
      const stored = await chrome.storage.sync.get({
        [OBConfig.STORAGE_KEYS.settings]: OBConfig.DEFAULT_SETTINGS
      });
      const merged = OBConfig.mergeSettings(stored[OBConfig.STORAGE_KEYS.settings]);
      return merged.enabledPlatforms.claude !== false;
    } catch (err) {
      console.error('[Open Brain Capture] Claude sync: failed to read settings, assuming enabled', err);
      return true;
    }
  }

  /**
   * List all conversations (metadata only) from Claude.ai.
   * Returns array of { uuid, name, created_at, updated_at }.
   */
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

  /**
   * Get full conversation content including messages.
   */
  async function getConversation(orgId, uuid) {
    const url = `https://claude.ai/api/organizations/${orgId}/chat_conversations/${uuid}?tree=True&rendering_mode=messages&render_all_tools=true`;
    const response = await fetchWithRetry(url, {
      method: 'GET',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' }
    });
    return response.json();
  }

  /**
   * Extract plain text from a message's content blocks.
   * Content is an array of blocks; we extract text from 'text' type blocks.
   */
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

  /**
   * Flatten the message tree into an ordered array of messages.
   * The API returns chat_messages which may have a tree structure.
   * We walk children recursively to produce a flat, ordered transcript.
   */
  function flattenMessages(conversation) {
    const messages = conversation.chat_messages || [];

    // If messages appear flat (no nested children to worry about), return as-is
    // Sort by index or created_at to maintain order
    const sorted = [...messages].sort((a, b) => {
      if (typeof a.index === 'number' && typeof b.index === 'number') {
        return a.index - b.index;
      }
      return (a.created_at || '').localeCompare(b.created_at || '');
    });

    return sorted;
  }

  /**
   * Format a conversation object into the shape expected by the capture pipeline.
   * Returns { text, sourceLabel, sourceType, sourceMetadata, captureMode, platform, autoExecute }.
   */
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

  /**
   * Load sync timestamps from storage.
   * Returns a map of conversation UUID -> last synced updated_at.
   */
  async function loadSyncTimestamps() {
    const key = OBConfig.STORAGE_KEYS.syncTimestamps;
    const result = await chrome.storage.local.get({ [key]: {} });
    return result[key] || {};
  }

  /**
   * Save sync timestamps to storage.
   */
  async function saveSyncTimestamps(timestamps) {
    const key = OBConfig.STORAGE_KEYS.syncTimestamps;
    await chrome.storage.local.set({ [key]: timestamps });
  }

  /**
   * Load sync state (lastSyncAt, autoSyncEnabled, etc).
   */
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

  /**
   * Save sync state.
   */
  async function saveSyncState(state) {
    const key = OBConfig.STORAGE_KEYS.syncState;
    await chrome.storage.local.set({ [key]: state });
  }

  /**
   * Process a single conversation: fetch content, format, send through capture pipeline.
   * The captureHandler should be a function that accepts a capture message object
   * (same shape as processCaptureRequest expects).
   */
  async function processOneConversation(orgId, conv, captureHandler) {
    const fullConv = await getConversation(orgId, conv.uuid);
    const formatted = formatForIngest(fullConv);

    if (!formatted.text || formatted.text.length < 50) {
      return { status: 'skipped', reason: 'too_short' };
    }

    const result = await captureHandler(formatted);
    return result;
  }

  /**
   * Full sync: fetch all conversations from Claude.ai and send each to the capture pipeline.
   * options: { captureHandler, onProgress(current, total, convName) }
   * captureHandler: async function that processes a capture message (like processCaptureRequest).
   * Returns { total, synced, skipped, errors }.
   */
  async function runConversationLoop(orgId, conversations, savedTimestamps, captureHandler, onProgress) {
    const total = conversations.length;
    let synced = 0;
    let skipped = 0;
    let errors = 0;
    const updatedTimestamps = { ...savedTimestamps };

    for (let i = 0; i < total; i++) {
      const conv = conversations[i];

      if (onProgress) {
        onProgress(i + 1, total, conv.name || '(untitled)');
      }

      try {
        const result = await processOneConversation(orgId, conv, captureHandler);
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
          updatedTimestamps[conv.uuid] = conv.updated_at;
        } else {
          // Unknown or non-content status (disabled_platform, manual_mode,
          // future additions): count as an error and do NOT advance the
          // cursor, so the conversation is retried once the condition clears.
          console.warn(`[Open Brain Capture] Claude sync: not advancing cursor for "${conv.name}" (status=${result?.status || 'none'})`);
          errors++;
        }
      } catch (err) {
        console.error(`[Open Brain Capture] Failed to sync conversation "${conv.name}":`, err);
        errors++;
        if (isAuthError(err)) {
          // Session died mid-run; every remaining fetch will 401 too.
          await saveSyncTimestamps(updatedTimestamps);
          await markAuthExpired();
          return { total, synced, skipped, errors, authExpired: true, aborted: true };
        }
      }

      // Flush cursor progress periodically so an MV3 worker death mid-run
      // doesn't lose the whole run's bookkeeping.
      if ((i + 1) % CURSOR_FLUSH_EVERY_N === 0) {
        await saveSyncTimestamps(updatedTimestamps);
      }

      // Rate limiting between fetches
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
      return { total: 0, synced: 0, skipped: 0, errors: 0, inFlight: true, error: 'Claude sync already running' };
    }
    if (!(await isPlatformEnabled())) {
      return { total: 0, synced: 0, skipped: 0, errors: 0, disabled: true, error: 'Claude capture is disabled in settings' };
    }

    syncInFlight = true;
    try {
      let orgId;
      let conversations;
      try {
        orgId = await getOrgId();
        conversations = await listConversations(orgId);
      } catch (err) {
        if (isAuthError(err)) {
          await markAuthExpired();
          return authExpiredResult();
        }
        throw new Error(`Cannot sync: ${err.message}`);
      }
      await clearAuthExpired();

      // Merge into existing cursors (instead of replacing wholesale) so a
      // conversation missing from this listing — or an interrupted run —
      // never silently drops cursors for everything else.
      const savedTimestamps = await loadSyncTimestamps();
      const result = await runConversationLoop(orgId, conversations, savedTimestamps, captureHandler, onProgress);
      return finishRun(result);
    } finally {
      syncInFlight = false;
    }
  }

  /**
   * Incremental sync: only fetch conversations that changed since last sync.
   * options: { captureHandler, onProgress(current, total, convName) }
   * Returns { total, synced, skipped, errors }.
   */
  async function syncIncremental(options) {
    const { captureHandler, onProgress } = options;

    if (syncInFlight) {
      return { total: 0, synced: 0, skipped: 0, errors: 0, inFlight: true, error: 'Claude sync already running' };
    }
    if (!(await isPlatformEnabled())) {
      return { total: 0, synced: 0, skipped: 0, errors: 0, disabled: true, error: 'Claude capture is disabled in settings' };
    }

    syncInFlight = true;
    try {
      let orgId;
      let conversations;
      try {
        orgId = await getOrgId();
        conversations = await listConversations(orgId);
      } catch (err) {
        if (isAuthError(err)) {
          await markAuthExpired();
          return authExpiredResult();
        }
        throw new Error(`Cannot sync: ${err.message}`);
      }
      await clearAuthExpired();

      const savedTimestamps = await loadSyncTimestamps();

      // Only changed conversations — and only ones that have settled (not
      // updated within SETTLE_WINDOW_MS), so an actively-used conversation
      // is captured once when it goes quiet instead of every alarm tick.
      const now = Date.now();
      const changed = conversations.filter((conv) => {
        const lastSynced = savedTimestamps[conv.uuid];
        if (lastSynced && conv.updated_at === lastSynced) return false;
        const updatedMs = Date.parse(conv.updated_at);
        if (Number.isFinite(updatedMs) && now - updatedMs < SETTLE_WINDOW_MS) return false;
        return true;
      });

      const result = await runConversationLoop(orgId, changed, savedTimestamps, captureHandler, onProgress);
      return finishRun(result);
    } finally {
      syncInFlight = false;
    }
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
