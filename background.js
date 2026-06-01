// background.js — Service worker for Bookmark Semantic Search
// Uses transformers.js (via CDN) to run all-MiniLM-L6-v2 locally in the browser.

import { pipeline, env } from 'https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.2/dist/transformers.min.js';

// Don't use local model files — fetch from CDN
env.allowLocalModels = false;
env.useBrowserCache = true;

// ── State ─────────────────────────────────────────────────────────────────────

let state = 'idle'; // idle | loading | indexing | ready | error
let errorMessage = '';
let embedder = null;
let indexedBookmarks = []; // { id, title, url, embedding: Float32Array }
let progress = 0;
let bookmarkCount = 0;

// ── Cosine similarity ─────────────────────────────────────────────────────────

function cosineSimilarity(a, b) {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

// ── Flatten Chrome bookmark tree ──────────────────────────────────────────────

function flattenBookmarks(nodes, results = []) {
  for (const node of nodes) {
    if (node.url) {
      results.push({ id: node.id, title: node.title || 'Untitled', url: node.url });
    }
    if (node.children) {
      flattenBookmarks(node.children, results);
    }
  }
  return results;
}

// ── Storage helpers ───────────────────────────────────────────────────────────

const STORAGE_KEY = 'bookmark_index_v1';

async function saveIndex(bookmarks) {
  // Store as plain arrays (Float32Array isn't JSON-serializable directly)
  const serializable = bookmarks.map(b => ({
    id: b.id,
    title: b.title,
    url: b.url,
    embedding: Array.from(b.embedding),
  }));
  await chrome.storage.local.set({ [STORAGE_KEY]: serializable });
}

async function loadIndex() {
  const result = await chrome.storage.local.get(STORAGE_KEY);
  const data = result[STORAGE_KEY];
  if (!data) return null;
  return data.map(b => ({
    ...b,
    embedding: new Float32Array(b.embedding),
  }));
}

async function clearIndex() {
  await chrome.storage.local.remove(STORAGE_KEY);
}

// ── Embed text ────────────────────────────────────────────────────────────────

async function embed(text) {
  const output = await embedder(text, { pooling: 'mean', normalize: true });
  return output.data; // Float32Array
}

// ── Main init flow ────────────────────────────────────────────────────────────

async function initialize(forceReindex = false) {
  if (state === 'loading' || state === 'indexing') return;

  try {
    state = 'loading';
    progress = 5;

    // Load the embedding model
    embedder = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2', {
      progress_callback: (p) => {
        if (p.status === 'downloading' || p.status === 'loading') {
          // Rough 0-60% for model loading
          progress = Math.min(60, Math.round((p.loaded / (p.total || 1)) * 60));
        }
      },
    });

    progress = 65;

    // Try loading cached index unless forced reindex
    if (!forceReindex) {
      const cached = await loadIndex();
      if (cached && cached.length > 0) {
        // Check if bookmarks have changed
        const tree = await chrome.bookmarks.getTree();
        const current = flattenBookmarks(tree);

        if (current.length === cached.length) {
          indexedBookmarks = cached;
          bookmarkCount = cached.length;
          state = 'ready';
          progress = 100;
          return;
        }
      }
    }

    // Need to (re)index
    await buildIndex();

  } catch (err) {
    state = 'error';
    errorMessage = err.message || 'Failed to initialize.';
    console.error('[BookmarkSearch] Init error:', err);
  }
}

async function buildIndex() {
  state = 'indexing';

  const tree = await chrome.bookmarks.getTree();
  const bookmarks = flattenBookmarks(tree);
  bookmarkCount = bookmarks.length;

  const embedded = [];
  const BATCH_SIZE = 8;

  for (let i = 0; i < bookmarks.length; i += BATCH_SIZE) {
    const batch = bookmarks.slice(i, i + BATCH_SIZE);

    await Promise.all(batch.map(async (bm) => {
      const text = `${bm.title} ${bm.url}`.slice(0, 512);
      try {
        const embedding = await embed(text);
        embedded.push({ ...bm, embedding });
      } catch {
        // skip failed bookmarks
      }
    }));

    // Progress: 65% → 95% during indexing
    progress = 65 + Math.round(((i + BATCH_SIZE) / bookmarks.length) * 30);
  }

  indexedBookmarks = embedded;
  await saveIndex(embedded);

  state = 'ready';
  progress = 100;
}

// ── Search ────────────────────────────────────────────────────────────────────

async function search(query, topK = 8) {
  if (state !== 'ready' || !embedder) throw new Error('Not ready');

  const queryEmbedding = await embed(query);

  const scored = indexedBookmarks.map(bm => ({
    id: bm.id,
    title: bm.title,
    url: bm.url,
    score: cosineSimilarity(queryEmbedding, bm.embedding),
  }));

  scored.sort((a, b) => b.score - a.score);

  // Return top results with score above threshold
  return scored.slice(0, topK).filter(r => r.score > 0.15);
}

// ── Message handler ───────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    try {
      if (message.type === 'INIT') {
        if (state === 'ready') {
          sendResponse({ status: 'ready', count: bookmarkCount });
        } else {
          initialize(); // kick off async
          sendResponse({ status: state, progress, count: bookmarkCount });
        }

      } else if (message.type === 'STATUS') {
        sendResponse({ status: state, progress, count: bookmarkCount, message: errorMessage });

      } else if (message.type === 'SEARCH') {
        const results = await search(message.query);
        sendResponse({ results });

      } else if (message.type === 'REINDEX') {
        await clearIndex();
        indexedBookmarks = [];
        state = 'idle';
        progress = 0;
        initialize(true);
        sendResponse({ status: 'started' });
      }
    } catch (err) {
      sendResponse({ error: err.message });
    }
  })();

  return true; // keep message channel open for async
});

// Auto-init when service worker starts
initialize();
