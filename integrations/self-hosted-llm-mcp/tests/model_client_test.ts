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
