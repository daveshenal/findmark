// popup.js — UI logic for Bookmark Semantic Search

const searchInput = document.getElementById("searchInput");
const clearBtn = document.getElementById("clearBtn");
const resultsArea = document.getElementById("resultsArea");
const stateMessage = document.getElementById("stateMessage");
const statusDot = document.getElementById("statusDot");
const statusText = document.getElementById("statusText");
const footerInfo = document.getElementById("footerInfo");
const reindexBtn = document.getElementById("reindexBtn");
const progressWrap = document.getElementById("progressWrap");
const progressBar = document.getElementById("progressBar");
const debugPanel = document.getElementById("debugPanel");
const debugLog = document.getElementById("debugLog");
const debugToggle = document.getElementById("debugToggle");

let debounceTimer = null;
let bookmarkCount = 0;
let debugVisible = false;
let debugEnabled = false;
let pollInterval = null;

// ── Status helpers ────────────────────────────────────────────────────────────

function setStatus(state, text) {
  statusDot.className = `status-dot ${state}`;
  statusText.textContent = text;
}

function showProgress(pct) {
  progressWrap.classList.add("visible");
  progressBar.style.width = `${Math.min(100, pct)}%`;
  document.getElementById("progressPct").textContent = `${Math.round(pct)}%`;
}

function hideProgress() {
  progressBar.style.width = "100%";
  setTimeout(() => {
    progressWrap.classList.remove("visible");
    progressBar.style.width = "0%";
    document.getElementById("progressPct").textContent = "";
  }, 500);
}

function showState(emoji, title, sub) {
  stateMessage.style.display = "block";
  const emojiEl = document.createElement("span");
  emojiEl.className = "emoji";
  emojiEl.textContent = emoji;
  const titleEl = document.createElement("strong");
  titleEl.textContent = title;
  const subEl = document.createElement("span");
  subEl.textContent = sub;
  stateMessage.replaceChildren(emojiEl, titleEl, subEl);
  resultsArea.replaceChildren(stateMessage);
}

// ── Debug panel ───────────────────────────────────────────────────────────────

function renderDebugLogs(logs) {
  debugLog.innerHTML = "";
  if (!logs || logs.length === 0) {
    const empty = document.createElement("div");
    empty.style.color = "var(--muted)";
    empty.textContent = "No log entries yet.";
    debugLog.appendChild(empty);
    return;
  }
  logs.forEach((entry) => {
    const line = document.createElement("div");
    line.className = `log-line log-${entry.level}`;
    const ts = document.createElement("span");
    ts.className = "log-ts";
    ts.textContent = entry.ts;
    const msg = document.createElement("span");
    msg.textContent = ` ${entry.msg}`;
    line.appendChild(ts);
    line.appendChild(msg);
    debugLog.appendChild(line);
  });
  debugLog.scrollTop = debugLog.scrollHeight;
}

function refreshDebug() {
  if (!debugVisible) return;
  chrome.runtime.sendMessage({ type: "GET_DEBUG" }, (response) => {
    if (chrome.runtime.lastError || !response) return;
    renderDebugLogs(response.logs);
  });
}

debugToggle.addEventListener("click", () => {
  debugVisible = !debugVisible;
  debugPanel.classList.toggle("open", debugVisible);
  debugToggle.textContent = debugVisible ? "▲ debug" : "▼ debug";
  if (debugVisible) refreshDebug();
});

document.getElementById("debugCopy").addEventListener("click", () => {
  chrome.runtime.sendMessage({ type: "GET_DEBUG" }, (response) => {
    if (!response?.logs) return;
    const text = response.logs
      .map((l) => `[${l.ts}] [${l.level}] ${l.msg}`)
      .join("\n");
    navigator.clipboard.writeText(text).then(() => {
      document.getElementById("debugCopy").textContent = "copied!";
      setTimeout(() => {
        document.getElementById("debugCopy").textContent = "copy";
      }, 1500);
    });
  });
});

document.getElementById("debugClear").addEventListener("click", () => {
  debugLog.innerHTML = "";
});

// ── Init ──────────────────────────────────────────────────────────────────────

async function init() {
  setStatus("loading", "loading model");
  showState(
    "📦",
    "Loading AI model…",
    "This only happens once. Future searches are instant.",
  );

  // Check if debug is enabled in background
  chrome.runtime.sendMessage({ type: "GET_DEBUG" }, (response) => {
    if (response?.debug) {
      debugEnabled = true;
      debugToggle.style.display = "flex";
      // Auto-open the debug panel since DEBUG=true
      debugVisible = true;
      debugPanel.classList.add("open");
      debugToggle.textContent = "▲ debug";
      refreshDebug();
    }
  });

  chrome.runtime.sendMessage({ type: "INIT" }, (response) => {
    if (chrome.runtime.lastError) {
      setStatus("error", "error");
      showState("❌", "Something went wrong", chrome.runtime.lastError.message);
      return;
    }
    if (response?.status === "ready") {
      onReady(response.count);
    } else {
      pollReady();
    }
  });
}

function pollReady() {
  if (pollInterval) clearInterval(pollInterval);
  pollInterval = setInterval(() => {
    chrome.runtime.sendMessage({ type: "STATUS" }, (response) => {
      if (chrome.runtime.lastError) {
        clearInterval(pollInterval);
        setStatus("error", "error");
        return;
      }

      if (debugVisible) refreshDebug();

      if (response?.progress !== undefined) showProgress(response.progress);

      if (response?.status === "ready") {
        clearInterval(pollInterval);
        hideProgress();
        onReady(response.count);
      } else if (response?.status === "indexing") {
        setStatus("loading", "indexing");
        showState(
          "📚",
          "Indexing your bookmarks…",
          `Processing ${response.count || "..."} bookmarks.`,
        );
      } else if (response?.status === "loading") {
        setStatus("loading", "loading model");
      } else if (response?.status === "error") {
        clearInterval(pollInterval);
        setStatus("error", "error");
        showState("❌", "Error", response.message || "Something went wrong.");
        if (debugVisible) refreshDebug();
      }
    });
  }, 700);
}

function onReady(count) {
  if (pollInterval) clearInterval(pollInterval);
  bookmarkCount = count || 0;
  setStatus("ready", "ready");
  footerInfo.textContent = `${bookmarkCount} bookmarks indexed`;
  searchInput.disabled = false;
  searchInput.focus();
  showState("🔍", "Start typing…", "Describe the bookmark in plain English.");
  if (debugVisible) refreshDebug();
}

// ── Search ────────────────────────────────────────────────────────────────────

searchInput.addEventListener("input", () => {
  const q = searchInput.value.trim();
  clearBtn.classList.toggle("visible", q.length > 0);
  clearTimeout(debounceTimer);
  if (!q) {
    showState("🔍", "Start typing…", "Describe the bookmark in plain English.");
    return;
  }
  if (q.length < 2) return;
  setStatus("loading", "searching");
  debounceTimer = setTimeout(() => doSearch(q), 280);
});

clearBtn.addEventListener("click", () => {
  searchInput.value = "";
  clearBtn.classList.remove("visible");
  searchInput.focus();
  showState("🔍", "Start typing…", "Describe the bookmark in plain English.");
  setStatus("ready", "ready");
});

async function doSearch(query) {
  chrome.runtime.sendMessage({ type: "SEARCH", query }, (response) => {
    setStatus("ready", "ready");
    if (chrome.runtime.lastError || !response) {
      showState("❌", "Search failed", "Try re-indexing your bookmarks.");
      return;
    }
    renderResults(response.results, query);
    if (debugVisible) refreshDebug();
  });
}

// ── Render ────────────────────────────────────────────────────────────────────

function renderResults(results, query) {
  resultsArea.innerHTML = "";
  if (!results || results.length === 0) {
    showState(
      "🤷",
      "No matches found",
      `Nothing close to "${query}" in your bookmarks.`,
    );
    return;
  }
  const header = document.createElement("div");
  header.className = "results-header";
  header.textContent = `${results.length} results`;
  resultsArea.appendChild(header);

  results.forEach((item) => {
    const a = document.createElement("a");
    a.className = "result-item";
    a.href = item.url;
    a.title = item.url;
    a.target = "_blank";
    a.rel = "noopener";

    const favicon = document.createElement("img");
    favicon.className = "result-favicon";
    try {
      favicon.src = `https://www.google.com/s2/favicons?domain=${new URL(item.url).hostname}&sz=32`;
    } catch {
      favicon.src = "";
    }
    favicon.onerror = () => {
      const fb = document.createElement("div");
      fb.className = "result-favicon-fallback";
      fb.textContent = item.title?.[0]?.toUpperCase() || "?";
      a.replaceChild(fb, favicon);
    };

    const body = document.createElement("div");
    body.className = "result-body";
    const title = document.createElement("div");
    title.className = "result-title";
    title.textContent = item.title || "Untitled";
    const url = document.createElement("div");
    url.className = "result-url";
    try {
      const u = new URL(item.url);
      url.textContent = u.hostname + u.pathname.replace(/\/$/, "");
    } catch {
      url.textContent = item.url;
    }
    body.appendChild(title);
    body.appendChild(url);

    const score = document.createElement("div");
    score.className = "result-score";
    score.textContent = `${Math.round(item.score * 100)}%`;

    a.appendChild(favicon);
    a.appendChild(body);
    a.appendChild(score);
    a.addEventListener("click", (e) => {
      e.preventDefault();
      chrome.tabs.create({ url: item.url });
      window.close();
    });
    resultsArea.appendChild(a);
  });
}

// ── Re-index ──────────────────────────────────────────────────────────────────

reindexBtn.addEventListener("click", () => {
  searchInput.value = "";
  searchInput.disabled = true;
  clearBtn.classList.remove("visible");
  setStatus("loading", "indexing");
  showState("📚", "Re-indexing…", "Rebuilding the bookmark index.");
  showProgress(5);
  chrome.runtime.sendMessage({ type: "REINDEX" }, () => pollReady());
});

// ── Start ─────────────────────────────────────────────────────────────────────

init();
