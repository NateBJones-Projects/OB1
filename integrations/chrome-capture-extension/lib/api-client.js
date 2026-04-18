(function (global) {
  'use strict';

  const REQUEST_TIMEOUT_MS = 15000;

  function parseErrorBody(text) {
    if (!text) return 'Unknown error';
    try {
      const parsed = JSON.parse(text);
      return parsed.error || parsed.message || text;
    } catch {
      return text;
    }
  }

  async function apiFetch(path, options) {
    const opts = options || {};
    const apiKey = String(opts.apiKey || '').trim();
    if (!apiKey) {
      throw new Error('Missing x-brain-key API key. Open the extension popup and complete the Configure screen.');
    }

    const baseUrl = global.OBConfig.buildRestBase(opts.endpoint);
    const url = `${baseUrl}${path.startsWith('/') ? path : `/${path}`}`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), opts.timeoutMs || REQUEST_TIMEOUT_MS);

    try {
      const response = await fetch(url, {
        method: opts.method || 'GET',
        headers: {
          'Content-Type': 'application/json',
          'x-brain-key': apiKey,
          ...(opts.headers || {})
        },
        body: opts.body ? JSON.stringify(opts.body) : undefined,
        signal: controller.signal
      });

      const responseText = await response.text().catch(() => '');
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${parseErrorBody(responseText)}`);
      }

      if (!responseText) {
        return null;
      }

      try {
        return JSON.parse(responseText);
      } catch {
        return responseText;
      }
    } finally {
      clearTimeout(timeoutId);
    }
  }

  async function healthCheck(options) {
    return apiFetch('/health', {
      apiKey: options.apiKey,
      endpoint: options.endpoint,
      method: 'GET'
    });
  }

  async function ingestDocument(payload, options) {
    return apiFetch('/ingest', {
      apiKey: options.apiKey,
      endpoint: options.endpoint,
      method: 'POST',
      body: payload
    });
  }

  // NOTE: /capture and /search helpers were dropped from the initial release
  // — the extension is a one-way capture source. If a future revision needs
  // to query Open Brain from the popup, reintroduce them here and wire
  // through apiFetch with the same auth pattern.

  global.OBApiClient = {
    REQUEST_TIMEOUT_MS,
    apiFetch,
    healthCheck,
    ingestDocument
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
