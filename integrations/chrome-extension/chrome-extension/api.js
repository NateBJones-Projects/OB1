// --- Open Brain REST client ---
// Shared by the popup (via <script>) and the service worker (via importScripts).
// Talks to the open-brain-rest Edge Function (integrations/open-brain-rest).

const SEARCH_LIMIT = 10;
// When a source filter is active, fetch a wider window and filter client-side,
// because open-brain-rest /search does not accept a source filter.
const FILTERED_SEARCH_WINDOW = 50;
const SEARCH_THRESHOLD = 0.3;

async function getApiConfig() {
  const { apiUrl, apiKey } = await chrome.storage.sync.get(["apiUrl", "apiKey"]);
  return {
    apiUrl: normalizeApiUrl(apiUrl),
    apiKey: apiKey || "",
  };
}

function normalizeApiUrl(url) {
  return (url || "").trim().replace(/\/+$/, "");
}

async function brainRequest(path, { method = "GET", body } = {}) {
  const { apiUrl, apiKey } = await getApiConfig();
  if (!apiUrl || !apiKey) {
    throw new Error("API not configured. Please check settings.");
  }

  const headers = { "x-brain-key": apiKey };
  if (body !== undefined) headers["Content-Type"] = "application/json";

  const response = await fetch(`${apiUrl}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`API error (${response.status}): ${text}`);
  }

  return response.json();
}

// Normalize the many ways a source can be written ("browser", "chrome_extension",
// "telegram", "mcp", ...) into the labels used by the source filter.
function sourceLabel(source) {
  if (!source) return "";
  const s = String(source).toLowerCase();
  if (s.includes("browser") || s.includes("chrome") || s.includes("extension")) return "browser";
  if (s.includes("telegram")) return "telegram";
  if (s.includes("slack")) return "slack";
  if (s.includes("claude")) return "claude";
  if (s.includes("mcp")) return "mcp";
  return String(source);
}

function sourceOf(thought) {
  return thought.source_type || thought.metadata?.source || "";
}

async function captureThought(content, { url, title } = {}) {
  // No metadata is sent with the capture so that open-brain-rest still runs
  // its own metadata extraction (type, topics, people, action items).
  const result = await brainRequest("/capture", {
    method: "POST",
    body: { content, source_type: "browser" },
  });

  // Attach the page URL and title afterwards; PUT merges into existing metadata.
  const pageMetadata = {};
  if (url) pageMetadata.url = url;
  if (title) pageMetadata.title = title;
  if (result.thought_id && Object.keys(pageMetadata).length > 0) {
    try {
      await brainRequest(`/thought/${encodeURIComponent(result.thought_id)}`, {
        method: "PUT",
        body: { metadata: pageMetadata },
      });
    } catch (err) {
      // The thought itself is saved; the source is also part of the content.
      console.log("[Open Brain] Could not attach page metadata:", err);
    }
  }

  return result;
}

async function searchThoughts(query, { source = "", limit = SEARCH_LIMIT } = {}) {
  const data = await brainRequest("/search", {
    method: "POST",
    body: {
      query,
      mode: "semantic",
      limit: source ? Math.max(limit, FILTERED_SEARCH_WINDOW) : limit,
      threshold: SEARCH_THRESHOLD,
    },
  });

  let results = data.results || [];
  if (source) {
    results = results.filter((item) => sourceLabel(sourceOf(item)) === source);
  }
  return results.slice(0, limit);
}

async function getStats() {
  // /stats returns the all-time total plus per-type counts inside a rolling
  // window of `days`, so the window counts are the sum of the type counts.
  const [day, week] = await Promise.all([
    brainRequest("/stats?days=1"),
    brainRequest("/stats?days=7"),
  ]);
  return {
    total: day.total_thoughts ?? 0,
    lastDay: sumCounts(day.types),
    lastWeek: sumCounts(week.types),
  };
}

function sumCounts(types) {
  return Object.values(types || {}).reduce((sum, n) => sum + (Number(n) || 0), 0);
}

async function deleteThought(id) {
  return brainRequest(`/thought/${encodeURIComponent(id)}`, { method: "DELETE" });
}

async function updateThoughtStatus(id, status) {
  return brainRequest(`/thought/${encodeURIComponent(id)}`, {
    method: "PUT",
    body: { status },
  });
}
