// popup.js — UI logic for Bookmark Semantic Search

const searchInput = document.getElementById('searchInput');
const clearBtn = document.getElementById('clearBtn');
const resultsArea = document.getElementById('resultsArea');
const stateMessage = document.getElementById('stateMessage');
const statusDot = document.getElementById('statusDot');
const statusText = document.getElementById('statusText');
const footerInfo = document.getElementById('footerInfo');
const reindexBtn = document.getElementById('reindexBtn');
const progressWrap = document.getElementById('progressWrap');
const progressBar = document.getElementById('progressBar');

let debounceTimer = null;
let bookmarkCount = 0;

// ── Status helpers ────────────────────────────────────────────────────────────

function setStatus(state, text) {
  statusDot.className = `status-dot ${state}`;
  statusText.textContent = text;
}

function showProgress(pct) {
  progressWrap.classList.add('visible');
  progressBar.style.width = `${pct}%`;
}

function hideProgress() {
  progressBar.style.width = '100%';
  setTimeout(() => {
    progressWrap.classList.remove('visible');
    progressBar.style.width = '0%';
  }, 400);
}

function showState(emoji, title, sub) {
  stateMessage.style.display = 'block';

  // Build DOM safely — no innerHTML with dynamic values
  const emojiEl = document.createElement('span');
  emojiEl.className = 'emoji';
  emojiEl.textContent = emoji;

  const titleEl = document.createElement('strong');
  titleEl.textContent = title;

  const subEl = document.createElement('span');
  subEl.textContent = sub; // textContent, never innerHTML

  stateMessage.replaceChildren(emojiEl, titleEl, subEl);
  resultsArea.replaceChildren(stateMessage);
}

// ── Init ──────────────────────────────────────────────────────────────────────

async function init() {
  setStatus('loading', 'loading model');
  showState('⚡', 'Loading AI model…', 'This only happens once. Future searches are instant.');

  // Ask background to initialize (loads transformers.js + indexes bookmarks)
  chrome.runtime.sendMessage({ type: 'INIT' }, (response) => {
    if (chrome.runtime.lastError) {
      setStatus('error', 'error');
      showState('❌', 'Something went wrong', chrome.runtime.lastError.message);
      return;
    }

    if (response?.status === 'ready') {
      onReady(response.count);
    } else {
      // Poll until ready
      pollReady();
    }
  });
}

function pollReady() {
  const interval = setInterval(() => {
    chrome.runtime.sendMessage({ type: 'STATUS' }, (response) => {
      if (chrome.runtime.lastError) {
        clearInterval(interval);
        setStatus('error', 'error');
        return;
      }

      if (response?.progress !== undefined) {
        showProgress(response.progress);
      }

      if (response?.status === 'ready') {
        clearInterval(interval);
        hideProgress();
        onReady(response.count);
      } else if (response?.status === 'indexing') {
        setStatus('loading', 'indexing');
        showState('📚', 'Indexing your bookmarks…', `Processing ${response.count || '...'} bookmarks. Hold tight!`);
      } else if (response?.status === 'error') {
        clearInterval(interval);
        setStatus('error', 'error');
        showState('❌', 'Error', response.message || 'Something went wrong.');
      }
    });
  }, 600);
}

function onReady(count) {
  bookmarkCount = count || 0;
  setStatus('ready', 'ready');
  footerInfo.textContent = `${bookmarkCount} bookmarks indexed`;
  searchInput.disabled = false;
  searchInput.focus();
  showState('🔍', 'Start typing…', 'Describe the bookmark in plain English.');
}

// ── Search ────────────────────────────────────────────────────────────────────

searchInput.addEventListener('input', () => {
  const q = searchInput.value.trim();
  clearBtn.classList.toggle('visible', q.length > 0);

  clearTimeout(debounceTimer);

  if (!q) {
    showState('🔍', 'Start typing…', 'Describe the bookmark in plain English.');
    return;
  }

  if (q.length < 2) return;

  setStatus('loading', 'searching');
  debounceTimer = setTimeout(() => doSearch(q), 280);
});

clearBtn.addEventListener('click', () => {
  searchInput.value = '';
  clearBtn.classList.remove('visible');
  searchInput.focus();
  showState('🔍', 'Start typing…', 'Describe the bookmark in plain English.');
  setStatus('ready', 'ready');
});

async function doSearch(query) {
  chrome.runtime.sendMessage({ type: 'SEARCH', query }, (response) => {
    setStatus('ready', 'ready');

    if (chrome.runtime.lastError || !response) {
      showState('❌', 'Search failed', 'Try re-indexing your bookmarks.');
      return;
    }

    renderResults(response.results, query);
  });
}

// ── Render ────────────────────────────────────────────────────────────────────

function renderResults(results, query) {
  resultsArea.innerHTML = '';

  if (!results || results.length === 0) {
    showState('🤷', 'No matches found', `Nothing close to "${query}" in your bookmarks.`);
    return;
  }

  const header = document.createElement('div');
  header.className = 'results-header';
  header.textContent = `${results.length} results`;
  resultsArea.appendChild(header);

  results.forEach((item, i) => {
    const a = document.createElement('a');
    a.className = 'result-item';
    a.href = item.url;
    a.title = item.url;
    a.target = '_blank';
    a.rel = 'noopener';

    // Favicon
    const faviconUrl = `https://www.google.com/s2/favicons?domain=${encodeURIComponent(new URL(item.url).hostname)}&sz=32`;
    const favicon = document.createElement('img');
    favicon.className = 'result-favicon';
    favicon.src = faviconUrl;
    favicon.onerror = () => {
      const fallback = document.createElement('div');
      fallback.className = 'result-favicon-fallback';
      fallback.textContent = item.title?.[0]?.toUpperCase() || '?';
      a.replaceChild(fallback, favicon);
    };

    // Body
    const body = document.createElement('div');
    body.className = 'result-body';

    const title = document.createElement('div');
    title.className = 'result-title';
    title.textContent = item.title || 'Untitled';

    const url = document.createElement('div');
    url.className = 'result-url';
    try {
      const u = new URL(item.url);
      url.textContent = u.hostname + u.pathname.replace(/\/$/, '');
    } catch {
      url.textContent = item.url;
    }

    body.appendChild(title);
    body.appendChild(url);

    // Score
    const score = document.createElement('div');
    score.className = 'result-score';
    score.textContent = `${Math.round(item.score * 100)}%`;

    a.appendChild(favicon);
    a.appendChild(body);
    a.appendChild(score);

    // Open tab on click
    a.addEventListener('click', (e) => {
      e.preventDefault();
      chrome.tabs.create({ url: item.url });
      window.close();
    });

    resultsArea.appendChild(a);
  });
}

// ── Re-index ──────────────────────────────────────────────────────────────────

reindexBtn.addEventListener('click', () => {
  searchInput.value = '';
  searchInput.disabled = true;
  clearBtn.classList.remove('visible');
  setStatus('loading', 'indexing');
  showState('📚', 'Re-indexing…', 'Rebuilding the bookmark index.');
  showProgress(5);

  chrome.runtime.sendMessage({ type: 'REINDEX' }, () => {
    pollReady();
  });
});

// ── Start ─────────────────────────────────────────────────────────────────────

init();
