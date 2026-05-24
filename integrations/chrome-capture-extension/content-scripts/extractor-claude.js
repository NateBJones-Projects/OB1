/**
 * Open Brain Capture — Claude.ai extractor.
 *
 * DOM-only extraction of the most recent user/assistant message pair
 * from the Claude.ai conversation view. Used for manual capture
 * (popup button click), not passive interception.
 *
 * Selector strategy:
 *   1. Conversation turn wrappers when Claude exposes them
 *   2. Direct message-body selectors as a fallback for newer DOM layouts
 *   3. Open shadow-root traversal so manual capture survives UI refactors
 */
(function () {
  'use strict';

  const DOCUMENT_POSITION_PRECEDING = globalThis.Node?.DOCUMENT_POSITION_PRECEDING || 2;
  const DOCUMENT_POSITION_FOLLOWING = globalThis.Node?.DOCUMENT_POSITION_FOLLOWING || 4;
  const TURN_SELECTORS = [
    '[data-testid^="conversation-turn-"]',
    '[data-testid*="conversation-turn"]',
    'article[data-scroll-anchor]',
    '[class*="ConversationTurn"]',
    '[class*="message-row"]',
    '[class*="MessageRow"]'
  ];
  const HUMAN_MESSAGE_SELECTOR = [
    '[data-testid="user-message"]',
    '[data-testid*="user-message"]',
    '.font-user-message',
    '[data-testid*="human-message"]',
    '[data-testid*="human-turn"]'
  ].join(', ');
  const ASSISTANT_MESSAGE_SELECTOR = [
    '.font-claude-response',
    '.font-claude-response-body',
    '[data-testid="chat-message-text"]',
    '[data-testid*="chat-message-text"]',
    '[data-testid*="assistant-message"]',
    '[data-testid*="assistant-turn"]'
  ].join(', ');
  const MESSAGE_BODY_SELECTOR = `${ASSISTANT_MESSAGE_SELECTOR}, ${HUMAN_MESSAGE_SELECTOR}`;

  function dedupeElements(elements) {
    return Array.from(new Set(elements.filter(Boolean)));
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

  function collectSearchRoots(root = document) {
    const roots = [root];
    const visited = new Set([root]);
    const elements = root.querySelectorAll ? root.querySelectorAll('*') : [];

    for (const el of elements) {
      if (el.shadowRoot && !visited.has(el.shadowRoot)) {
        visited.add(el.shadowRoot);
        roots.push(el.shadowRoot);
      }
    }

    return roots;
  }

  function queryAllDeep(selector, root = document) {
    const matches = [];

    for (const searchRoot of collectSearchRoots(root)) {
      if (searchRoot !== document && searchRoot.matches && searchRoot.matches(selector)) {
        matches.push(searchRoot);
      }
      if (searchRoot.querySelectorAll) {
        matches.push(...searchRoot.querySelectorAll(selector));
      }
    }

    return dedupeElements(matches);
  }

  function getElementText(el) {
    return String(el?.innerText || el?.textContent || '').trim();
  }

  function isWithinComposer(el) {
    return Boolean(
      el.closest?.(
        'form, textarea, [contenteditable="true"], [data-testid*="composer"], [data-testid*="input"], footer'
      )
    );
  }

  function isMessageTextNode(el) {
    return Boolean(el?.matches?.(MESSAGE_BODY_SELECTOR));
  }

  function findTurnContainers() {
    for (const selector of TURN_SELECTORS) {
      const turns = sortByDocumentOrder(
        queryAllDeep(selector).filter((el) => !isWithinComposer(el) && getElementText(el))
      );
      if (turns.length > 0) {
        return turns;
      }
    }

    return [];
  }

  function classifyTurn(el) {
    const testId = el.getAttribute('data-testid') || '';
    if (/human|user/i.test(testId)) return 'human';
    if (/assistant|ai/i.test(testId)) return 'assistant';

    const cls = el.className || '';
    if (/human|user-message/i.test(cls)) return 'human';
    if (/assistant|claude-response/i.test(cls)) return 'assistant';

    if (queryAllDeep(HUMAN_MESSAGE_SELECTOR, el).length > 0) return 'human';
    if (queryAllDeep(ASSISTANT_MESSAGE_SELECTOR, el).length > 0) return 'assistant';

    const srOnly = el.querySelector?.('.sr-only, [class*="sr-only"]');
    if (srOnly) {
      const srText = getElementText(srOnly).toLowerCase();
      if (srText.includes('human') || srText.includes('you')) return 'human';
      if (srText.includes('assistant') || srText.includes('claude')) return 'assistant';
    }

    return 'unknown';
  }

  function extractTurnText(el) {
    if (isMessageTextNode(el)) {
      return getElementText(el);
    }

    const messageText = queryAllDeep(MESSAGE_BODY_SELECTOR, el)[0];
    if (messageText) {
      return getElementText(messageText);
    }

    const prose = queryAllDeep('.prose, [class*="markdown"], [class*="Message"], .font-claude-response-body', el)[0];
    if (prose) {
      return getElementText(prose);
    }

    const clone = el.cloneNode(true);
    clone
      .querySelectorAll?.('button, [role="toolbar"], [class*="action"], [class*="timestamp"], .sr-only')
      .forEach((child) => child.remove());
    return getElementText(clone);
  }

  function findDirectMessageCandidates() {
    return [
      ...queryAllDeep(HUMAN_MESSAGE_SELECTOR).map((el) => ({ role: 'human', el })),
      ...queryAllDeep(ASSISTANT_MESSAGE_SELECTOR).map((el) => ({ role: 'assistant', el }))
    ]
      .filter(({ el }) => !isWithinComposer(el) && getElementText(el))
      .filter(({ el }, index, all) => all.findIndex((entry) => entry.el === el) === index)
      .sort((a, b) => {
        if (a.el === b.el) return 0;
        const position = a.el.compareDocumentPosition(b.el);
        if (position & DOCUMENT_POSITION_PRECEDING) return 1;
        if (position & DOCUMENT_POSITION_FOLLOWING) return -1;
        return 0;
      });
  }

  function extractConversationId() {
    const match = window.location.pathname.match(/\/chat\/([a-f0-9-]+)/i);
    return match ? match[1] : null;
  }

  function extractVisibleResponse() {
    const turnCandidates = findTurnContainers()
      .map((el) => ({ role: classifyTurn(el), el }))
      .filter(({ role, el }) => role !== 'unknown' && getElementText(el));
    const candidates = turnCandidates.some(({ role }) => role === 'assistant')
      ? turnCandidates
      : findDirectMessageCandidates();

    if (candidates.length === 0) {
      return {
        ok: false,
        error: 'No conversation turns found on this page. Claude may have changed its DOM; refresh the tab and retry.'
      };
    }

    let lastAssistant = null;
    let lastHuman = null;

    for (let i = candidates.length - 1; i >= 0; i--) {
      const { role, el } = candidates[i];

      if (!lastAssistant && role === 'assistant') {
        lastAssistant = el;
        continue;
      }
      if (lastAssistant && !lastHuman && role === 'human') {
        lastHuman = el;
        break;
      }
    }

    if (!lastAssistant) {
      return { ok: false, error: 'No assistant response found in the conversation.' };
    }

    const assistantText = extractTurnText(lastAssistant);
    if (!assistantText) {
      return { ok: false, error: 'Assistant response is empty (may still be streaming).' };
    }

    const humanText = lastHuman ? extractTurnText(lastHuman) : null;
    const captureText = humanText
      ? `USER: ${humanText}\n\nASSISTANT: ${assistantText}`
      : `ASSISTANT: ${assistantText}`;
    const conversationId = extractConversationId();

    return {
      ok: true,
      capture: {
        platform: 'claude',
        captureMode: 'manual',
        text: captureText,
        assistantLength: assistantText.length,
        sourceLabel: 'claude:manual',
        sourceMetadata: {
          page_url: window.location.href,
          page_title: document.title,
          ...(conversationId ? { conversation_id: conversationId } : {})
        }
      }
    };
  }

  if (self.__OBBridge) {
    self.__OBBridge.registerExtractor('claude', extractVisibleResponse);
  } else {
    console.error('[Open Brain Capture] Bridge not loaded before extractor-claude.js');
  }
})();
