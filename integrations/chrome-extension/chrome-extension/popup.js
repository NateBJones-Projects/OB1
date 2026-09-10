// --- DOM Elements ---
const saveInput = document.getElementById("save-input");
const saveBtn = document.getElementById("save-btn");
const saveStatus = document.getElementById("save-status");
const contextHint = document.getElementById("context-hint");
const relatedThoughts = document.getElementById("related-thoughts");

const searchInput = document.getElementById("search-input");
const searchBtn = document.getElementById("search-btn");
const searchResults = document.getElementById("search-results");
const sourceFilter = document.getElementById("source-filter");

const statTotal = document.getElementById("stat-total");
const statToday = document.getElementById("stat-today");
const statWeek = document.getElementById("stat-week");

const settingsToggle = document.getElementById("settings-toggle");
const settingsArrow = document.getElementById("settings-arrow");
const settingsContent = document.getElementById("settings-content");
const settingApiUrl = document.getElementById("setting-api-url");
const settingApiKey = document.getElementById("setting-api-key");
const settingsSaveBtn = document.getElementById("settings-save-btn");
const settingsStatus = document.getElementById("settings-status");

const unconfiguredHint = document.getElementById("unconfigured-hint");

// --- State ---
let apiUrl = "";
let apiKey = "";
let currentPageUrl = "";
let currentPageTitle = "";

// --- Helpers ---

function setStatus(el, message, type) {
  el.textContent = message;
  el.className = "";
  if (type === "success") el.classList.add("status-success");
  else if (type === "error") el.classList.add("status-error");
  else if (type === "loading") el.classList.add("status-loading");
}

function clearStatus(el, delay = 3000) {
  setTimeout(() => {
    el.textContent = "";
    el.className = "";
  }, delay);
}

async function apiCall(payload) {
  if (!apiUrl || !apiKey) {
    throw new Error("API not configured. Please check settings.");
  }

  const response = await fetch(apiUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-brain-key": apiKey,
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`API error (${response.status}): ${text}`);
  }

  return response.json();
}

function formatDate(dateStr) {
  if (!dateStr) return "";
  try {
    const d = new Date(dateStr);
    return d.toLocaleDateString("en-US", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return dateStr;
  }
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML.replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function truncateText(str, maxLen) {
  if (!str) return "";
  if (str.length <= maxLen) return str;
  return str.substring(0, maxLen - 3) + "...";
}

function extractSourceUrl(text) {
  if (!text) return null;
  const match = text.match(/\(Source:.*?—\s*(https?:\/\/[^\s)]+)\)/);
  return match ? match[1] : null;
}

function linkifyUrls(escapedHtml) {
  return escapedHtml.replace(
    /(https?:\/\/[^\s<)]+)/g,
    '<a href="$1" class="result-link" target="_blank" title="Open source">$1</a>'
  );
}

function getSourceBadgeClass(source) {
  if (!source) return "source-unknown";
  const s = source.toLowerCase();
  if (s.includes("browser") || s.includes("chrome") || s.includes("extension")) return "source-browser";
  if (s.includes("telegram")) return "source-telegram";
  if (s.includes("slack")) return "source-slack";
  if (s.includes("claude") || s.includes("mcp")) return "source-mcp";
  return "source-unknown";
}

function getSourceLabel(source) {
  if (!source) return "";
  const s = source.toLowerCase();
  if (s.includes("browser") || s.includes("chrome") || s.includes("extension")) return "browser";
  if (s.includes("telegram")) return "telegram";
  if (s.includes("slack")) return "slack";
  if (s.includes("claude")) return "claude";
  if (s.includes("mcp")) return "mcp";
  return source;
}

// --- Page Context ---

async function getPageContext() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab) {
      currentPageUrl = tab.url || "";
      currentPageTitle = tab.title || "";

      // Show context hint
      if (currentPageTitle && currentPageUrl && !currentPageUrl.startsWith("chrome://")) {
        const displayTitle = truncateText(currentPageTitle, 50);
        contextHint.innerHTML = `<span class="context-icon">&#128279;</span> Source: ${escapeHtml(displayTitle)}`;
      } else {
        contextHint.textContent = "";
      }
    }
  } catch (err) {
    console.log("Could not load page context:", err);
  }
}

function buildContentWithContext(rawContent) {
  // Append source URL and title if available and not a chrome:// page
  if (currentPageTitle && currentPageUrl && !currentPageUrl.startsWith("chrome://")) {
    return `${rawContent}\n\n(Source: ${currentPageTitle} \u2014 ${currentPageUrl})`;
  }
  return rawContent;
}

// --- Auto-Capture: fill selected text into save textarea ---

async function autoCaptureSelectedText() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.id || tab.url?.startsWith("chrome://")) return;

    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => window.getSelection().toString(),
    });

    if (results && results[0] && results[0].result) {
      const selectedText = results[0].result.trim();
      if (selectedText) {
        saveInput.value = selectedText;
      }
    }
  } catch (err) {
    // Silently ignore -- script injection may fail on restricted pages
    console.log("Auto-capture: Could not read selected text:", err);
  }
}

// --- Pending Search (from context menu / omnibox) ---

async function checkPendingSearch() {
  try {
    const data = await chrome.storage.local.get("pendingSearch");
    if (data.pendingSearch) {
      const query = data.pendingSearch;
      // Clear it immediately so it doesn't trigger again
      await chrome.storage.local.remove("pendingSearch");
      // Put the text in the search input and auto-trigger search
      searchInput.value = query;
      performSearch();
    }
  } catch (err) {
    console.log("Error checking pendingSearch:", err);
  }
}

// --- Settings ---

function toggleSettings(forceOpen) {
  const isOpen =
    forceOpen !== undefined
      ? forceOpen
      : !settingsContent.classList.contains("open");

  if (isOpen) {
    settingsContent.classList.add("open");
    settingsArrow.classList.add("open");
  } else {
    settingsContent.classList.remove("open");
    settingsArrow.classList.remove("open");
  }
}

settingsToggle.addEventListener("click", () => toggleSettings());

settingsSaveBtn.addEventListener("click", async () => {
  const newUrl = settingApiUrl.value.trim();
  const newKey = settingApiKey.value.trim();

  if (!newUrl || !newKey) {
    setStatus(settingsStatus, "Please fill in both fields.", "error");
    clearStatus(settingsStatus);
    return;
  }

  try {
    await chrome.storage.sync.set({ apiUrl: newUrl, apiKey: newKey });
    apiUrl = newUrl;
    apiKey = newKey;

    setStatus(settingsStatus, "Settings saved!", "success");
    clearStatus(settingsStatus);

    unconfiguredHint.classList.add("hidden");
    loadStats();
  } catch (err) {
    setStatus(settingsStatus, "Error saving: " + err.message, "error");
    clearStatus(settingsStatus, 5000);
  }
});

// --- Load Settings on startup ---

async function loadSettings() {
  try {
    const data = await chrome.storage.sync.get(["apiUrl", "apiKey"]);
    apiUrl = data.apiUrl || "";
    apiKey = data.apiKey || "";

    settingApiUrl.value = apiUrl;
    settingApiKey.value = apiKey;

    if (!apiUrl || !apiKey) {
      unconfiguredHint.classList.remove("hidden");
      toggleSettings(true);
    } else {
      unconfiguredHint.classList.add("hidden");
      loadStats();
    }
  } catch (err) {
    console.error("Error loading settings:", err);
    unconfiguredHint.classList.remove("hidden");
    toggleSettings(true);
  }
}

// --- Save ---

saveBtn.addEventListener("click", async () => {
  const rawText = saveInput.value.trim();
  if (!rawText) {
    setStatus(saveStatus, "Please enter a thought.", "error");
    clearStatus(saveStatus);
    return;
  }

  // Build content with source context
  const content = buildContentWithContext(rawText);

  saveBtn.disabled = true;
  setStatus(saveStatus, "Saving...", "loading");

  // Hide previous related thoughts
  relatedThoughts.classList.add("hidden");
  relatedThoughts.classList.remove("visible");

  try {
    await apiCall({
      action: "save",
      content: content,
      metadata: {
        source: "browser",
        url: currentPageUrl || undefined,
        title: currentPageTitle || undefined,
      },
    });

    // Save confirmation animation
    const saveArea = saveBtn.closest(".save-area");
    if (saveArea) {
      saveArea.classList.add("save-flash");
      setTimeout(() => saveArea.classList.remove("save-flash"), 1000);
    }

    setStatus(saveStatus, "Thought saved!", "success");
    clearStatus(saveStatus);
    loadStats();

    // Search for related thoughts using the raw text (before context was appended)
    fetchRelatedThoughts(rawText);

    saveInput.value = "";
  } catch (err) {
    setStatus(saveStatus, err.message, "error");
    clearStatus(saveStatus, 5000);
  } finally {
    saveBtn.disabled = false;
  }
});

// Save with Ctrl+Enter
saveInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
    e.preventDefault();
    saveBtn.click();
  }
});

// --- Related Thoughts ---

async function fetchRelatedThoughts(query) {
  try {
    const data = await apiCall({ action: "search", query: query });
    const results = data.results || data.thoughts || [];

    // Show max 3 related thoughts
    const topResults = results.slice(0, 3);
    if (topResults.length === 0) return;

    let html = '<div class="related-label">Related thoughts</div>';
    topResults.forEach((item) => {
      const text = item.content || item.thought || item.text || "";
      const score = item.similarity != null ? item.similarity : item.score;
      const date = item.created_at || item.date || "";

      html += '<div class="related-item">';
      html += `<div class="related-text">${escapeHtml(truncateText(text, 120))}</div>`;
      html += '<div class="related-meta">';
      if (score != null) {
        const pct = (score * 100).toFixed(0);
        html += `<span class="related-score">Match: ${pct}%</span>`;
      }
      if (date) {
        html += `<span class="related-date">${formatDate(date)}</span>`;
      }
      html += "</div>";
      html += "</div>";
    });

    relatedThoughts.innerHTML = html;
    relatedThoughts.classList.remove("hidden");

    // Trigger animation after a brief delay for DOM update
    requestAnimationFrame(() => {
      relatedThoughts.classList.add("visible");
    });
  } catch (err) {
    // Silently ignore -- related thoughts are a nice-to-have
    console.log("Could not load related thoughts:", err);
  }
}

// --- Search ---

searchBtn.addEventListener("click", () => performSearch());

searchInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    performSearch();
  }
});

async function performSearch() {
  const query = searchInput.value.trim();
  if (!query) {
    searchResults.innerHTML =
      '<div class="no-results">Please enter a search term.</div>';
    return;
  }

  searchBtn.disabled = true;
  searchResults.innerHTML =
    '<div class="no-results status-loading">Searching...</div>';

  try {
    // Build search payload with optional source filter
    const payload = { action: "search", query: query };
    const selectedSource = sourceFilter.value;
    if (selectedSource) {
      payload.source = selectedSource;
    }

    const data = await apiCall(payload);
    const results = data.results || data.thoughts || [];

    if (results.length === 0) {
      searchResults.innerHTML =
        '<div class="no-results">No results found.</div>';
      return;
    }

    searchResults.innerHTML = results
      .map((item) => {
        const text = item.content || item.thought || item.text || "";
        const score = item.similarity != null ? item.similarity : item.score;
        const date = item.created_at || item.date || "";
        const source = item.source || item.metadata?.source || "";

        const sourceUrl = extractSourceUrl(text);
        const itemId = item.id || "";
        const isTask = item.metadata?.type === "task";
        const taskStatus = item.metadata?.status || "open";

        let html = `<div class="result-item" data-id="${escapeHtml(itemId)}">`;
        // Delete button (X)
        html += `<button class="result-delete-btn" title="Delete thought">&times;</button>`;
        // Done button (only for open tasks)
        if (isTask && taskStatus !== "done" && itemId) {
          html += `<button class="result-done-btn" data-id="${escapeHtml(itemId)}" title="Mark as done">Done</button>`;
        }
        // Result text (click to copy)
        html += `<div class="result-text" data-full-text="${escapeHtml(text)}">${linkifyUrls(escapeHtml(text))}</div>`;
        html += '<div class="result-meta">';
        if (source) {
          const badgeClass = getSourceBadgeClass(source);
          const label = getSourceLabel(source);
          html += `<span class="source-badge ${badgeClass}">${escapeHtml(label)}</span>`;
        }
        if (sourceUrl) {
          html += `<a href="${escapeHtml(sourceUrl)}" target="_blank" class="source-badge source-link" title="Open source">Source</a>`;
        }
        if (score != null) {
          const pct = (score * 100).toFixed(0);
          html += `<span class="result-score">${pct}%</span>`;
        }
        if (date) {
          html += `<span class="result-date">${formatDate(date)}</span>`;
        }
        html += "</div>";
        html += "</div>";
        return html;
      })
      .join("");

    // Attach click-to-copy and delete handlers
    attachResultHandlers();
  } catch (err) {
    searchResults.innerHTML = `<div class="no-results status-error">${escapeHtml(err.message)}</div>`;
  } finally {
    searchBtn.disabled = false;
  }
}

// --- Click to Copy ---

function attachResultHandlers() {
  // Click to copy on result text
  searchResults.querySelectorAll(".result-text").forEach((el) => {
    el.addEventListener("click", (e) => {
      // Don't copy if user clicked a link inside the text
      if (e.target.closest("a")) return;

      const fullText = el.getAttribute("data-full-text") || el.textContent;
      navigator.clipboard.writeText(fullText).then(() => {
        showCopyToast(el);
      }).catch((err) => {
        console.error("Copy failed:", err);
      });
    });
  });

  // Delete button handlers
  searchResults.querySelectorAll(".result-delete-btn").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const resultItem = btn.closest(".result-item");
      showDeleteConfirm(resultItem);
    });
  });

  // Done button handlers (for tasks)
  searchResults.querySelectorAll(".result-done-btn").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const id = btn.getAttribute("data-id");
      if (!id) return;

      try {
        await apiCall({ action: "update_status", id, status: "done" });
        btn.textContent = "Done!";
        btn.style.opacity = "1";
        btn.style.borderColor = "#4caf50";
        btn.style.background = "rgba(76, 175, 80, 0.2)";
        btn.disabled = true;
        setTimeout(() => {
          const resultItem = btn.closest(".result-item");
          if (resultItem) {
            resultItem.classList.add("fade-out");
            resultItem.addEventListener("animationend", () => resultItem.remove());
          }
        }, 800);
      } catch (err) {
        console.error("Status update failed:", err);
      }
    });
  });
}

function showCopyToast(textEl) {
  const resultItem = textEl.closest(".result-item");
  if (!resultItem) return;

  // Remove any existing toast
  const existing = resultItem.querySelector(".copy-toast");
  if (existing) existing.remove();

  const toast = document.createElement("span");
  toast.className = "copy-toast";
  toast.textContent = "Copied!";
  resultItem.appendChild(toast);

  // Remove after animation
  setTimeout(() => toast.remove(), 1300);
}

// --- Delete Thoughts ---

function showDeleteConfirm(resultItem) {
  // Don't show if already showing
  if (resultItem.querySelector(".delete-confirm")) return;

  const thoughtId = resultItem.getAttribute("data-id");

  const confirm = document.createElement("div");
  confirm.className = "delete-confirm";
  confirm.innerHTML = `
    <span>Delete this thought?</span>
    <button class="confirm-yes">Yes</button>
    <button class="confirm-no">No</button>
  `;

  resultItem.appendChild(confirm);

  // "Yes" -- delete
  confirm.querySelector(".confirm-yes").addEventListener("click", async () => {
    try {
      if (thoughtId) {
        await apiCall({ action: "delete", id: thoughtId });
      } else {
        // Fallback: use content if no id available
        const textEl = resultItem.querySelector(".result-text");
        const content = textEl ? (textEl.getAttribute("data-full-text") || textEl.textContent) : "";
        await apiCall({ action: "delete", content: content });
      }
    } catch (err) {
      console.error("Delete failed:", err);
      // Still remove from UI even if API call fails (API may not support delete yet)
    }

    // Fade out and remove
    resultItem.classList.add("fade-out");
    resultItem.addEventListener("animationend", () => {
      resultItem.remove();
    });
  });

  // "No" -- cancel
  confirm.querySelector(".confirm-no").addEventListener("click", () => {
    confirm.remove();
  });
}

// --- Stats ---

async function loadStats() {
  try {
    const data = await apiCall({ action: "stats" });
    statTotal.textContent = data.total ?? data.total_thoughts ?? "--";
    statToday.textContent = data.today ?? data.thoughts_today ?? "--";
    statWeek.textContent = data.this_week ?? data.thoughts_this_week ?? "--";
  } catch {
    statTotal.textContent = "--";
    statToday.textContent = "--";
    statWeek.textContent = "--";
  }
}

// --- Init ---

async function init() {
  // Load settings first
  await loadSettings();

  // Get page context (URL + title)
  await getPageContext();

  // Auto-Capture: fill selected text from the page into save textarea
  await autoCaptureSelectedText();

  // Check for pending search from context menu or omnibox
  await checkPendingSearch();

  // Auto-focus the save textarea (unless a pending search moved focus)
  if (!searchInput.value) {
    saveInput.focus();
  }
}

init();
