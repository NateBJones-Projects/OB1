/**
 * Open Brain Capture — Gemini extractor.
 *
 * DOM-only extraction of the most recent user/assistant message pair from
 * gemini.google.com. Used for manual capture (popup button click).
 *
 * Gemini's conversation UI uses Angular Material components; the user turn
 * lives in <user-query> and the model response in <model-response>. These
 * are Web Components with an open shadow root-free content projection, so
 * standard `querySelector` works.
 *
 * NOTE: Google rewrites Gemini's UI frequently — the selectors below have
 * been stable through the Gemini 1.x / 2.x transitions but may drift. The
 * extractor degrades gracefully: if neither selector matches, it returns
 * a clear "DOM changed" error rather than silently producing bad data.
 */
(function () {
  'use strict';

  const DOCUMENT_POSITION_PRECEDING = globalThis.Node?.DOCUMENT_POSITION_PRECEDING || 2;
  const DOCUMENT_POSITION_FOLLOWING = globalThis.Node?.DOCUMENT_POSITION_FOLLOWING || 4;
  const USER_SELECTORS = [
    'user-query',
    '[data-test-id="user-query"]',
    '[aria-label*="user message" i]'
  ].join(', ');
  const ASSISTANT_SELECTORS = [
    'model-response',
    '[data-test-id="model-response"]',
    '[aria-label*="model response" i]',
    '.model-response-text'
  ].join(', ');

  function getElementText(el) {
    return String(el?.innerText || el?.textContent || '').trim();
  }

  function isWithinComposer(el) {
    return Boolean(
      el.closest?.(
        'form, textarea, [contenteditable="true"], [data-test-id*="input"], footer, .input-container'
      )
    );
  }

  function sortByDocumentOrder(elements) {
    return [...elements].sort((a, b) => {
      if (a === b) return 0;
      const position = a.compareDocumentPosition(b);
      if (position & DOCUMENT_POSITION_PRECEDING) return 1;
      if (position & DOCUMENT_POSITION_FOLLOWING) return -1;
      return 0;
    });
  }

  function collectMessages() {
    const out = [];
    const userNodes = Array.from(document.querySelectorAll(USER_SELECTORS));
    const modelNodes = Array.from(document.querySelectorAll(ASSISTANT_SELECTORS));

    for (const el of userNodes) {
      if (!isWithinComposer(el) && getElementText(el)) {
        out.push({ role: 'user', el });
      }
    }
    for (const el of modelNodes) {
      if (!isWithinComposer(el) && getElementText(el)) {
        out.push({ role: 'assistant', el });
      }
    }

    return sortByDocumentOrder(out.map((entry) => entry.el))
      .map((el) => out.find((entry) => entry.el === el))
      .filter(Boolean);
  }

  function extractMessageText(el) {
    const prose = el.querySelector?.(
      '.message-content, .markdown, message-content, [class*="response-content"], [class*="prose"]'
    );
    if (prose) {
      return getElementText(prose);
    }
    const clone = el.cloneNode(true);
    clone
      .querySelectorAll?.('button, [role="toolbar"], [aria-hidden="true"], .sr-only, [class*="thinking"]')
      .forEach((n) => n.remove());
    return getElementText(clone);
  }

  function extractConversationId() {
    const match = window.location.pathname.match(/\/app\/([a-zA-Z0-9-]+)/);
    return match ? match[1] : null;
  }

  function extractVisibleResponse() {
    const messages = collectMessages();
    if (messages.length === 0) {
      return {
        ok: false,
        error: 'No Gemini messages found on this page. Google may have changed the Gemini DOM; refresh the tab and retry.'
      };
    }

    let lastAssistant = null;
    let lastUser = null;
    for (let i = messages.length - 1; i >= 0; i--) {
      const { role, el } = messages[i];
      if (!lastAssistant && role === 'assistant') {
        lastAssistant = el;
        continue;
      }
      if (lastAssistant && !lastUser && role === 'user') {
        lastUser = el;
        break;
      }
    }

    if (!lastAssistant) {
      return { ok: false, error: 'No Gemini model response found in the conversation.' };
    }

    const assistantText = extractMessageText(lastAssistant);
    if (!assistantText) {
      return { ok: false, error: 'Gemini response is empty (may still be generating).' };
    }

    const userText = lastUser ? extractMessageText(lastUser) : null;
    const captureText = userText
      ? `USER: ${userText}\n\nASSISTANT: ${assistantText}`
      : `ASSISTANT: ${assistantText}`;
    const conversationId = extractConversationId();

    return {
      ok: true,
      capture: {
        platform: 'gemini',
        captureMode: 'manual',
        text: captureText,
        assistantLength: assistantText.length,
        sourceLabel: 'gemini:manual',
        sourceMetadata: {
          page_url: window.location.href,
          page_title: document.title,
          ...(conversationId ? { conversation_id: conversationId } : {})
        }
      }
    };
  }

  if (self.__OBBridge) {
    self.__OBBridge.registerExtractor('gemini', extractVisibleResponse);
  } else {
    console.error('[Open Brain Capture] Bridge not loaded before extractor-gemini.js');
  }
})();
