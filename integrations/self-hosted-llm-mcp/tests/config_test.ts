import { assert, assertEquals } from "jsr:@std/assert@^1";
import { keyOverHttpWarnings, resolveConfig } from "../lib/config.ts";
import type { GetEnv, OkConfig } from "../lib/types.ts";

function envOf(vars: Record<string, string>): GetEnv {
  return (name) => vars[name];
}

const MIN = {
  EMBEDDING_API_BASE: "http://embed:11434/v1",
  EMBEDDING_MODEL: "embed-model",
  CHAT_MODEL: "chat-model",
};

function ok(vars: Record<string, string>): OkConfig {
  const r = resolveConfig(envOf(vars));
  assert(r.ok, `expected ok config, got ${JSON.stringify(r)}`);
  return r;
}

Deno.test("U1 all six settings set validly resolve as given with no inheritance", () => {
  const r = ok({
    EMBEDDING_API_BASE: "https://e.example/v1",
    EMBEDDING_API_KEY: "ek",
    EMBEDDING_MODEL: "em",
    CHAT_API_BASE: "https://c.example/v1",
    CHAT_API_KEY: "ck",
    CHAT_MODEL: "cm",
  });
  assertEquals(r.embedding, { role: "embedding", base: "https://e.example/v1", key: "ek", model: "em" });
  assertEquals(r.chat, { role: "chat", base: "https://c.example/v1", key: "ck", model: "cm" });
  assertEquals(r.chatInherits, []);
});

Deno.test("U2 only the three required settings: chat inherits the base, no keys", () => {
  const r = ok(MIN);
  assertEquals(r.embedding.base, "http://embed:11434/v1");
  assertEquals(r.chat.base, "http://embed:11434/v1");
  assertEquals(r.embedding.key, undefined);
  assertEquals(r.chat.key, undefined);
  assertEquals(r.chatInherits, ["base"]);
});

Deno.test("U3 chat inherits base and key when CHAT_API_BASE and CHAT_API_KEY are unset", () => {
  const r = ok({ ...MIN, EMBEDDING_API_KEY: "ek" });
  assertEquals(r.chat.key, "ek");
  assertEquals(r.chatInherits, ["base", "key"]);
});

Deno.test("U4 CHAT_API_BASE set without CHAT_API_KEY: chat has no key", () => {
  const r = ok({ ...MIN, EMBEDDING_API_KEY: "ek", CHAT_API_BASE: "http://chat:8080/v1" });
  assertEquals(r.chat.key, undefined);
  assertEquals(r.chat.base, "http://chat:8080/v1");
  assertEquals(r.chatInherits, []);
});

Deno.test("U5 CHAT_API_BASE and CHAT_API_KEY set: chat uses its own values", () => {
  const r = ok({ ...MIN, EMBEDDING_API_KEY: "ek", CHAT_API_BASE: "http://chat:8080/v1", CHAT_API_KEY: "ck" });
  assertEquals(r.chat.base, "http://chat:8080/v1");
  assertEquals(r.chat.key, "ck");
  assertEquals(r.chatInherits, []);
});

Deno.test("U6 nothing set: missing lists the three required settings in order", () => {
  const r = resolveConfig(envOf({}));
  assert(!r.ok);
  assertEquals(r.missing, ["EMBEDDING_API_BASE", "EMBEDDING_MODEL", "CHAT_MODEL"]);
});

Deno.test("U7 CHAT_MODEL unset with EMBEDDING_MODEL set: only CHAT_MODEL is missing", () => {
  const r = resolveConfig(envOf({ EMBEDDING_API_BASE: "http://e/v1", EMBEDDING_MODEL: "em" }));
  assert(!r.ok);
  assertEquals(r.missing, ["CHAT_MODEL"]);
});

Deno.test("U8 blank required settings are missing; a non-blank value is not", () => {
  for (const blank of ["", "   ", "\t \n"]) {
    const r = resolveConfig(envOf({ EMBEDDING_API_BASE: blank, EMBEDDING_MODEL: blank, CHAT_MODEL: blank }));
    assert(!r.ok);
    assertEquals(r.missing, ["EMBEDDING_API_BASE", "EMBEDDING_MODEL", "CHAT_MODEL"]);
  }
  const r = resolveConfig(envOf({ EMBEDDING_API_BASE: "http://e/v1", EMBEDDING_MODEL: "x", CHAT_MODEL: "x" }));
  assert(r.ok);
});

Deno.test("U9 blank CHAT_API_BASE or CHAT_API_KEY falls back as if unset", () => {
  const r = ok({ ...MIN, EMBEDDING_API_KEY: "ek", CHAT_API_BASE: "  ", CHAT_API_KEY: "" });
  assertEquals(r.chat.base, "http://embed:11434/v1");
  assertEquals(r.chat.key, "ek");
  assertEquals(r.chatInherits, ["base", "key"]);
  const own = ok({ ...MIN, EMBEDDING_API_KEY: "ek", CHAT_API_BASE: "http://c/v1", CHAT_API_KEY: " " });
  assertEquals(own.chat.key, undefined);
  assertEquals(own.chatInherits, []);
});
