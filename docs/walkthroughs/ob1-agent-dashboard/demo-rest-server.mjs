#!/usr/bin/env node

import http from "node:http";
import { buildDemoState } from "./seed-data.mjs";

const state = buildDemoState();
const port = Number(process.env.OB1_DASHBOARD_DEMO_PORT || 3024);
const accessKey = process.env.OB1_DASHBOARD_DEMO_KEY || "local-screenshot-key";

const server = http.createServer(async (request, response) => {
  try {
    await route(request, response);
  } catch (error) {
    sendJson(response, 500, {
      error: error instanceof Error ? error.message : "Internal demo server error",
    });
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(`OB1 dashboard demo REST listening on http://127.0.0.1:${port}`);
});

async function route(request, response) {
  const url = new URL(request.url || "/", `http://${request.headers.host || "127.0.0.1"}`);

  if (request.method === "OPTIONS") {
    sendCors(response, 204);
    return;
  }

  if (!isAuthorized(request)) {
    sendJson(response, 401, { error: "Unauthorized" });
    return;
  }

  if (request.method === "GET" && url.pathname === "/health") {
    sendJson(response, 200, { status: "ok", ok: true, service: "ob1-dashboard-demo-rest" });
    return;
  }

  if (request.method === "GET" && url.pathname === "/stats") {
    sendJson(response, 200, statsResponse(url));
    return;
  }

  if (request.method === "GET" && url.pathname === "/thoughts") {
    sendJson(response, 200, thoughtsResponse(url));
    return;
  }

  const thoughtMatch = url.pathname.match(/^\/thought\/([^/]+)$/);
  if (thoughtMatch && request.method === "GET") {
    const thought = findThought(decodeURIComponent(thoughtMatch[1]));
    if (!thought) return sendJson(response, 404, { error: "Thought not found" });
    sendJson(response, 200, thought);
    return;
  }

  if (thoughtMatch && request.method === "PUT") {
    const thought = findThought(decodeURIComponent(thoughtMatch[1]));
    if (!thought) return sendJson(response, 404, { error: "Thought not found" });
    Object.assign(thought, await readJson(request), {
      updated_at: new Date().toISOString(),
      status_updated_at: new Date().toISOString(),
    });
    sendJson(response, 200, { id: thought.id, action: "updated", message: "Demo thought updated" });
    return;
  }

  if (thoughtMatch && request.method === "DELETE") {
    const id = decodeURIComponent(thoughtMatch[1]);
    state.thoughts = state.thoughts.filter((thought) => thought.id !== id);
    sendJson(response, 200, { id, action: "deleted", message: "Demo thought deleted" });
    return;
  }

  if (request.method === "POST" && url.pathname === "/search") {
    sendJson(response, 200, searchResponse(await readJson(request)));
    return;
  }

  if (request.method === "GET" && url.pathname === "/duplicates") {
    sendJson(response, 200, duplicatesResponse(url));
    return;
  }

  if (request.method === "POST" && url.pathname === "/capture") {
    const body = await readJson(request);
    const content = String(body.content || "").trim();
    if (!content) return sendJson(response, 400, { error: "content is required" });
    const id = `demo-capture-${state.nextThoughtId++}`;
    const now = new Date().toISOString();
    const thought = {
      id,
      content,
      type: "idea",
      source_type: "dashboard_capture",
      importance: 50,
      quality_score: 72,
      sensitivity_tier: "standard",
      metadata: { source: "dashboard_capture", topics: ["manual capture"], people: ["Jonathan Edwards"] },
      created_at: now,
      updated_at: now,
      status: "new",
      status_updated_at: now,
    };
    state.thoughts.unshift(thought);
    sendJson(response, 200, {
      thought_id: id,
      action: "created",
      type: thought.type,
      sensitivity_tier: thought.sensitivity_tier,
      content_fingerprint: `demo-${id}`,
      message: "Demo thought captured",
    });
    return;
  }

  if (request.method === "GET" && url.pathname === "/ingestion-jobs") {
    sendJson(response, 200, { jobs: [], count: 0 });
    return;
  }

  if (request.method === "POST" && url.pathname === "/ingest") {
    sendJson(response, 200, { job_id: 1, status: "demo_stub" });
    return;
  }

  sendJson(response, 404, { error: `No demo route for ${request.method} ${url.pathname}` });
}

function isAuthorized(request) {
  const provided = request.headers["x-brain-key"];
  return !accessKey || provided === accessKey;
}

function thoughtsResponse(url) {
  const page = Math.max(1, positiveInt(url.searchParams.get("page"), 1));
  const perPage = Math.max(1, positiveInt(url.searchParams.get("per_page"), 25));
  const filtered = filterThoughts(url);
  const sorted = sortThoughts(filtered, url.searchParams.get("sort"), url.searchParams.get("order"));
  const offset = (page - 1) * perPage;
  return {
    data: sorted.slice(offset, offset + perPage),
    total: sorted.length,
    page,
    per_page: perPage,
  };
}

function statsResponse(url) {
  const thoughts = filterRestricted(state.thoughts, url);
  const types = {};
  const topics = {};
  for (const thought of thoughts) {
    types[thought.type] = (types[thought.type] || 0) + 1;
    for (const topic of thought.metadata?.topics || []) {
      topics[topic] = (topics[topic] || 0) + 1;
    }
  }
  return {
    total_thoughts: thoughts.length,
    window_days: url.searchParams.has("days") ? Number(url.searchParams.get("days")) : "all",
    types: orderObject(types),
    top_topics: Object.entries(topics)
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, 8)
      .map(([topic, count]) => ({ topic, count })),
  };
}

function searchResponse(body) {
  const query = String(body.query || "").trim().toLowerCase();
  const limit = Math.max(1, positiveInt(body.limit, 25));
  const page = Math.max(1, positiveInt(body.page, 1));
  if (!query) {
    return { results: [], count: 0, total: 0, page, per_page: limit, total_pages: 1, mode: body.mode || "text" };
  }
  const terms = query.split(/\s+/).filter(Boolean);
  const scored = state.thoughts
    .map((thought) => ({ thought, score: scoreThought(thought, terms, body.mode) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || b.thought.importance - a.thought.importance)
    .map((item, index) => ({
      ...item.thought,
      rank: index + 1,
      similarity: Math.min(0.99, 0.58 + item.score / 15),
    }));
  const offset = (page - 1) * limit;
  return {
    results: scored.slice(offset, offset + limit),
    count: Math.min(limit, Math.max(0, scored.length - offset)),
    total: scored.length,
    page,
    per_page: limit,
    total_pages: Math.max(1, Math.ceil(scored.length / limit)),
    mode: body.mode || "semantic",
  };
}

function duplicatesResponse(url) {
  const threshold = Number(url.searchParams.get("threshold") || 0.85);
  const limit = Math.max(1, positiveInt(url.searchParams.get("limit"), 50));
  const offset = positiveInt(url.searchParams.get("offset"), 0);
  const pairs = state.duplicatePairs
    .filter((pair) => pair.similarity >= threshold)
    .map((pair) => {
      const a = findThought(pair.thought_id_a);
      const b = findThought(pair.thought_id_b);
      if (!a || !b) return null;
      return {
        ...pair,
        content_a: a.content,
        content_b: b.content,
        type_a: a.type,
        type_b: b.type,
        quality_a: a.quality_score,
        quality_b: b.quality_score,
        created_a: a.created_at,
        created_b: b.created_at,
      };
    })
    .filter(Boolean);

  return {
    pairs: pairs.slice(offset, offset + limit),
    threshold,
    limit,
    offset,
  };
}

function filterThoughts(url) {
  let thoughts = filterRestricted(state.thoughts, url);

  const type = url.searchParams.get("type");
  if (type) thoughts = thoughts.filter((thought) => thought.type === type);

  const sourceType = url.searchParams.get("source_type");
  if (sourceType) thoughts = thoughts.filter((thought) => thought.source_type === sourceType);

  const importanceMin = url.searchParams.get("importance_min");
  if (importanceMin) thoughts = thoughts.filter((thought) => thought.importance >= Number(importanceMin));

  const qualityMax = url.searchParams.get("quality_score_max");
  if (qualityMax !== null) thoughts = thoughts.filter((thought) => thought.quality_score <= Number(qualityMax));

  const statusParam = url.searchParams.get("status");
  if (statusParam) {
    const allowed = new Set(statusParam.split(",").map((status) => status.trim()));
    thoughts = thoughts.filter((thought) => allowed.has(thought.status || "new"));
  }

  return thoughts;
}

function filterRestricted(thoughts, url) {
  if (url.searchParams.get("exclude_restricted") === "false") return [...thoughts];
  return thoughts.filter((thought) => thought.sensitivity_tier !== "restricted");
}

function sortThoughts(thoughts, sort = "created_at", order = "desc") {
  const direction = order === "asc" ? 1 : -1;
  const key = sort || "created_at";
  return [...thoughts].sort((a, b) => {
    const av = a[key] ?? "";
    const bv = b[key] ?? "";
    if (typeof av === "number" && typeof bv === "number") return (av - bv) * direction;
    return String(av).localeCompare(String(bv)) * direction;
  });
}

function scoreThought(thought, terms, mode) {
  const haystack = [
    thought.content,
    thought.type,
    thought.source_type,
    ...(thought.metadata?.topics || []),
    ...(thought.metadata?.people || []),
  ]
    .join(" ")
    .toLowerCase();
  let score = 0;
  for (const term of terms) {
    if (haystack.includes(term)) score += 1;
  }
  if (mode === "semantic" && thought.metadata?.topics?.some((topic) => haystack.includes(topic.toLowerCase()))) {
    score += thought.importance / 100;
  }
  return score;
}

function orderObject(input) {
  return Object.fromEntries(Object.entries(input).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])));
}

function findThought(id) {
  return state.thoughts.find((thought) => thought.id === String(id));
}

function positiveInt(value, fallback) {
  if (value === null || value === undefined || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;
  return Math.floor(parsed);
}

async function readJson(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw) return {};
  return JSON.parse(raw);
}

function sendCors(response, status) {
  response.writeHead(status, {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-brain-key",
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, PATCH, OPTIONS",
  });
  response.end();
}

function sendJson(response, status, body) {
  response.writeHead(status, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-brain-key",
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, PATCH, OPTIONS",
  });
  response.end(JSON.stringify(body));
}
