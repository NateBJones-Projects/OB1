/**
 * Open Brain Capture — content-script bridge.
 *
 * Listens for messages from the service worker and dispatches extraction
 * requests to the platform-specific extractor loaded alongside this script.
 * Each extractor registers itself via OBBridge.registerExtractor(name, handler).
 *
 * Message contract:
 *   Worker -> content script:  { type: 'EXTRACT_VISIBLE_RESPONSE' }
 *   Content script -> worker:  { ok: true, capture: { ... } }  or  { ok: false, error: '...' }
 */
(function () {
  'use strict';

  const extractors = {};

  const OBBridge = {
    registerExtractor(name, handler) {
      if (typeof handler !== 'function') {
        console.error(`[Open Brain Capture Bridge] Extractor "${name}" must be a function`);
        return;
      }
      extractors[name] = handler;
    }
  };

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!message || typeof message.type !== 'string') {
      return false;
    }
    if (message.type !== 'EXTRACT_VISIBLE_RESPONSE') {
      return false;
    }

    // The message channel can be gone by the time we respond (e.g. the
    // popup closed while an async extractor was still running), in which
    // case sendResponse throws. Swallow that — there is no one to answer.
    const respond = (payload) => {
      try {
        sendResponse(payload);
      } catch (err) {
        console.warn('[Open Brain Bridge] sendResponse failed (channel closed?)', err);
      }
    };

    const extractorNames = Object.keys(extractors);
    if (extractorNames.length === 0) {
      respond({ ok: false, error: 'No extractor registered for this page' });
      return false;
    }

    // Run the first registered extractor (one per content script bundle)
    const handler = extractors[extractorNames[0]];

    try {
      const result = handler();

      if (result && typeof result.then === 'function') {
        result
          .then((capture) => respond(capture))
          .catch((err) => respond({ ok: false, error: err.message || String(err) }));
        return true; // keep channel open for async
      }

      respond(result);
    } catch (err) {
      respond({ ok: false, error: err.message || String(err) });
    }

    return false;
  });

  // Expose for same-context extractor scripts
  self.__OBBridge = OBBridge;
})();
