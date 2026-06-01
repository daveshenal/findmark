// background.js — Service worker for Bookmark Semantic Search
// Uses transformers.js (via CDN) to run all-MiniLM-L6-v2 locally in the browser.

import { pipeline, env } from './lib/transformers.min.js';

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
// Embeddings are quantized to int8 (4x smaller than float32) to stay well
// within chrome.storage.local quota even for thousands of bookmarks.
// 384-dim float32 = 1536 bytes/bookmark → int8 = 384 bytes/bookmark
// 5000 bookmarks ≈ 1.9 MB quantized vs 7.5 MB raw

const STORAGE_KEY = 'bookmark_index_v2';

function quantizeEmbedding(f32) {
  // Scale to [-127, 127] int8
  let max = 0;
  for (let i = 0; i < f32.length; i++) {
    const abs = Math.abs(f32[i]);
    if (abs > max) max = abs;
  }
  const scale = max > 0 ? 127 / max : 1;
  const i8 = new Int8Array(f32.length);
  for (let i = 0; i < f32.length; i++) {
    i8[i] = Math.round(f32[i] * scale);
  }
  return { i8: Array.from(i8), scale };
}

function dequantizeEmbedding({ i8, scale }) {
  const f32 = new Float32Array(i8.length);
  const invScale = 1 / scale;
  for (let i = 0; i < i8.length; i++) {
    f32[i] = i8[i] * invScale;
  }
  return f32;
}

async function saveIndex(bookmarks) {
  const serializable = bookmarks.map(b => {
    const { i8, scale } = quantizeEmbedding(b.embedding);
    return { id: b.id, title: b.title, url: b.url, i8, scale };
  });
  await chrome.storage.local.set({ [STORAGE_KEY]: serializable });
}

async function loadIndex() {
  const result = await chrome.storage.local.get(STORAGE_KEY);
  const data = result[STORAGE_KEY];
  if (!data) return null;
  return data.map(b => ({
    id: b.id,
    title: b.title,
    url: b.url,
    embedding: dequantizeEmbedding({ i8: b.i8, scale: b.scale }),
  }));
}

async function clearIndex() {
  await chrome.storage.local.remove(STORAGE_KEY);
}



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
        const tree = await chrome.bookmarks.getTree();
        const current = flattenBookmarks(tree);
        // Fingerprint over id+title+url — detects edits, renames, adds, deletes
        // not just count changes
        const fingerprint = (bms) =>
          bms.map(b => `${b.id}:${b.title}:${b.url}`).sort().join('|');
        if (fingerprint(current) === fingerprint(cached)) {
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
