// Endpoint tests for classify-edges.mjs. A tiny local http server stands in
// for a self-hosted router (serving /chat/completions) and for an Anthropic
// proxy (serving /v1/messages). We assert the URL, auth header and payload
// shape that reach the server for each provider / base-URL combination,
// and that the public hosts are never contacted once a base URL is set.
//
// The default-URL cases (no override set) stub globalThis.fetch so the
// suite proves the backward-compatible URLs without touching the network.
//
// Run:  node --test recipes/typed-edge-classifier/test/*.test.mjs

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";

import { callAnthropic, callAnthropicOnce, loadEnv } from "../classify-edges.mjs";

const BASE = {
  OPEN_BRAIN_URL: "https://example.supabase.co",
  OPEN_BRAIN_SERVICE_KEY: "service-role-placeholder",
};

const PUBLIC_HOSTS = ["openrouter.ai", "api.anthropic.com"];

// ── fake router ───────────────────────────────────────────────────────────

const received = []; // every request the local server saw
let server;
let origin;

function readBody(req) {
  return new Promise((resolve) => {
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => resolve(data));
  });
}

before(async () => {
  server = http.createServer(async (req, res) => {
    const text = await readBody(req);
    let body = null;
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
    received.push({ method: req.method, url: req.url, headers: req.headers, body });

    // Model names of the form "status-NNN" make the server answer with that
    // status so the error/retry paths can be exercised. "flaky-once" fails
    // with 500 the first time it is seen and succeeds afterwards.
    const model = body && typeof body === "object" ? body.model : "";
    const forced = /^status-(\d{3})$/.exec(model || "");
    if (forced) {
      res.writeHead(Number(forced[1]), { "content-type": "application/json" });
      res.end(JSON.stringify({ error: { message: `forced ${forced[1]}` } }));
      return;
    }
    if (model === "flaky-once" && !server.flakyTripped) {
      server.flakyTripped = true;
      res.writeHead(500, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: { message: "transient" } }));
      return;
    }

    if (req.url === "/chat/completions") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          choices: [{ message: { role: "assistant", content: '{"worth_classifying": true, "hunch": "supports"}' } }],
          usage: { prompt_tokens: 11, completion_tokens: 7 },
        }),
      );
      return;
    }
    if (req.url === "/v1/messages") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          content: [{ type: "text", text: '{"relation": "supports", "direction": "A_to_B", "confidence": 0.9}' }],
          usage: { input_tokens: 13, output_tokens: 5 },
        }),
      );
      return;
    }
    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: { message: `no route for ${req.url}` } }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
});

/**
 * Run fn with globalThis.fetch wrapped so every outbound URL is recorded.
 * `handler`, when given, replaces the network entirely and must return a
 * Response; otherwise the real fetch is used (only ever hits our server).
 */
async function withFetchSpy(fn, handler) {
  const urls = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    urls.push(String(url));
    if (handler) return handler(String(url), init);
    return realFetch(url, init);
  };
  try {
    return { result: await fn(), urls };
  } finally {
    globalThis.fetch = realFetch;
  }
}

function assertNoPublicHost(urls) {
  for (const u of urls) {
    for (const host of PUBLIC_HOSTS) {
      assert.ok(!u.includes(host), `public host ${host} was contacted: ${u}`);
    }
  }
}

function lastRequest() {
  return received[received.length - 1];
}

function jsonResponse(status, body) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

// ── generic path against a self-hosted router ─────────────────────────────

test("LLM_BASE_URL: generic path posts to <base>/chat/completions with LLM_API_KEY and an untouched model", async () => {
  const env = loadEnv({ ...BASE, LLM_BASE_URL: `${origin}/`, LLM_API_KEY: "router-token" });
  const { result, urls } = await withFetchSpy(() =>
    callAnthropicOnce(env, "router-haiku", "SYSTEM PROMPT", "USER MESSAGE", 128),
  );

  assert.deepEqual(urls, [`${origin}/chat/completions`]);
  assertNoPublicHost(urls);

  const req = lastRequest();
  assert.equal(req.method, "POST");
  assert.equal(req.url, "/chat/completions");
  assert.equal(req.headers.authorization, "Bearer router-token");
  assert.equal(req.headers["content-type"], "application/json");
  assert.equal(req.headers["x-api-key"], undefined, "Anthropic auth header must not leak onto the generic path");

  assert.deepEqual(req.body, {
    model: "router-haiku", // no anthropic/ prefix: this is not openrouter.ai
    max_tokens: 128,
    messages: [
      { role: "system", content: "SYSTEM PROMPT" },
      { role: "user", content: "USER MESSAGE" },
    ],
  });

  assert.deepEqual(result, {
    raw: '{"worth_classifying": true, "hunch": "supports"}',
    inTokens: 11,
    outTokens: 7,
  });
});

test("LLM_BASE_URL: bare Anthropic default names are NOT prefixed for a non-OpenRouter host", async () => {
  const env = loadEnv({ ...BASE, LLM_BASE_URL: origin, LLM_API_KEY: "router-token" });
  await withFetchSpy(() => callAnthropicOnce(env, "claude-opus-4-7", "s", "u", 512));
  assert.equal(lastRequest().body.model, "claude-opus-4-7");
});

test("LLM_BASE_URL: OPENROUTER_API_KEY is accepted as the bearer token when LLM_API_KEY is unset", async () => {
  const env = loadEnv({ ...BASE, LLM_BASE_URL: origin, OPENROUTER_API_KEY: "legacy-token" });
  const { urls } = await withFetchSpy(() => callAnthropicOnce(env, "alias", "s", "u", 64));
  assertNoPublicHost(urls);
  assert.equal(lastRequest().headers.authorization, "Bearer legacy-token");
  assert.equal(lastRequest().body.model, "alias");
});

test("LLM_BASE_URL: an explicit LLM_PROVIDER=openrouter uses the generic path even with an Anthropic key present", async () => {
  const env = loadEnv({
    ...BASE,
    LLM_PROVIDER: "openrouter",
    LLM_BASE_URL: origin,
    LLM_API_KEY: "router-token",
    ANTHROPIC_API_KEY: "ant-key",
  });
  const { urls } = await withFetchSpy(() => callAnthropicOnce(env, "alias", "s", "u", 64));
  assert.deepEqual(urls, [`${origin}/chat/completions`]);
});

// ── direct path against a custom Anthropic base URL ───────────────────────

test("ANTHROPIC_BASE_URL: direct path posts to <base>/v1/messages with x-api-key and the Messages payload", async () => {
  const env = loadEnv({ ...BASE, ANTHROPIC_API_KEY: "ant-key", ANTHROPIC_BASE_URL: `${origin}/` });
  const { result, urls } = await withFetchSpy(() =>
    callAnthropicOnce(env, "claude-opus-4-7", "SYSTEM PROMPT", "USER MESSAGE", 512),
  );

  assert.deepEqual(urls, [`${origin}/v1/messages`]);
  assertNoPublicHost(urls);

  const req = lastRequest();
  assert.equal(req.method, "POST");
  assert.equal(req.url, "/v1/messages");
  assert.equal(req.headers["x-api-key"], "ant-key");
  assert.equal(req.headers["anthropic-version"], "2023-06-01");
  assert.equal(req.headers["content-type"], "application/json");
  assert.equal(req.headers.authorization, undefined, "bearer header must not leak onto the direct path");

  assert.deepEqual(req.body, {
    model: "claude-opus-4-7", // direct path never prefixes
    max_tokens: 512,
    system: "SYSTEM PROMPT",
    messages: [{ role: "user", content: "USER MESSAGE" }],
  });

  assert.deepEqual(result, {
    raw: '{"relation": "supports", "direction": "A_to_B", "confidence": 0.9}',
    inTokens: 13,
    outTokens: 5,
  });
});

test("ANTHROPIC_BASE_URL: explicit LLM_PROVIDER=anthropic ignores generic-path variables", async () => {
  const env = loadEnv({
    ...BASE,
    LLM_PROVIDER: "anthropic",
    ANTHROPIC_API_KEY: "ant-key",
    ANTHROPIC_BASE_URL: origin,
    LLM_BASE_URL: "http://should-not-be-used.invalid/v1",
    LLM_API_KEY: "unused",
  });
  const { urls } = await withFetchSpy(() => callAnthropicOnce(env, "claude-opus-4-7", "s", "u", 64));
  assert.deepEqual(urls, [`${origin}/v1/messages`]);
});

// ── default URLs (nothing overridden) — proves zero behaviour change ──────

test("defaults: OPENROUTER_API_KEY alone still targets openrouter.ai with the anthropic/ prefix", async () => {
  const env = loadEnv({ ...BASE, OPENROUTER_API_KEY: "or-key" });
  let seen;
  const { result, urls } = await withFetchSpy(
    () => callAnthropicOnce(env, "claude-haiku-4-5-20251001", "s", "u", 128),
    (url, init) => {
      seen = { url, init, body: JSON.parse(init.body) };
      return jsonResponse(200, {
        choices: [{ message: { content: "ok" } }],
        usage: { prompt_tokens: 1, completion_tokens: 2 },
      });
    },
  );
  assert.deepEqual(urls, ["https://openrouter.ai/api/v1/chat/completions"]);
  assert.equal(seen.init.method, "POST");
  assert.equal(seen.init.headers.authorization, "Bearer or-key");
  assert.equal(seen.body.model, "anthropic/claude-haiku-4-5-20251001");
  assert.equal(seen.body.max_tokens, 128);
  assert.equal(seen.body.messages[0].role, "system");
  assert.deepEqual(result, { raw: "ok", inTokens: 1, outTokens: 2 });
});

test("defaults: ANTHROPIC_API_KEY alone still targets api.anthropic.com/v1/messages", async () => {
  const env = loadEnv({ ...BASE, ANTHROPIC_API_KEY: "ant-key" });
  let seen;
  const { result, urls } = await withFetchSpy(
    () => callAnthropicOnce(env, "claude-opus-4-7", "s", "u", 512),
    (url, init) => {
      seen = { url, init, body: JSON.parse(init.body) };
      return jsonResponse(200, {
        content: [{ type: "text", text: "ok" }],
        usage: { input_tokens: 3, output_tokens: 4 },
      });
    },
  );
  assert.deepEqual(urls, ["https://api.anthropic.com/v1/messages"]);
  assert.equal(seen.init.headers["x-api-key"], "ant-key");
  assert.equal(seen.init.headers["anthropic-version"], "2023-06-01");
  assert.equal(seen.body.model, "claude-opus-4-7");
  assert.equal(seen.body.system, "s");
  assert.deepEqual(result, { raw: "ok", inTokens: 3, outTokens: 4 });
});

test("defaults: an explicit LLM_BASE_URL equal to the OpenRouter default still prefixes", async () => {
  const env = loadEnv({ ...BASE, LLM_BASE_URL: "https://openrouter.ai/api/v1", LLM_API_KEY: "or-key" });
  let model;
  await withFetchSpy(
    () => callAnthropicOnce(env, "claude-opus-4-7", "s", "u", 64),
    (url, init) => {
      model = JSON.parse(init.body).model;
      return jsonResponse(200, { choices: [{ message: { content: "ok" } }], usage: {} });
    },
  );
  assert.equal(model, "anthropic/claude-opus-4-7");
});

// ── error labelling and the shared retry policy ───────────────────────────

test("errors: a 4xx from a self-hosted router is labelled with its host and is not retryable", async () => {
  const env = loadEnv({ ...BASE, LLM_BASE_URL: origin, LLM_API_KEY: "k" });
  await assert.rejects(
    withFetchSpy(() => callAnthropicOnce(env, "status-400", "s", "u", 64)),
    (err) => {
      assert.match(err.message, new RegExp(`^LLM 127\\.0\\.0\\.1:${server.address().port} status-400: 400 `));
      assert.equal(err.status, 400);
      assert.equal(err.retryable, false);
      return true;
    },
  );
});

test("errors: 429 and 5xx from a self-hosted router are flagged retryable", async () => {
  const env = loadEnv({ ...BASE, LLM_BASE_URL: origin, LLM_API_KEY: "k" });
  for (const status of [429, 500, 503]) {
    await assert.rejects(
      withFetchSpy(() => callAnthropicOnce(env, `status-${status}`, "s", "u", 64)),
      (err) => err.status === status && err.retryable === true,
    );
  }
});

test("errors: the OpenRouter label is unchanged for the default host", async () => {
  const env = loadEnv({ ...BASE, OPENROUTER_API_KEY: "k" });
  await assert.rejects(
    withFetchSpy(
      () => callAnthropicOnce(env, "claude-opus-4-7", "s", "u", 64),
      () => jsonResponse(429, { error: { message: "slow down" } }),
    ),
    (err) => {
      assert.match(err.message, /^OpenRouter anthropic\/claude-opus-4-7: 429 /);
      assert.equal(err.retryable, true);
      return true;
    },
  );
});

test("errors: the Anthropic label is unchanged for the direct path", async () => {
  const env = loadEnv({ ...BASE, ANTHROPIC_API_KEY: "k", ANTHROPIC_BASE_URL: origin });
  await assert.rejects(
    withFetchSpy(() => callAnthropicOnce(env, "status-401", "s", "u", 64)),
    (err) => {
      assert.match(err.message, /^Anthropic status-401: 401 /);
      assert.equal(err.retryable, false);
      return true;
    },
  );
});

test("retry: callAnthropic gives up immediately on a non-retryable status (one request)", async () => {
  const env = loadEnv({ ...BASE, LLM_BASE_URL: origin, LLM_API_KEY: "k" });
  const { urls } = await withFetchSpy(async () => {
    await assert.rejects(callAnthropic(env, "status-400", "s", "u", 64), /400/);
  });
  assert.equal(urls.length, 1);
});

test("retry: callAnthropic retries a transient 5xx from the generic path and then succeeds", async () => {
  const env = loadEnv({ ...BASE, LLM_BASE_URL: origin, LLM_API_KEY: "k" });
  const origWarn = console.warn;
  const warns = [];
  console.warn = (...a) => warns.push(a.join(" "));
  try {
    const { result, urls } = await withFetchSpy(() => callAnthropic(env, "flaky-once", "s", "u", 64));
    assert.equal(urls.length, 2, "one failure, one success");
    assertNoPublicHost(urls);
    assert.equal(result.inTokens, 11);
    assert.equal(warns.length, 1);
    assert.match(warns[0], /LLM flaky-once 500: retry 1\/5/);
  } finally {
    console.warn = origWarn;
  }
});
