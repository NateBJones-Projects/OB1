/**
 * Unit tests for the Gemini batchexecute history extractor (Phase B).
 *
 * The extractor in `../extractor-gemini-history.js` is a classic-script IIFE
 * (service worker land). We load it inside a small vm sandbox that supplies
 * `self`, `TextEncoder`, and `TextDecoder` globals, mirroring the SW runtime,
 * then exercise the exported API against synthesized batchexecute payloads.
 *
 * Coverage focuses on the shape guards codex called out as under-tested:
 *   - XSSI prefix handling
 *   - malformed / non-history frames
 *   - empty and multi-turn payloads
 *   - off-by-one length-prefix tolerance
 *
 * Run with: node --test lib/__tests__/extractor-gemini-history.test.js
 */

import test from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import vm from 'node:vm';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const helperPath = path.resolve(__dirname, '..', 'extractor-gemini-history.js');
const helperSource = readFileSync(helperPath, 'utf8');

function loadExtractor() {
  const sandbox = {
    console,
    setTimeout,
    clearTimeout,
    TextEncoder,
    TextDecoder
  };
  sandbox.self = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(helperSource, sandbox, { filename: helperPath });
  if (!sandbox.OBGeminiHistoryExtractor) {
    throw new Error('Helper did not attach OBGeminiHistoryExtractor to global');
  }
  return sandbox.OBGeminiHistoryExtractor;
}

const extractor = loadExtractor();

// ── helpers ────────────────────────────────────────────────────────────────

// Build a batchexecute-style framed response around a single wrb.fr entry.
// `rpcid` defaults to the history rpc. The encoded JSON frame is preceded
// by its byte-length and a newline — this is the real framed format.
function buildFrame(rpcid, payloadJson) {
  const innerFrame = JSON.stringify([['wrb.fr', rpcid, payloadJson, null, null, null, 'generic']]);
  const len = Buffer.byteLength(innerFrame, 'utf8');
  return ')]}\'\n' + String(len) + '\n' + innerFrame;
}

function buildHistoryPayload(turns) {
  // Matches the positional shape the extractor decodes: [ [turn, ...], null, null, [] ]
  return [turns, null, null, []];
}

function buildTurn({
  conversationId = 'c_abc123def456',
  responseId = 'r_xyz000',
  candidateId = 'cand-0',
  userPrompt = 'What is 2+2?',
  assistantText = '4',
  language = 'en',
  model = '3 Pro',
  tsSec = 1714694400,
  tsNanos = 0
}) {
  const candidate = [candidateId, [assistantText], null, null, null, null, null, null, null, language];
  // pad to make the model-scan heuristic find "3 Pro" within the last 15 entries
  while (candidate.length < 18) candidate.push(null);
  candidate.push(model);
  // Shape (from extractor comment): turn[3] = [[candidate, [tsSec, tsNanos]]]
  // The extractor reads candidateSet = turn[3][0], candidate_fields = candidateSet[0].
  // So the pair is [candidate, [ts]], not [[candidate], [ts]].
  const candidateSet = [candidate, [tsSec, tsNanos]];
  return [
    [conversationId, responseId],
    null,
    [[userPrompt]],
    [candidateSet]
  ];
}

// ── tests ──────────────────────────────────────────────────────────────────

test('extractGeminiHistory returns null for missing/empty input', () => {
  assert.equal(extractor.extractGeminiHistory(null), null);
  assert.equal(extractor.extractGeminiHistory({}), null);
  assert.equal(extractor.extractGeminiHistory({ responseBody: '' }), null);
  assert.equal(extractor.extractGeminiHistory({ responseBody: 123 }), null);
});

test('extractGeminiHistory returns null when no hNvQHb frame present', () => {
  const body = buildFrame('MaZiqc', JSON.stringify(buildHistoryPayload([buildTurn({})])));
  assert.equal(extractor.extractGeminiHistory({ responseBody: body }), null);
});

test('extractGeminiHistory returns null when payload json is malformed', () => {
  const body = ')]}\'\n17\n[["wrb.fr","hNvQHb","{not json"]]';
  // extractor wraps parse failures and returns null — no throw
  const result = extractor.extractGeminiHistory({ responseBody: body });
  assert.equal(result, null);
});

test('stripLeadingPrefix removes anti-XSSI prefix and leading whitespace', () => {
  const stripped = extractor._internal.stripLeadingPrefix(`  )]}\'\n  [1,2,3]`);
  assert.equal(stripped, '[1,2,3]');
});

test('stripLeadingPrefix is a no-op when prefix absent', () => {
  assert.equal(extractor._internal.stripLeadingPrefix('[1,2]'), '[1,2]');
});

test('extractGeminiHistory extracts a single turn with ids and text', () => {
  const turn = buildTurn({
    conversationId: 'c_abc123',
    responseId: 'r_zzz',
    candidateId: 'cand-0',
    userPrompt: 'hello',
    assistantText: 'hi back'
  });
  const body = buildFrame('hNvQHb', JSON.stringify(buildHistoryPayload([turn])));
  const turns = extractor.extractGeminiHistory({ responseBody: body });
  assert.equal(Array.isArray(turns), true);
  assert.equal(turns.length, 1);
  assert.equal(turns[0].conversationId, 'c_abc123');
  assert.equal(turns[0].responseId, 'r_zzz');
  assert.equal(turns[0].candidateId, 'cand-0');
  assert.equal(turns[0].userPrompt, 'hello');
  assert.equal(turns[0].assistantText, 'hi back');
  assert.equal(turns[0].historyOrder, 0);
});

test('extractGeminiHistory handles multi-turn payload with correct order', () => {
  const turns = [
    buildTurn({ conversationId: 'c_1', responseId: 'r1', candidateId: 'a', userPrompt: 'p1', assistantText: 'a1' }),
    buildTurn({ conversationId: 'c_1', responseId: 'r2', candidateId: 'b', userPrompt: 'p2', assistantText: 'a2' }),
    buildTurn({ conversationId: 'c_1', responseId: 'r3', candidateId: 'c', userPrompt: 'p3', assistantText: 'a3' })
  ];
  const body = buildFrame('hNvQHb', JSON.stringify(buildHistoryPayload(turns)));
  const result = extractor.extractGeminiHistory({ responseBody: body });
  assert.equal(result.length, 3);
  assert.equal(result[0].historyOrder, 0);
  assert.equal(result[1].historyOrder, 1);
  assert.equal(result[2].historyOrder, 2);
  assert.equal(result[0].responseId, 'r1');
  assert.equal(result[2].responseId, 'r3');
});

test('extractGeminiHistory drops turns with missing ids or empty text', () => {
  // conversationId present but userPrompt empty → dropped
  const bad = buildTurn({ userPrompt: '' });
  const good = buildTurn({ conversationId: 'c_ok', userPrompt: 'real', assistantText: 'real' });
  const body = buildFrame('hNvQHb', JSON.stringify(buildHistoryPayload([bad, good])));
  const result = extractor.extractGeminiHistory({ responseBody: body });
  assert.equal(result.length, 1);
  assert.equal(result[0].conversationId, 'c_ok');
});

test('extractGeminiHistory parses the historic timestamp when present', () => {
  const tsSec = 1700000000;
  const tsNanos = 123456789;
  const turn = buildTurn({ tsSec, tsNanos });
  const body = buildFrame('hNvQHb', JSON.stringify(buildHistoryPayload([turn])));
  const [out] = extractor.extractGeminiHistory({ responseBody: body });
  const expected = new Date(tsSec * 1000 + Math.floor(tsNanos / 1e6)).toISOString();
  assert.equal(out.capturedAt, expected);
});

test('extractGeminiHistory falls back to now() when timestamp missing', () => {
  const turn = buildTurn({ tsSec: 0, tsNanos: 0 });
  const body = buildFrame('hNvQHb', JSON.stringify(buildHistoryPayload([turn])));
  const [out] = extractor.extractGeminiHistory({ responseBody: body });
  // Just assert it's a valid ISO string; actual value is "now".
  assert.equal(typeof out.capturedAt, 'string');
  assert.equal(Number.isNaN(Date.parse(out.capturedAt)), false);
});

test('extractGeminiHistory never throws on random garbage input', () => {
  const samples = [
    'not a batchexecute response',
    ')]}\'\n',
    ')]}\'\n999\n{not json',
    ')]}\'\n5\n[1,2]',
    ')]}\'\n-1\n[]',
    ')]}\'\nabc\n[1]',
    Array.from({ length: 100 }, () => 'x').join('')
  ];
  for (const s of samples) {
    let threw = false;
    try {
      extractor.extractGeminiHistory({ responseBody: s });
    } catch (_err) {
      threw = true;
    }
    assert.equal(threw, false, `extractor threw on input: ${JSON.stringify(s).slice(0, 80)}`);
  }
});

test('parseAdaptive tolerates small length-prefix drift', () => {
  const payload = '[1,2,3]'; // 7 bytes
  // hint 6 (off by -1) should still parse because parseAdaptive slides +/- 5
  const result = extractor._internal.parseAdaptive(payload, 6);
  assert.ok(result);
  assert.deepEqual(result.value, [1, 2, 3]);
});

test('parseAdaptive returns null when no delta yields valid JSON', () => {
  const result = extractor._internal.parseAdaptive('{incomplete', 5);
  assert.equal(result, null);
});
