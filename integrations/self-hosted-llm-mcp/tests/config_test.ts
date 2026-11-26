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
