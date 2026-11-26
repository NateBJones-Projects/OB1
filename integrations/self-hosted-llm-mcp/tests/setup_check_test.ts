import { assert, assertEquals, assertStringIncludes } from "jsr:@std/assert@^1";
import { runSetupCheck } from "../lib/setup_check.ts";
import type { CheckResult, Deps } from "../lib/types.ts";
import { axisVector, chatReply, embeddingReply, FakeFetch, modelsReply } from "./helpers/fake_fetch.ts";
import { FakeStore } from "./helpers/fake_store.ts";

const BASE = "http://model.test/v1";
const BASE_ENV: Record<string, string> = {
  EMBEDDING_API_BASE: BASE,
  EMBEDDING_MODEL: "emb-m",
  CHAT_MODEL: "chat-m",
};

/** A fake model server answering every route healthily, unless a route is registered first. */
function healthyFake(base = BASE): FakeFetch {
  return new FakeFetch()
    .on("GET", `${base}/models`, modelsReply(["emb-m", "chat-m"]))
    .on("POST", `${base}/embeddings`, embeddingReply(axisVector(0)))
    .on("POST", `${base}/chat/completions`, chatReply('{"type":"idea"}'));
}

function setup(env: Record<string, string> = BASE_ENV, fake: FakeFetch = healthyFake(), store = new FakeStore()) {
  const deps: Deps = { getEnv: (n) => env[n], modelFetch: fake.fetch, store };
  return { deps, fake, store };
}

function check(checks: CheckResult[], id: string): CheckResult {
  const c = checks.find((x) => x.id === id);
  assert(c, `check ${id} missing`);
  return c;
}

Deno.test("U146 a healthy configuration and server give ok true", async () => {
  const { deps } = setup();
  const report = await runSetupCheck(deps);
  assertEquals(report.ok, true);
});

Deno.test("U147 the report lists the seven checks in the contract's order, role checks carrying role", async () => {
  const { deps } = setup();
  const { checks } = await runSetupCheck(deps);
  assertEquals(checks.map((c) => [c.id, c.role]), [
    ["config", undefined],
    ["embedding_reachable", "embedding"],
    ["embedding_model", "embedding"],
    ["embedding_dimension", "embedding"],
    ["chat_reachable", "chat"],
    ["chat_model", "chat"],
    ["chat_metadata", "chat"],
  ]);
});
