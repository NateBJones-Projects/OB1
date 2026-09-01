/**
 * Verifies the Open Brain MCP server exposes Atlas Cloud as an optional
 * OpenAI-compatible backend without changing OpenRouter as the default path.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./index.ts", import.meta.url), "utf8");

assert.match(source, /OPEN_BRAIN_AI_PROVIDER/, "provider selector env is documented in code");
assert.match(source, /atlascloud/, "Atlas Cloud selector is supported");
assert.match(source, /ATLASCLOUD_API_KEY/, "Atlas Cloud API key env is supported");
assert.match(source, /ATLAS_CLOUD_API_KEY/, "Atlas Cloud alias env is supported");
assert.match(source, /https:\/\/api\.atlascloud\.ai\/v1/, "Atlas Cloud base URL is configured");
assert.match(source, /qwen\/qwen3\.5-flash/, "Atlas Cloud chat default model is configured");
assert.match(source, /text-embedding-3-small/, "Atlas-compatible embedding default is configured");
assert.match(source, /openai\/gpt-4o-mini/, "OpenRouter default chat model is preserved");
assert.match(source, /openai\/text-embedding-3-small/, "OpenRouter default embedding model is preserved");
assert.match(source, /\$\{aiProvider\.baseUrl\}\/embeddings/, "embeddings use selected provider base URL");
assert.match(source, /\$\{aiProvider\.baseUrl\}\/chat\/completions/, "chat uses selected provider base URL");

console.log("AI provider config checks passed");
