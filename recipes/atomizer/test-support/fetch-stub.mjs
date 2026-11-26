/**
 * fetch-stub.mjs — test-only preload that replaces globalThis.fetch.
 *
 * Usage (from atomize-text.test.mjs):
 *   node --import ./test-support/fetch-stub.mjs test-atomize.mjs
 *
 * Lets the live sanity script run its "key present" path without touching
 * the network: the two provider endpoints return a canned two-atom answer,
 * and any other URL throws. Each stubbed call logs the host and the requested
 * model to stderr so tests can assert on it:
 *   [fetch-stub] api.anthropic.com model=claude-sonnet-5-5
 *
 * Not a test file: its name matches neither *.test.mjs nor test-*.mjs.
 */

const ATOMS = JSON.stringify(["a", "b"]);

function jsonResponse(payload) {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

globalThis.fetch = async (input, init = {}) => {
  const url = new URL(typeof input === "string" ? input : input.url);
  let model = "<none>";
  try {
    model = JSON.parse(init.body ?? "{}").model ?? "<none>";
  } catch {
    // leave model as <none>
  }

  if (url.host === "api.anthropic.com") {
    process.stderr.write(`[fetch-stub] ${url.host} model=${model}\n`);
    return jsonResponse({ content: [{ type: "text", text: ATOMS }] });
  }
  if (url.host === "openrouter.ai") {
    process.stderr.write(`[fetch-stub] ${url.host} model=${model}\n`);
    return jsonResponse({ choices: [{ message: { content: ATOMS } }] });
  }
  throw new Error(`fetch-stub: unexpected request to ${url.href}`);
};
