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
    // apiEndpoint moved to chrome.storage.local alongside apiKey — both are
    // per-device and must not follow the user's Google account across
    // profiles. See README Security section for rationale.
    apiEndpoint: 'ob_capture_api_endpoint',
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
   * Privacy posture (post REVIEW BLOCKER fix):
   *   - apiKey AND apiEndpoint now both live in chrome.storage.local only.
   *     Neither follows the user's Google account across devices. This
   *     avoids leaking the endpoint to loaner Chromebooks / shared profiles
   *     and sidesteps chrome.storage.sync's 8KB-per-item / 100KB-total
   *     quota, which can reject silently for long URLs + settings.
   *   - Non-secret preferences (platform toggles, captureMode,
   *     minResponseLength) still live in chrome.storage.sync so they
   *     follow the user. If sync is disabled or over quota we fall back
   *     to local-only transparently.
   */
  async function getConfig() {
    const [syncStored, localStored, localSettings] = await Promise.all([
      chrome.storage.sync.get({
        [STORAGE_KEYS.settings]: DEFAULT_SETTINGS
      }).catch(() => ({ [STORAGE_KEYS.settings]: DEFAULT_SETTINGS })),
      chrome.storage.local.get({
        [STORAGE_KEYS.apiKey]: '',
        [STORAGE_KEYS.apiEndpoint]: ''
      }),
      // Fallback local-only settings blob (used when sync is unavailable).
      chrome.storage.local.get({
        [STORAGE_KEYS.settings]: null
      })
    ]);

    const syncSettings = mergeSettings(syncStored[STORAGE_KEYS.settings]);
    const localApiKey = String(localStored[STORAGE_KEYS.apiKey] || '').trim();
    const localApiEndpoint = String(localStored[STORAGE_KEYS.apiEndpoint] || '').trim();
    const localFallbackSettings = localSettings[STORAGE_KEYS.settings];

    // Migrate legacy installs where the API key lived in sync storage.
    if (!localApiKey && syncSettings.apiKey) {
      try {
        await Promise.all([
          chrome.storage.local.set({
            [STORAGE_KEYS.apiKey]: syncSettings.apiKey
          }),
          chrome.storage.sync.set({
            [STORAGE_KEYS.settings]: {
              ...syncSettings,
              apiKey: '',
              apiEndpoint: ''
            }
          })
        ]);
      } catch (err) {
        console.warn('[Open Brain Capture] Legacy key migration hit storage error', err);
      }
    }

    // Migrate legacy installs where the API endpoint lived in sync storage.
    // After this migration, sync keeps a blank apiEndpoint and the real
    // value lives in chrome.storage.local only.
    if (!localApiEndpoint && syncSettings.apiEndpoint) {
      try {
        await Promise.all([
          chrome.storage.local.set({
            [STORAGE_KEYS.apiEndpoint]: syncSettings.apiEndpoint
          }),
          chrome.storage.sync.set({
            [STORAGE_KEYS.settings]: {
              ...syncSettings,
              apiEndpoint: '',
              apiKey: ''
            }
          })
        ]);
      } catch (err) {
        console.warn('[Open Brain Capture] Legacy endpoint migration hit storage error', err);
      }
    }

    // If sync storage was empty or unavailable and we have a local
    // fallback settings blob, prefer the local one (covers policy-managed
    // profiles and QUOTA_BYTES failures that forced a fallback at setConfig time).
    const baseSettings = (!syncStored[STORAGE_KEYS.settings] ||
      syncStored[STORAGE_KEYS.settings] === DEFAULT_SETTINGS) && localFallbackSettings
        ? mergeSettings(localFallbackSettings)
        : syncSettings;

    return mergeSettings({
      ...baseSettings,
      apiEndpoint: localApiEndpoint || baseSettings.apiEndpoint || '',
      apiKey: localApiKey || baseSettings.apiKey || ''
    });
  }

  /**
   * Persist a configuration update. Writes:
   *   - apiKey + apiEndpoint to chrome.storage.local (private, per-device)
   *   - everything else to chrome.storage.sync (so toggles follow the user)
   * If sync writes fail (QUOTA_BYTES, managed policy, disabled sync) we
   * fall back to writing the non-secret settings blob to chrome.storage.local
   * so the extension keeps working instead of silently dropping saves.
   */
  async function setConfig(partial) {
    const current = await getConfig();
    const merged = mergeSettings({ ...current, ...(partial || {}) });

    // Always write secrets to local first — this must not fail silently.
    await chrome.storage.local.set({
      [STORAGE_KEYS.apiKey]: merged.apiKey,
      [STORAGE_KEYS.apiEndpoint]: merged.apiEndpoint
    });

    const nonSecretSettings = {
      ...merged,
      apiKey: '',
      apiEndpoint: ''
    };

    try {
      await chrome.storage.sync.set({
        [STORAGE_KEYS.settings]: nonSecretSettings
      });
      // If we previously wrote a local fallback copy, it's fine to leave it —
      // getConfig() prefers sync when present. Overwriting the fallback on
      // success would just be tidy-up and risks an extra failure vector.
    } catch (err) {
      // Typical causes: QUOTA_BYTES_PER_ITEM, enterprise policy disables
      // sync, or the user signed out of Chrome sync. Fall back to local.
      console.warn(
        '[Open Brain Capture] chrome.storage.sync.set failed, falling back to local-only',
        err
      );
      await chrome.storage.local.set({
        [STORAGE_KEYS.settings]: nonSecretSettings
      });
    }

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
