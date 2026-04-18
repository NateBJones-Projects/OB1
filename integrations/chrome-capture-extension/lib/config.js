(function (global) {
  'use strict';

  // Open Brain Capture — configuration module
  //
  // All user-specific values (API base URL, API key, per-platform toggles, etc.)
  // live in chrome.storage. There is deliberately NO hardcoded Supabase project
  // URL in this extension — the user supplies their own Open Brain REST API
  // gateway URL on the first-run config screen. Until configured, the service
  // worker refuses to make outbound requests and the popup surfaces a
  // "Configure Open Brain" call to action.

  const STORAGE_KEYS = {
    settings: 'ob_capture_settings',
    apiKey: 'ob_capture_api_key',
    captureLog: 'ob_capture_log',
    retryQueue: 'ob_capture_retry_queue',
    seenFingerprints: 'ob_capture_seen_fingerprints',
    syncTimestamps: 'ob_capture_sync_timestamps',
    syncState: 'ob_capture_sync_state',
    syncTimestampsChatGPT: 'ob_capture_sync_timestamps_chatgpt',
    syncStateChatGPT: 'ob_capture_sync_state_chatgpt'
  };

  // No default endpoint. Users MUST supply their own Open Brain REST API URL.
  // Shape example (Supabase-hosted):
  //   https://<your-project-ref>.supabase.co/functions/v1
  // Self-hosted alternative:
  //   https://brain.example.com
  const DEFAULT_SETTINGS = {
    apiEndpoint: '',
    apiKey: '',
    enabledPlatforms: {
      chatgpt: true,
      claude: true,
      gemini: true
    },
    captureMode: 'auto',
    minResponseLength: 100,
    autoSyncEnabled: false,
    autoSyncIntervalMinutes: 15
  };

  const PLATFORM_DEFINITIONS = {
    chatgpt: {
      id: 'chatgpt',
      label: 'ChatGPT',
      sourceTypes: {
        ambient: 'chatgpt_ambient',
        backfill: 'chatgpt_backfill',
        manual: 'chatgpt_manual'
      },
      matches: ['https://chatgpt.com/*', 'https://chat.openai.com/*']
    },
    claude: {
      id: 'claude',
      label: 'Claude',
      sourceTypes: {
        ambient: 'claude_ambient',
        backfill: 'claude_backfill',
        manual: 'claude_manual'
      },
      matches: ['https://claude.ai/*']
    },
    gemini: {
      id: 'gemini',
      label: 'Gemini',
      sourceTypes: {
        ambient: 'gemini_ambient',
        backfill: 'gemini_backfill',
        manual: 'gemini_manual'
      },
      matches: ['https://gemini.google.com/*']
    }
  };

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function mergeSettings(raw) {
    const merged = clone(DEFAULT_SETTINGS);
    const incoming = raw && typeof raw === 'object' ? raw : {};

    if (typeof incoming.apiEndpoint === 'string' && incoming.apiEndpoint.trim()) {
      merged.apiEndpoint = incoming.apiEndpoint.trim();
    }
    if (typeof incoming.apiKey === 'string') {
      merged.apiKey = incoming.apiKey.trim();
    }
    if (incoming.enabledPlatforms && typeof incoming.enabledPlatforms === 'object') {
      merged.enabledPlatforms = {
        ...merged.enabledPlatforms,
        ...incoming.enabledPlatforms
      };
    }
    if (incoming.captureMode === 'manual' || incoming.captureMode === 'auto') {
      merged.captureMode = incoming.captureMode;
    }
    if (Number.isFinite(Number(incoming.minResponseLength))) {
      merged.minResponseLength = Math.max(0, Number(incoming.minResponseLength));
    }

    return merged;
  }

  function buildRestBase(endpoint) {
    const trimmed = String(endpoint || '').replace(/\/+$/, '');
    if (!trimmed) {
      throw new Error(
        'Open Brain API URL is not configured. Click the extension icon and complete the Configure Open Brain screen.'
      );
    }
    return trimmed.endsWith('/open-brain-rest') ? trimmed : `${trimmed}/open-brain-rest`;
  }

  function getPlatformDefinition(platformId) {
    return PLATFORM_DEFINITIONS[platformId] || null;
  }

  function getSourceType(platformId, captureMode) {
    const platform = getPlatformDefinition(platformId);
    if (!platform) {
      return `${platformId || 'unknown'}_${captureMode || 'ambient'}`;
    }
    return platform.sourceTypes[captureMode] || `${platform.id}_${captureMode}`;
  }

  function resolvePlatformFromUrl(url) {
    if (!url) return null;
    for (const [id, def] of Object.entries(PLATFORM_DEFINITIONS)) {
      for (const pattern of def.matches) {
        const prefix = pattern.replace(/\*$/, '');
        if (url.startsWith(prefix)) return id;
      }
    }
    return null;
  }

  async function safe(label, fn, fallbackValue) {
    try {
      return await fn();
    } catch (error) {
      console.error(`[Open Brain Capture] ${label}`, error);
      return fallbackValue;
    }
  }

  /**
   * Read the full merged configuration from chrome.storage.
   *
   * The API key lives in chrome.storage.local (NOT chrome.storage.sync — sync
   * would replicate the key across every Chrome profile on the user's Google
   * account, which is a footgun). All non-secret settings live in
   * chrome.storage.sync so platform toggles, endpoint, and capture-mode
   * choices follow the user between devices.
   */
  async function getConfig() {
    const [syncStored, localStored] = await Promise.all([
      chrome.storage.sync.get({
        [STORAGE_KEYS.settings]: DEFAULT_SETTINGS
      }),
      chrome.storage.local.get({
        [STORAGE_KEYS.apiKey]: ''
      })
    ]);

    const syncSettings = mergeSettings(syncStored[STORAGE_KEYS.settings]);
    const localApiKey = String(localStored[STORAGE_KEYS.apiKey] || '').trim();

    // Migrate legacy installs that may have left the API key in sync storage.
    if (!localApiKey && syncSettings.apiKey) {
      await Promise.all([
        chrome.storage.local.set({
          [STORAGE_KEYS.apiKey]: syncSettings.apiKey
        }),
        chrome.storage.sync.set({
          [STORAGE_KEYS.settings]: {
            ...syncSettings,
            apiKey: ''
          }
        })
      ]);
    }

    return mergeSettings({
      ...syncSettings,
      apiKey: localApiKey || syncSettings.apiKey || ''
    });
  }

  /**
   * Persist a configuration update. Splits the secret apiKey into
   * chrome.storage.local and everything else into chrome.storage.sync.
   */
  async function setConfig(partial) {
    const current = await getConfig();
    const merged = mergeSettings({ ...current, ...(partial || {}) });

    await Promise.all([
      chrome.storage.sync.set({
        [STORAGE_KEYS.settings]: {
          ...merged,
          apiKey: ''
        }
      }),
      chrome.storage.local.set({
        [STORAGE_KEYS.apiKey]: merged.apiKey
      })
    ]);

    return merged;
  }

  /**
   * Returns true if the extension has enough configuration to make outbound
   * requests. Both the API base URL and the API key must be present.
   */
  function isConfigured(config) {
    if (!config) return false;
    return Boolean(String(config.apiEndpoint || '').trim() && String(config.apiKey || '').trim());
  }

  global.OBConfig = {
    DEFAULT_SETTINGS,
    PLATFORM_DEFINITIONS,
    STORAGE_KEYS,
    mergeSettings,
    buildRestBase,
    getPlatformDefinition,
    getSourceType,
    resolvePlatformFromUrl,
    safe,
    getConfig,
    setConfig,
    isConfigured
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
