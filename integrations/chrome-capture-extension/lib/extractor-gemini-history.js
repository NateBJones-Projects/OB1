/**
 * Open Brain Capture — Gemini batchexecute history extractor (Phase B).
 *
 * Pure function. No chrome.* calls, no fetches. Takes the response body of a
 * Gemini batchexecute `rpcids=hNvQHb` call and returns an array of normalized
 * conversation turns (one per user/assistant exchange in the history).
 *
 * This is the history-load path — distinct from StreamGenerate (the live-turn
 * path). StreamGenerate pairs one request with one response; history load
 * returns every turn of an opened conversation in a single response frame.
 *
 * Durability: every access to Gemini's positional response shape is
 * type-guarded. Any unexpected input returns null/empty-array. We never throw
 * and never produce partial/garbage output.
 *
 * Important: this file lives in `lib/` and runs in the service-worker scope
 * (classic importScripts), NOT as a content script. It does not touch the
 * DOM. The DOM-based manual-capture extractor lives at
 * `content-scripts/extractor-gemini.js` and is unchanged by the Phase B/C
 * port.
 */

/* global self, TextEncoder, TextDecoder */

(function () {
  'use strict';

  const ANTI_XSSI_PREFIX = ')]}\'';
  const WHITESPACE_BYTES = new Set([0x0a, 0x0d, 0x20, 0x09]);
  const DIGIT_MIN = 0x30;
  const DIGIT_MAX = 0x39;
  // Length prefix is sometimes off by 1-2 bytes because HAR / some network
  // paths normalize \r\n -> \n. Try a small delta window around the hint
  // until JSON.parse succeeds. +/-5 proven sufficient across 44 frames in
  // the original research HAR fixtures.
  const FRAME_DELTA_WINDOW = [0, -1, -2, -3, 1, 2, 3, -4, -5, 4, 5];

  // ─── Response parsing helpers ──────────────────────────────────────────

  function stripLeadingPrefix(body) {
    const s = typeof body === 'string' ? body : '';
    const trimmed = s.replace(/^\s+/, '');
    if (trimmed.startsWith(ANTI_XSSI_PREFIX)) {
      return trimmed.slice(ANTI_XSSI_PREFIX.length).replace(/^\s+/, '');
    }
    return trimmed;
  }

  function decodeBytes(bytes, start, end) {
    const slice = bytes.slice(start, end);
    return new TextDecoder('utf-8', { fatal: false }).decode(slice);
  }

  function parseAdaptive(s, hintLen) {
    for (const delta of FRAME_DELTA_WINDOW) {
      const len = hintLen + delta;
      if (len < 1 || len > s.length) continue;
      try {
        const value = JSON.parse(s.slice(0, len).replace(/\s+$/, ''));
        return { value, consumed: len };
      } catch (_err) {
        // Try next delta
      }
    }
    return null;
  }

  function parseFramedResponse(body) {
    const bytes = new TextEncoder().encode(stripLeadingPrefix(body));
    const frames = [];
    let off = 0;

    while (off < bytes.length) {
      // Skip whitespace between frames
      while (off < bytes.length && WHITESPACE_BYTES.has(bytes[off])) off += 1;
      if (off >= bytes.length) break;

      // Read digit-length prefix
      let digitsEnd = off;
      while (digitsEnd < bytes.length && bytes[digitsEnd] >= DIGIT_MIN && bytes[digitsEnd] <= DIGIT_MAX) {
        digitsEnd += 1;
      }
      if (digitsEnd === off) break;

      const hintLen = Number(decodeBytes(bytes, off, digitsEnd));
      if (!Number.isFinite(hintLen) || hintLen <= 0) break;
      off = digitsEnd;
      if (bytes[off] === 0x0a) off += 1;

      const remaining = decodeBytes(bytes, off, bytes.length);
      const parsed = parseAdaptive(remaining, hintLen);
      if (!parsed) break;

      frames.push(parsed.value);
      // Advance by the byte length of the consumed string (encoder/decoder
      // roundtrip is stable for valid UTF-8).
      off += new TextEncoder().encode(remaining.slice(0, parsed.consumed)).length;
    }

    return frames;
  }

  // ─── History payload extraction ────────────────────────────────────────
  //
  // Envelope shape:
  //   Frame = ["wrb.fr", "hNvQHb", "<JSON>", null,null,null, "generic"]
  //   Decoded JSON = [ [turn, turn, ...], null, null, [] ]
  //     where each turn is:
  //       [0] = [conversationId, responseId]
  //       [2] = [[userPrompt], ...]          -- user prompt lives in response
  //       [3] = [[[candidate, ...], [timeSec, timeNanos]]]
  //              candidate[0]     = candidateId
  //              candidate[1][0]  = assistantText
  //              candidate[9]     = language
  //              candidate[near-end] = model (e.g. "3 Pro") -- heuristic scan

  /**
   * Extract one-or-more turns from a Gemini history-load response.
   *
   * @param {{ responseBody: string | null | undefined }} args
   * @returns {Array<object>|null} array of normalized turns, or null if the
   *   response wasn't a valid hNvQHb payload. Never throws.
   */
  function extractGeminiHistory(args) {
    try {
      if (!args || typeof args !== 'object') return null;
      const responseBody = typeof args.responseBody === 'string' ? args.responseBody : '';
      if (!responseBody) return null;

      const frames = parseFramedResponse(responseBody);
      if (!frames || frames.length === 0) return null;

      // Find the wrb.fr hNvQHb frame (there should be exactly one).
      for (const frame of frames) {
        if (!Array.isArray(frame) || !Array.isArray(frame[0])) continue;
        const entry = frame[0];
        if (entry[0] !== 'wrb.fr' || entry[1] !== 'hNvQHb' || typeof entry[2] !== 'string') continue;

        const turns = parseHistoryPayload(entry[2]);
        if (turns && turns.length > 0) return turns;
      }
      return null;
    } catch (_err) {
      return null;
    }
  }

  function parseHistoryPayload(payloadStr) {
    let nested;
    try {
      nested = JSON.parse(payloadStr);
    } catch (_err) {
      return null;
    }
    if (!Array.isArray(nested) || !Array.isArray(nested[0])) return null;

    const turnsArr = nested[0];
    const results = [];
    const capturedAt = new Date().toISOString();

    for (let i = 0; i < turnsArr.length; i += 1) {
      const turn = extractHistoryTurn(turnsArr[i], capturedAt);
      if (turn) {
        turn.historyOrder = i;
        results.push(turn);
      }
    }
    return results.length > 0 ? results : null;
  }

  function extractHistoryTurn(turn, fallbackCapturedAt) {
    if (!Array.isArray(turn)) return null;

    // Ids: [conversationId, responseId]
    const ids = Array.isArray(turn[0]) ? turn[0] : [];
    const conversationId = typeof ids[0] === 'string' ? ids[0] : '';
    const responseId = typeof ids[1] === 'string' ? ids[1] : '';
    if (!conversationId || !responseId) return null;

    // User prompt: turn[2][0][0]
    const promptSection = Array.isArray(turn[2]) ? turn[2] : null;
    const promptArr = promptSection && Array.isArray(promptSection[0]) ? promptSection[0] : null;
    const userPrompt = promptArr && typeof promptArr[0] === 'string' ? promptArr[0] : '';
    if (!userPrompt) return null;

    // Candidate: turn[3][0][0]
    const candidatesBlock = Array.isArray(turn[3]) ? turn[3] : null;
    const candidateSet = candidatesBlock && Array.isArray(candidatesBlock[0]) ? candidatesBlock[0] : null;
    const candidate = candidateSet && Array.isArray(candidateSet[0]) ? candidateSet[0] : null;
    if (!candidate) return null;

    const candidateId = typeof candidate[0] === 'string' ? candidate[0] : '';
    const textArr = Array.isArray(candidate[1]) ? candidate[1] : null;
    const assistantText = textArr && typeof textArr[0] === 'string' ? textArr[0] : '';
    const language = typeof candidate[9] === 'string' ? candidate[9] : '';
    if (!candidateId || !assistantText) return null;

    // Model: heuristic scan near the end of the candidate array for a string
    // matching Gemini model naming (e.g. "3 Pro", "2.5 Pro", "Flash", "Nano").
    let model = null;
    const start = Math.max(0, candidate.length - 15);
    for (let idx = candidate.length - 1; idx >= start; idx -= 1) {
      const val = candidate[idx];
      if (typeof val === 'string' && /^\d+(\.\d+)?\s?(Pro|Flash|Ultra|Nano)/i.test(val)) {
        model = val;
        break;
      }
    }

    // Original timestamp: candidateSet[1] = [seconds, nanos]
    let capturedAt = fallbackCapturedAt;
    const tsArr = Array.isArray(candidateSet[1]) ? candidateSet[1] : null;
    if (tsArr && typeof tsArr[0] === 'number' && typeof tsArr[1] === 'number') {
      const ms = tsArr[0] * 1000 + Math.floor(tsArr[1] / 1e6);
      if (Number.isFinite(ms) && ms > 0) {
        capturedAt = new Date(ms).toISOString();
      }
    }

    return {
      userPrompt,
      assistantText,
      conversationId,
      responseId,
      candidateId,
      language,
      model,
      capturedAt,
      historyOrder: -1 // set by parseHistoryPayload
    };
  }

  // ─── Exports ───────────────────────────────────────────────────────────

  self.OBGeminiHistoryExtractor = {
    extractGeminiHistory,
    // Exposed for fixture-based tests.
    _internal: {
      parseFramedResponse,
      parseAdaptive,
      stripLeadingPrefix,
      parseHistoryPayload,
      extractHistoryTurn
    }
  };
})();
