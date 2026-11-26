import { assert, assertEquals, assertStringIncludes } from "jsr:@std/assert@^1";
import { buildServer } from "../lib/tools.ts";
import { chatReply, embeddingReply, axisVector, FakeFetch } from "./helpers/fake_fetch.ts";
import { FakeStore } from "./helpers/fake_store.ts";
import { inMemoryClient } from "./helpers/mcp.ts";

const BASE = "http://model.test/v1";
const GOOD_ENV: Record<string, string> = {
  EMBEDDING_API_BASE: BASE,
  EMBEDDING_MODEL: "embed-1",
  CHAT_MODEL: "chat-1",
};

interface Rig {
  env: Record<string, string | undefined>;
  fake: FakeFetch;
  store: FakeStore;
  // deno-lint-ignore no-explicit-any
  client: any;
}

/** A server over the real config, client and metadata modules; only the model server and database are fake. */
async function rig(env: Record<string, string | undefined> = GOOD_ENV, script = true): Promise<Rig> {
  const e = { ...env };
  const fake = new FakeFetch();
  if (script) {
    fake.on("POST", `${BASE}/embeddings`, embeddingReply(axisVector(0)));
    fake.on("POST", `${BASE}/chat/completions`, chatReply('{"topics":["alpha"],"type":"idea"}'));
  }
  const store = new FakeStore();
  const client = await inMemoryClient(buildServer({ getEnv: (n) => e[n], modelFetch: fake.fetch, store }));
  return { env: e, fake, store, client };
}

// deno-lint-ignore no-explicit-any
function textOf(result: any): string {
  return result.content.map((c: { text: string }) => c.text).join("\n");
}

Deno.test("U100 tools/list returns exactly the six tools named as core", async () => {
  const { client } = await rig();
  const { tools } = await client.listTools();
  assertEquals(
    tools.map((t: { name: string }) => t.name).sort(),
    ["capture_thought", "fetch", "list_thoughts", "search", "search_thoughts", "thought_stats"],
  );
});
