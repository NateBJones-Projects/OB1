(function () {
  'use strict';

  const endpointInput = document.getElementById('cfg-api-endpoint');
  const keyInput = document.getElementById('cfg-api-key');
  const saveBtn = document.getElementById('cfg-save-btn');
  const testBtn = document.getElementById('cfg-test-btn');
  const result = document.getElementById('cfg-result');

  function showResult(message, kind) {
    result.textContent = message;
    result.className = `result ${kind || ''}`.trim();
  }

  function normalizeEndpoint(value) {
    const trimmed = String(value || '').trim().replace(/\/+$/, '');
    if (!trimmed) return '';
    if (!/^https?:\/\//i.test(trimmed)) {
      throw new Error('API URL must start with http:// or https://');
    }
    return trimmed;
  }

  /**
   * Request runtime host permission for the user-supplied origin.
   *
   * Why this is necessary: we ship with zero host permissions for third-party
   * origins at install time — the user could put their brain anywhere (Supabase,
   * self-hosted, custom domain, localhost). Rather than ask for <all_urls> up
   * front (which is a red flag in the Chrome Web Store review queue and a
   * meaningful privacy risk), we declare the same pattern as optional_host_permissions
   * and request it dynamically once we know the URL.
   *
   * The prompt is a native Chrome dialog; the user must click "Allow".
   */
  async function ensureHostPermission(endpoint) {
    let origin;
    try {
      const url = new URL(endpoint);
      origin = `${url.protocol}//${url.host}/*`;
    } catch (err) {
      throw new Error(`Invalid URL: ${err.message}`);
    }

    const already = await chrome.permissions.contains({ origins: [origin] });
    if (already) return true;

    const granted = await chrome.permissions.request({ origins: [origin] });
    if (!granted) {
      throw new Error('Permission denied. Open Brain Capture needs access to this origin to send captures.');
    }
    return true;
  }

  async function loadExistingConfig() {
    const config = await OBConfig.getConfig();
    endpointInput.value = config.apiEndpoint || '';
    keyInput.value = config.apiKey || '';
  }

  async function saveConfig() {
    saveBtn.disabled = true;
    showResult('Saving...', '');

    try {
      const endpoint = normalizeEndpoint(endpointInput.value);
      const apiKey = String(keyInput.value || '').trim();

      if (!endpoint) {
        throw new Error('Enter your Open Brain REST API URL.');
      }
      if (!apiKey) {
        throw new Error('Enter your x-brain-key API key.');
      }

      await ensureHostPermission(endpoint);

      const response = await chrome.runtime.sendMessage({
        type: 'SAVE_CONFIG',
        config: {
          apiEndpoint: endpoint,
          apiKey
        }
      });

      if (!response || !response.ok) {
        throw new Error(response?.error || 'Failed to save configuration');
      }

      showResult('Saved. You can close this tab and use the extension popup.', 'success');
    } catch (err) {
      showResult(err.message, 'error');
    } finally {
      saveBtn.disabled = false;
    }
  }

  async function testConnection() {
    testBtn.disabled = true;
    showResult('Testing...', '');

    try {
      const endpoint = normalizeEndpoint(endpointInput.value);
      const apiKey = String(keyInput.value || '').trim();
      if (!endpoint || !apiKey) {
        throw new Error('Fill in both fields before testing.');
      }

      await ensureHostPermission(endpoint);

      const response = await chrome.runtime.sendMessage({
        type: 'TEST_CONNECTION',
        config: { apiEndpoint: endpoint, apiKey }
      });
      if (!response || !response.ok) {
        throw new Error(response?.error || 'Health check failed');
      }
      showResult(`Connected: ${response.result?.service || 'open-brain-rest'} is healthy`, 'success');
    } catch (err) {
      showResult(err.message, 'error');
    } finally {
      testBtn.disabled = false;
    }
  }

  saveBtn.addEventListener('click', saveConfig);
  testBtn.addEventListener('click', testConnection);

  loadExistingConfig().catch((err) => {
    console.error('[Open Brain Capture] Config page init failed', err);
    showResult(err.message, 'error');
  });
})();
