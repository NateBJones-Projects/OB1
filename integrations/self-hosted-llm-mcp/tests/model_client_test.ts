import { assert, assertEquals, assertStringIncludes } from "jsr:@std/assert@^1";
import { createModelClient } from "../lib/model_client.ts";
import { EXTRACTION_PROMPT } from "../lib/metadata.ts";
import type { OkConfig } from "../lib/types.ts";
import { axisVector, chatReply, embeddingReply, FakeFetch, modelsReply } from "./helpers/fake_fetch.ts";

const EMB = "http://model.test/v1";
const CHAT = "http://model.test/v1";

function cfg(over: { embKey?: string; chatKey?: string; chatBase?: string; timeoutMs?: number } = {}): OkConfig {
  return {
    ok: true,
    embedding: { role: "embedding", base: EMB, model: "qwen3-embedding:4b", ...(over.embKey ? { key: over.embKey } : {}) },
    chat: { role: "chat", base: over.chatBase ?? CHAT, model: "qwen3:4b", ...(over.chatKey ? { key: over.chatKey } : {}) },
    timeoutMs: over.timeoutMs ?? 50,
    chatInherits: ["base"],
  };
}

Deno.test("U33 embed sends one POST /embeddings with model, input, dimensions 1536 and JSON content type", async () => {
  const ff = new FakeFetch().on("POST", `${EMB}/embeddings`, embeddingReply(axisVector(0)));
  await createModelClient(cfg(), ff.fetch).embed("hello");
  assertEquals(ff.requests.length, 1);
  const r = ff.requests[0];
  assertEquals(r.method, "POST");
  assertEquals(r.url, `${EMB}/embeddings`);
  assertEquals(r.body, { model: "qwen3-embedding:4b", input: "hello", dimensions: 1536 });
  assertEquals(r.headers["content-type"], "application/json");
});

Deno.test("U34 embed returns ok with the vector for a 2xx 1536-number reply", async () => {
  const v = axisVector(7);
  const ff = new FakeFetch().on("POST", `${EMB}/embeddings`, embeddingReply(v));
  const r = await createModelClient(cfg(), ff.fetch).embed("hello");
  assertEquals(r, { ok: true, value: v });
});

Deno.test("U35 chat sends one POST /chat/completions with model, json_object format and system+user messages", async () => {
  const ff = new FakeFetch().on("POST", `${CHAT}/chat/completions`, chatReply("{}"));
  await createModelClient(cfg(), ff.fetch).chat("my thought");
  assertEquals(ff.requests.length, 1);
  const r = ff.requests[0];
  assertEquals(r.method, "POST");
  assertEquals(r.url, `${CHAT}/chat/completions`);
  assertEquals(r.body, {
    model: "qwen3:4b",
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: EXTRACTION_PROMPT },
      { role: "user", content: "my thought" },
    ],
  });
  assertEquals(r.headers["content-type"], "application/json");
});

Deno.test("U36 chat returns ok with choices[0].message.content for a 2xx reply", async () => {
  const ff = new FakeFetch().on("POST", `${CHAT}/chat/completions`, chatReply('{"type":"idea"}'));
  const r = await createModelClient(cfg(), ff.fetch).chat("x");
  assertEquals(r, { ok: true, value: '{"type":"idea"}' });
});

Deno.test("U37 listModels sends one GET /models on the role's base", async () => {
  const ff = new FakeFetch().on("GET", `${EMB}/models`, modelsReply(["a"]));
  await createModelClient(cfg(), ff.fetch).listModels("embedding");
  assertEquals(ff.requests.length, 1);
  assertEquals(ff.requests[0].method, "GET");
  assertEquals(ff.requests[0].url, `${EMB}/models`);
  const ff2 = new FakeFetch().on("GET", "http://chat.test/v1/models", modelsReply(["a"]));
  await createModelClient(cfg({ chatBase: "http://chat.test/v1" }), ff2.fetch).listModels("chat");
  assertEquals(ff2.requests.map((r) => r.url), ["http://chat.test/v1/models"]);
});

Deno.test("U38 a role with a key sends Bearer on embed, chat and listModels", async () => {
  const ff = new FakeFetch()
    .on("POST", `${EMB}/embeddings`, embeddingReply(axisVector(0)))
    .on("POST", `${CHAT}/chat/completions`, chatReply("{}"))
    .on("GET", `${EMB}/models`, modelsReply([]));
  const c = createModelClient(cfg({ embKey: "sk-emb", chatKey: "sk-emb" }), ff.fetch);
  await c.embed("a");
  await c.chat("a");
  await c.listModels("embedding");
  assertEquals(ff.requests.length, 3);
  for (const r of ff.requests) assertEquals(r.headers["authorization"], "Bearer sk-emb");
});

Deno.test("U39 a role with no key sends no Authorization header at all", async () => {
  const ff = new FakeFetch()
    .on("POST", `${EMB}/embeddings`, embeddingReply(axisVector(0)))
    .on("POST", `${CHAT}/chat/completions`, chatReply("{}"))
    .on("GET", `${EMB}/models`, modelsReply([]));
  const c = createModelClient(cfg(), ff.fetch);
  await c.embed("a");
  await c.chat("a");
  await c.listModels("embedding");
  assertEquals(ff.requests.length, 3);
  for (const r of ff.requests) assert(!("authorization" in r.headers));
});

Deno.test("U40 each role sends its own key when the two keys differ", async () => {
  const ff = new FakeFetch()
    .on("POST", `${EMB}/embeddings`, embeddingReply(axisVector(0)))
    .on("POST", `${CHAT}/chat/completions`, chatReply("{}"))
    .on("GET", `${EMB}/models`, modelsReply([]));
  const c = createModelClient(cfg({ embKey: "sk-emb", chatKey: "sk-chat" }), ff.fetch);
  await c.embed("a");
  await c.chat("a");
  await c.listModels("embedding");
  await c.listModels("chat");
  assertEquals(ff.requests.map((r) => r.headers["authorization"]), [
    "Bearer sk-emb",
    "Bearer sk-chat",
    "Bearer sk-emb",
    "Bearer sk-chat",
  ]);
});

Deno.test("U41 every request goes to one of the two configured bases", async () => {
  const chatBase = "http://chat.test/v1";
  const ff = new FakeFetch()
    .on("POST", `${EMB}/embeddings`, embeddingReply(axisVector(0)))
    .on("POST", `${chatBase}/chat/completions`, chatReply("{}"))
    .on("GET", `${EMB}/models`, modelsReply([]))
    .on("GET", `${chatBase}/models`, modelsReply([]));
  const c = createModelClient(cfg({ chatBase }), ff.fetch);
  await c.embed("a");
  await c.chat("a");
  await c.listModels("embedding");
  await c.listModels("chat");
  assertEquals(ff.requests.length, 4);
  assertEquals(ff.unmatched.length, 0);
  for (const r of ff.requests) assert(r.url.startsWith(EMB + "/") || r.url.startsWith(chatBase + "/"), r.url);
});

Deno.test("U42 a rejected fetch gives unreachable naming role, base and 'could not be reached'", async () => {
  const ff = new FakeFetch()
    .on("POST", `${EMB}/embeddings`, { networkError: "connection refused" })
    .on("POST", `${CHAT}/chat/completions`, { networkError: "dns failure" });
  const c = createModelClient(cfg(), ff.fetch);
  for (const [role, r] of [["embedding", await c.embed("a")], ["chat", await c.chat("a")]] as const) {
    assert(!r.ok);
    assertEquals(r.kind, "unreachable");
    assertStringIncludes(r.message, role);
    assertStringIncludes(r.message, "http://model.test/v1");
    assertStringIncludes(r.message, "could not be reached");
  }
});

Deno.test("U43 a reply arriving inside timeoutMs is ok", async () => {
  const slow = async () => {
    await new Promise((r) => setTimeout(r, 10));
    return embeddingReply(axisVector(1));
  };
  const ff = new FakeFetch().on("POST", `${EMB}/embeddings`, slow).on("POST", `${CHAT}/chat/completions`, async () => {
    await new Promise((r) => setTimeout(r, 10));
    return chatReply("{}");
  });
  const c = createModelClient(cfg({ timeoutMs: 1000 }), ff.fetch);
  assert((await c.embed("a")).ok);
  assert((await c.chat("a")).ok);
});

Deno.test("U44 a hanging fetch gives timeout for either role naming role, base, ms and FETCH_TIMEOUT_MS", async () => {
  const ff = new FakeFetch()
    .on("POST", `${EMB}/embeddings`, { hang: true })
    .on("POST", `${CHAT}/chat/completions`, { hang: true });
  const c = createModelClient(cfg({ timeoutMs: 20 }), ff.fetch);
  for (const [role, r] of [["embedding", await c.embed("a")], ["chat", await c.chat("a")]] as const) {
    assert(!r.ok);
    assertEquals(r.kind, "timeout");
    assertStringIncludes(r.message, role);
    assertStringIncludes(r.message, "http://model.test/v1");
    assertStringIncludes(r.message, "20");
    assertStringIncludes(r.message, "FETCH_TIMEOUT_MS");
  }
});

Deno.test("U45 HTTP 401 and 403 each give auth_rejected naming role, base and 'access key rejected'", async () => {
  for (const status of [401, 403]) {
    const ff = new FakeFetch()
      .on("POST", `${EMB}/embeddings`, { status, body: { error: "nope" } })
      .on("POST", `${CHAT}/chat/completions`, { status, body: { error: "nope" } });
    const c = createModelClient(cfg(), ff.fetch);
    for (const [role, r] of [["embedding", await c.embed("a")], ["chat", await c.chat("a")]] as const) {
      assert(!r.ok);
      assertEquals(r.kind, "auth_rejected");
      assertStringIncludes(r.message, role);
      assertStringIncludes(r.message, "http://model.test/v1");
      assertStringIncludes(r.message, "access key rejected");
    }
  }
});

Deno.test("U46 HTTP 404 gives model_not_found naming role and model", async () => {
  const ff = new FakeFetch()
    .on("POST", `${EMB}/embeddings`, { status: 404, body: { error: "gone" } })
    .on("POST", `${CHAT}/chat/completions`, { status: 404, body: { error: "gone" } });
  const c = createModelClient(cfg(), ff.fetch);
  for (const [role, model, r] of [
    ["embedding", "qwen3-embedding:4b", await c.embed("a")],
    ["chat", "qwen3:4b", await c.chat("a")],
  ] as const) {
    assert(!r.ok);
    assertEquals(r.kind, "model_not_found");
    assertStringIncludes(r.message, role);
    assertStringIncludes(r.message, model);
  }
});

Deno.test("U47 a 400 or 422 body naming the model as unknown gives model_not_found", async () => {
  const bodies = [
    `model "qwen3-embedding:4b" not found, try pulling it first`,
    `Unknown model: qwen3-embedding:4b`,
    `The model qwen3-embedding:4b DOES NOT EXIST`,
  ];
  for (const status of [400, 422]) {
    for (const body of bodies) {
      const ff = new FakeFetch().on("POST", `${EMB}/embeddings`, { status, body: { error: body } });
      const r = await createModelClient(cfg(), ff.fetch).embed("a");
      assert(!r.ok);
      assertEquals(r.kind, "model_not_found", `${status} ${body}`);
      assertStringIncludes(r.message, "qwen3-embedding:4b");
      assertEquals(ff.requests.length, 1);
    }
  }
});

Deno.test("U48 HTTP 500 gives http_error naming role, status and server text", async () => {
  const ff = new FakeFetch()
    .on("POST", `${EMB}/embeddings`, { status: 500, body: "kaboom in the embedder" })
    .on("POST", `${CHAT}/chat/completions`, { status: 500, body: "kaboom in the chatter" });
  const c = createModelClient(cfg(), ff.fetch);
  for (const [role, text, r] of [
    ["embedding", "kaboom in the embedder", await c.embed("a")],
    ["chat", "kaboom in the chatter", await c.chat("a")],
  ] as const) {
    assert(!r.ok);
    assertEquals(r.kind, "http_error");
    assertStringIncludes(r.message, role);
    assertStringIncludes(r.message, "500");
    assertStringIncludes(r.message, text);
  }
});
