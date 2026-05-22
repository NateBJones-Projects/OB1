/**
 * Open Brain Capture — ChatGPT extractor.
 *
 * DOM-only extraction of the most recent user/assistant message pair from the
 * chatgpt.com / chat.openai.com conversation view. Used for manual capture
 * (popup button click), not passive interception.
 *
 * ChatGPT's DOM has historically used `data-message-author-role` on each
 * message wrapper ("user" / "assistant") and `.markdown` inside the
 * assistant content. Both are best-effort — if OpenAI rewrites the
 * conversation UI the selectors below may need updating.
 */
(function () {
  'use strict';

  const DOCUMENT_POSITION_PRECEDING = globalThis.Node?.DOCUMENT_POSITION_PRECEDING || 2;
  const DOCUMENT_POSITION_FOLLOWING = globalThis.Node?.DOCUMENT_POSITION_FOLLOWING || 4;
  const USER_SELECTOR = [
    '[data-message-author-role="user"]',
    '[data-testid^="conversation-turn-"] [data-message-author-role="user"]'
  ].join(', ');
  const ASSISTANT_SELECTOR = [
    '[data-message-author-role="assistant"]',
    '[data-testid^="conversation-turn-"] [data-message-author-role="assistant"]'
  ].join(', ');
  const MESSAGE_BODY_SELECTOR = `${USER_SELECTOR}, ${ASSISTANT_SELECTOR}`;

  function getElementText(el) {
    return String(el?.innerText || el?.textContent || '').trim();
  }

  function isWithinComposer(el) {
    return Boolean(
      el.closest?.(
        'form, textarea, [contenteditable="true"], [data-testid*="composer"], [data-testid*="prompt"], footer'
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

  function collectAllMessages() {
    const messages = [];
    const userNodes = sortByDocumentOrder(Array.from(document.querySelectorAll(USER_SELECTOR)));
    const assistantNodes = sortByDocumentOrder(Array.from(document.querySelectorAll(ASSISTANT_SELECTOR)));

    for (const el of userNodes) {
      if (!isWithinComposer(el) && getElementText(el)) {
        messages.push({ role: 'user', el });
      }
    }
    for (const el of assistantNodes) {
      if (!isWithinComposer(el) && getElementText(el)) {
        messages.push({ role: 'assistant', el });
      }
    }

    return messages.sort((a, b) => {
      if (a.el === b.el) return 0;
      const position = a.el.compareDocumentPosition(b.el);
      if (position & DOCUMENT_POSITION_PRECEDING) return 1;
      if (position & DOCUMENT_POSITION_FOLLOWING) return -1;
      return 0;
    });
  }

  function extractMessageText(el) {
    // Prefer the dedicated markdown container if present — it strips chrome.
    const markdown = el.querySelector?.('.markdown, [class*="markdown"]');
    if (markdown) {
      return getElementText(markdown);
    }
    const clone = el.cloneNode(true);
    clone.querySelectorAll?.('button, [role="toolbar"], [data-testid*="copy"], .sr-only').forEach((n) => n.remove());
    return getElementText(clone);
  }

  function extractConversationId() {
    const match = window.location.pathname.match(/\/c\/([a-zA-Z0-9-]+)/);
    return match ? match[1] : null;
  }

  function extractVisibleResponse() {
    const messages = collectAllMessages();
    if (messages.length === 0) {
      return {
        ok: false,
        error: 'No ChatGPT messages found on this page. OpenAI may have changed its DOM; refresh the tab and retry.'
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
      return { ok: false, error: 'No assistant response found in the conversation.' };
    }

    const assistantText = extractMessageText(lastAssistant);
    if (!assistantText) {
      return { ok: false, error: 'Assistant response is empty (may still be streaming).' };
    }

    const userText = lastUser ? extractMessageText(lastUser) : null;
    const captureText = userText
      ? `USER: ${userText}\n\nASSISTANT: ${assistantText}`
      : `ASSISTANT: ${assistantText}`;
    const conversationId = extractConversationId();

    return {
      ok: true,
      capture: {
        platform: 'chatgpt',
        captureMode: 'manual',
        text: captureText,
        assistantLength: assistantText.length,
        sourceLabel: 'chatgpt:manual',
        sourceMetadata: {
          page_url: window.location.href,
          page_title: document.title,
          ...(conversationId ? { conversation_id: conversationId } : {})
        }
      }
    };
  }

  if (self.__OBBridge) {
    self.__OBBridge.registerExtractor('chatgpt', extractVisibleResponse);
  } else {
    console.error('[Open Brain Capture] Bridge not loaded before extractor-chatgpt.js');
  }
})();
