// --- Context Menu Setup ---

chrome.runtime.onInstalled.addListener(() => {
  // Context menu: save selected text to Brain
  chrome.contextMenus.create({
    id: "save-to-brain",
    title: "Save to Brain",
    contexts: ["selection"],
  });

  // Context menu: search selected text in Brain
  chrome.contextMenus.create({
    id: "search-in-brain",
    title: "Search in Brain",
    contexts: ["selection"],
  });
});

// --- Context Menu Handler ---

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  const selectedText = info.selectionText;
  if (!selectedText) return;

  // --- "Search in Brain" ---
  if (info.menuItemId === "search-in-brain") {
    // Store the search query so the popup can pick it up
    await chrome.storage.local.set({ pendingSearch: selectedText });

    // Try to open the popup programmatically (requires Chrome 99+)
    try {
      await chrome.action.openPopup();
    } catch (err) {
      // openPopup() not available or failed -- the popup will pick up
      // pendingSearch on next manual open
      console.log("[Open Brain] openPopup not available, pendingSearch set:", err);
    }
    return;
  }

  // --- "Save to Brain" ---
  if (info.menuItemId !== "save-to-brain") return;

  const pageUrl = tab?.url || "unknown";
  const pageTitle = tab?.title || "Unknown page";

  // Format: content + source context
  const content = `${selectedText}\n\n(Source: ${pageTitle} \u2014 ${pageUrl})`;

  try {
    const { apiUrl, apiKey } = await chrome.storage.sync.get([
      "apiUrl",
      "apiKey",
    ]);

    if (!apiUrl || !apiKey) {
      showNotification(
        "Configuration missing",
        "Please configure the API URL and API Key in settings.",
        false
      );
      return;
    }

    const response = await fetch(apiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-brain-key": apiKey,
      },
      body: JSON.stringify({
        action: "save",
        content: content,
        metadata: {
          source: "browser",
          url: pageUrl,
          title: pageTitle,
        },
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`API error (${response.status}): ${text}`);
    }

    showNotification(
      "Thought saved",
      `"${truncate(selectedText, 80)}" has been saved to Brain.`,
      true
    );
  } catch (err) {
    console.error("Open Brain - Error saving:", err);
    showNotification(
      "Error saving",
      err.message || "Unknown error",
      false
    );
  }
});

// --- Omnibox (address bar: "brain <query>") ---

chrome.omnibox.onInputStarted.addListener(() => {
  chrome.omnibox.setDefaultSuggestion({
    description: "Search Brain: %s",
  });
});

chrome.omnibox.onInputChanged.addListener(async (text, suggest) => {
  const query = text.trim();
  if (!query || query.length < 2) {
    suggest([]);
    return;
  }

  try {
    const { apiUrl, apiKey } = await chrome.storage.sync.get(["apiUrl", "apiKey"]);
    if (!apiUrl || !apiKey) {
      suggest([]);
      return;
    }

    const response = await fetch(apiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-brain-key": apiKey,
      },
      body: JSON.stringify({ action: "search", query: query }),
    });

    if (!response.ok) {
      suggest([]);
      return;
    }

    const data = await response.json();
    const results = data.results || data.thoughts || [];

    const suggestions = results.slice(0, 5).map((item) => {
      const content = item.content || item.thought || item.text || "";
      // Omnibox description supports XML: escape special chars
      const desc = escapeXml(truncate(content, 200));
      // content field is used when suggestion is selected
      return {
        content: content,
        description: desc,
      };
    });

    suggest(suggestions);
  } catch (err) {
    console.error("[Open Brain] Omnibox search failed:", err);
    suggest([]);
  }
});

chrome.omnibox.onInputEntered.addListener(async (text, disposition) => {
  // text is either the typed query (default suggestion) or the selected suggestion content
  // Store as pendingSearch so popup can pick it up, then try to open popup
  await chrome.storage.local.set({ pendingSearch: text });

  try {
    await chrome.action.openPopup();
  } catch (err) {
    // If openPopup fails, copy to clipboard via offscreen or just log
    console.log("[Open Brain] openPopup not available after omnibox selection:", err);
  }
});

// --- Notification Helper ---

function showNotification(title, message, success) {
  // Use the badge as a quick visual indicator
  const badgeText = success ? "OK" : "ERR";
  const badgeColor = success ? "#4caf50" : "#ef5350";

  chrome.action.setBadgeText({ text: badgeText });
  chrome.action.setBadgeBackgroundColor({ color: badgeColor });

  // Clear badge after 3 seconds
  setTimeout(() => {
    chrome.action.setBadgeText({ text: "" });
  }, 3000);

  // Log for debugging
  console.log(`[Open Brain] ${title}: ${message}`);
}

function truncate(str, maxLen) {
  if (str.length <= maxLen) return str;
  return str.substring(0, maxLen - 3) + "...";
}

function escapeXml(str) {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
