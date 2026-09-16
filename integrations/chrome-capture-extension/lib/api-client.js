(function (global) {
  'use strict';

  const REQUEST_TIMEOUT_MS = 15000;
  // Ingest runs server-side classification + embedding on full transcripts;
  // 15s aborts healthy-but-slow requests and feeds the retry queue (the
  // server keeps processing, so the client records a failure for content
  // that actually landed). Give it a much longer leash.
  const INGEST_TIMEOUT_MS = 120000;

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
    const timeoutMs = opts.timeoutMs || REQUEST_TIMEOUT_MS;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      let response;
      try {
        response = await fetch(url, {
          method: opts.method || 'GET',
          headers: {
            'Content-Type': 'application/json',
            'x-brain-key': apiKey,
            ...(opts.headers || {})
          },
          body: opts.body ? JSON.stringify(opts.body) : undefined,
          signal: controller.signal
        });
      } catch (err) {
        // AbortError surfaces as an opaque "The user aborted a request";
        // translate it so logs and the retry queue show the real cause.
        if (err && err.name === 'AbortError') {
          const timeoutError = new Error(`Request timed out after ${Math.round(timeoutMs / 1000)}s (${path})`);
          timeoutError.isTimeout = true;
          throw timeoutError;
        }
        throw err;
      }

      const responseText = await response.text().catch(() => '');
      if (!response.ok) {
        const httpError = new Error(`HTTP ${response.status}: ${parseErrorBody(responseText)}`);
        httpError.status = response.status;
        throw httpError;
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
      body: payload,
      timeoutMs: INGEST_TIMEOUT_MS
    });
  }

  // NOTE: /capture and /search helpers were dropped from the initial release
  // — the extension is a one-way capture source. If a future revision needs
  // to query Open Brain from the popup, reintroduce them here and wire
  // through apiFetch with the same auth pattern.

  global.OBApiClient = {
    REQUEST_TIMEOUT_MS,
    INGEST_TIMEOUT_MS,
    apiFetch,
    healthCheck,
    ingestDocument
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
