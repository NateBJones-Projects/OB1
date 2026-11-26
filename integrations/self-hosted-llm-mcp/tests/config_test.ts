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

Deno.test("U10 OPENROUTER_API_KEY never substitutes for a missing embedding base", () => {
  const r = resolveConfig(envOf({
    OPENROUTER_API_KEY: "or-key",
    EMBEDDING_MODEL: "em",
    CHAT_MODEL: "cm",
  }));
  assert(!r.ok);
  assertEquals(r.missing, ["EMBEDDING_API_BASE"]);
  assert(!JSON.stringify(r).toLowerCase().includes("openrouter"));
});

Deno.test("U11 a trailing slash is removed from a base; a base without one is unchanged", () => {
  const a = ok({ ...MIN, EMBEDDING_API_BASE: "http://e:1/v1/", CHAT_API_BASE: "https://c/v1/" });
  assertEquals(a.embedding.base, "http://e:1/v1");
  assertEquals(a.chat.base, "https://c/v1");
  const b = ok({ ...MIN, EMBEDDING_API_BASE: "http://e:1/v1" });
  assertEquals(b.embedding.base, "http://e:1/v1");
  assertEquals(b.chat.base, "http://e:1/v1");
});

Deno.test("U12 http:// and https:// bases are both accepted", () => {
  for (const base of ["http://host:11434/v1", "https://host.example/v1"]) {
    const r = ok({ ...MIN, EMBEDDING_API_BASE: base, CHAT_API_BASE: base });
    assertEquals(r.embedding.base, base);
    assertEquals(r.chat.base, base);
  }
});

Deno.test("U13 a base without a scheme is invalid, names its setting, and is not missing", () => {
  const r = resolveConfig(envOf({ ...MIN, EMBEDDING_API_BASE: "ollama:11434/v1" }));
  assert(!r.ok);
  assertEquals(r.missing, []);
  assertEquals(r.invalid.length, 1);
  assertEquals(r.invalid[0].setting, "EMBEDDING_API_BASE");
  assert(r.invalid[0].reason.includes("http://") && r.invalid[0].reason.includes("https://"));
});

Deno.test("U14 an ftp:// base is invalid and names its setting", () => {
  const r = resolveConfig(envOf({ ...MIN, EMBEDDING_API_BASE: "ftp://host/v1" }));
  assert(!r.ok);
  assertEquals(r.invalid.map((i) => i.setting), ["EMBEDDING_API_BASE"]);
});

Deno.test("U15 an invalid chat base is reported under CHAT_API_BASE; an inherited invalid base once under EMBEDDING_API_BASE", () => {
  const own = resolveConfig(envOf({ ...MIN, CHAT_API_BASE: "chat:8080" }));
  assert(!own.ok);
  assertEquals(own.invalid.map((i) => i.setting), ["CHAT_API_BASE"]);
  const inherited = resolveConfig(envOf({ ...MIN, EMBEDDING_API_BASE: "embed:11434" }));
  assert(!inherited.ok);
  assertEquals(inherited.invalid.map((i) => i.setting), ["EMBEDDING_API_BASE"]);
});
