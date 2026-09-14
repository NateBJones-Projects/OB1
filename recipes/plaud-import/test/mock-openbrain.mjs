#!/usr/bin/env node
/**
 * mock-openbrain.mjs — a throwaway local stand-in for Supabase PostgREST and an
 * OpenAI-compatible embeddings endpoint.
 *
 * It exists so the import path (insert, 409-dedup, PATCH, DELETE-purge,
 * embedding call) can be exercised end-to-end without touching a real brain and
 * without spending a cent on API calls. Nothing here is production code.
 *
 * Usage:
 *   node test/mock-openbrain.mjs --port 8787
 *
 *   SUPABASE_URL=http://127.0.0.1:8787 \
 *   SUPABASE_SERVICE_ROLE_KEY=mock \
 *   OPENAI_API_KEY=mock \
 *   EMBEDDING_BASE_URL=http://127.0.0.1:8787/v1 \
 *   node import-plaud.mjs fixtures --no-llm --state-dir /tmp/plaud-state
 *
 * Extra endpoints:
 *   GET  /__stats  → counts and the rows it holds
 *   POST /__reset  → clear all rows
 */

import http from "node:http";
import { randomUUID } from "node:crypto";

const portArgIndex = process.argv.indexOf("--port");
const PORT = portArgIndex > -1 ? Number(process.argv[portArgIndex + 1]) : 8787;

/** fingerprint -> row (this is the UNIQUE partial index on content_fingerprint) */
const byFingerprint = new Map();
/** id -> row */
const byId = new Map();
const recordings = new Map();
let embeddingCalls = 0;
let chatCalls = 0;

function send(res, status, body) {
  const payload = body === undefined ? "" : JSON.stringify(body);
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(payload);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => { data += chunk; });
    req.on("end", () => {
      if (!data) return resolve(null);
      try {
        resolve(JSON.parse(data));
      } catch (err) {
        reject(err);
      }
    });
    req.on("error", reject);
  });
}

function matchesContains(metadata, filter) {
  if (filter === null || typeof filter !== "object") return metadata === filter;
  if (metadata === null || typeof metadata !== "object") return false;
  for (const [key, value] of Object.entries(filter)) {
    if (!matchesContains(metadata[key], value)) return false;
  }
  return true;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const { pathname } = url;

  try {
    if (pathname === "/__stats") {
      return send(res, 200, {
        thoughts: byId.size,
        parents: [...byId.values()].filter((r) => r.metadata?.plaud?.role === "parent").length,
        atoms: [...byId.values()].filter((r) => r.metadata?.plaud?.role === "atom").length,
        tiers: [...byId.values()].reduce((acc, r) => {
          acc[r.sensitivity_tier] = (acc[r.sensitivity_tier] || 0) + 1;
          return acc;
        }, {}),
        null_fingerprints: [...byId.values()].filter((r) => !r.content_fingerprint).length,
        embedding_calls: embeddingCalls,
        chat_calls: chatCalls,
        plaud_recordings: recordings.size,
        rows: [...byId.values()],
      });
    }
    if (pathname === "/__reset" && req.method === "POST") {
      byId.clear();
      byFingerprint.clear();
      recordings.clear();
      embeddingCalls = 0;
      chatCalls = 0;
      return send(res, 200, { ok: true });
    }

    // ── Embeddings (OpenAI-compatible) ──────────────────────────────────────
    if (pathname === "/v1/embeddings" && req.method === "POST") {
      const body = await readBody(req);
      if (!body?.input) return send(res, 400, { error: "input required" });
      if (body.model !== "text-embedding-3-small") {
        // The importer must never ask for another embedding model.
        return send(res, 400, { error: `unexpected embedding model ${body.model}` });
      }
      embeddingCalls++;
      const vector = new Array(1536).fill(0).map((_, i) => ((i * 7 + body.input.length) % 100) / 100);
      return send(res, 200, { data: [{ embedding: vector, index: 0 }], model: body.model });
    }

    // ── Chat completions (OpenAI-compatible) — canned atomizer ─────────────
    if (pathname === "/v1/chat/completions" && req.method === "POST") {
      const body = await readBody(req);
      const userMessage = (body?.messages || []).find((m) => m.role === "user")?.content || "";
      // Return three deterministic "atoms" so the import path can be exercised
      // without calling a real model. Not an LLM: just enough shape to parse.
      const lines = userMessage
        .replace(/<\/?INPUT>/g, "")
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => l.length > 20)
        .slice(0, 3);
      chatCalls++;
      return send(res, 200, {
        choices: [{ message: { content: JSON.stringify(lines) } }],
        usage: { prompt_tokens: 1234, completion_tokens: 321 },
      });
    }

    // ── PostgREST: thoughts ─────────────────────────────────────────────────
    if (pathname === "/rest/v1/thoughts") {
      if (req.method === "GET") {
        const fingerprintFilter = url.searchParams.get("content_fingerprint");
        if (fingerprintFilter?.startsWith("eq.")) {
          const row = byFingerprint.get(fingerprintFilter.slice(3));
          return send(res, 200, row ? [{ id: row.id }] : []);
        }
        return send(res, 200, [...byId.values()].slice(0, 1).map((r) => ({ id: r.id })));
      }

      if (req.method === "POST") {
        const body = await readBody(req);
        const rows = Array.isArray(body) ? body : [body];
        const inserted = [];
        for (const row of rows) {
          if (!row.content_fingerprint) {
            return send(res, 400, { message: "mock server refuses NULL content_fingerprint" });
          }
          if (byFingerprint.has(row.content_fingerprint)) {
            return send(res, 409, {
              code: "23505",
              message: "duplicate key value violates unique constraint \"idx_thoughts_fingerprint\"",
            });
          }
          const stored = { id: randomUUID(), created_at: row.created_at || new Date().toISOString(), ...row };
          byId.set(stored.id, stored);
          byFingerprint.set(stored.content_fingerprint, stored);
          inserted.push({ id: stored.id });
        }
        return send(res, 201, inserted);
      }

      if (req.method === "PATCH") {
        const idFilter = url.searchParams.get("id");
        const body = await readBody(req);
        if (idFilter?.startsWith("eq.")) {
          const row = byId.get(idFilter.slice(3));
          if (row) Object.assign(row, body);
        }
        return send(res, 204);
      }

      if (req.method === "DELETE") {
        const metadataFilter = url.searchParams.get("metadata");
        const deleted = [];
        if (metadataFilter?.startsWith("cs.")) {
          const filter = JSON.parse(metadataFilter.slice(3));
          for (const [id, row] of [...byId.entries()]) {
            if (matchesContains(row.metadata, filter)) {
              byId.delete(id);
              byFingerprint.delete(row.content_fingerprint);
              deleted.push({ id });
            }
          }
        }
        return send(res, 200, deleted);
      }
    }

    // ── PostgREST: plaud_recordings side table ──────────────────────────────
    if (pathname === "/rest/v1/plaud_recordings" && req.method === "POST") {
      const body = await readBody(req);
      recordings.set(body.id, body);
      return send(res, 201, []);
    }

    return send(res, 404, { message: `no mock route for ${req.method} ${pathname}` });
  } catch (err) {
    return send(res, 500, { message: err.message });
  }
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`mock-openbrain listening on http://127.0.0.1:${PORT}`);
});
