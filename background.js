// background.js — Service worker for Bookmark Semantic Search
// Uses transformers.js (local bundle) to run all-MiniLM-L6-v2 in the browser.

import { pipeline, env } from './lib/transformers.min.js';

// ── Dev config ────────────────────────────────────────────────────────────────
// Set DEBUG = true to enable the debug panel in the popup.
const DEBUG = true;

// MV3 service workers don't support URL.createObjectURL or SharedArrayBuffer,
// so we must disable threading and SIMD-threaded WASM. Instead we point
// transformers.js at our locally bundled ort-wasm-simd.wasm.
env.allowLocalModels = false;
env.useBrowserCache = true;

// Disable all threading — service workers can't spawn Worker threads
env.backends.onnx.wasm.numThreads = 1;

// Point ONNX runtime at our locally bundled WASM files (no CDN, no Workers)
const WASM_BASE = chrome.runtime.getURL('lib/');
env.backends.onnx.wasm.wasmPaths = WASM_BASE;

// ── State ─────────────────────────────────────────────────────────────────────

let state = 'idle'; // idle | loading | indexing | ready | error
let errorMessage = '';
let embedder = null;
let indexedBookmarks = [];
let progress = 0;
let bookmarkCount = 0;

// ── Debug log ─────────────────────────────────────────────────────────────────

const debugLog = [];

function dbg(level, ...args) {
  const entry = {
    ts: new Date().toISOString().slice(11, 23),
    level, // 'info' | 'warn' | 'error'
    msg: args.map(a => {
      try { return typeof a === 'object' ? JSON.stringify(a) : String(a); }
      catch { return '[unserializable]'; }
    }).join(' '),
  };
  debugLog.push(entry);
  if (debugLog.length > 200) debugLog.shift();
  console[level === 'error' ? 'error' : level === 'warn' ? 'warn' : 'log'](
    `[BookmarkSearch ${entry.ts}]`, ...args
  );
}

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
    if (node.children) flattenBookmarks(node.children, results);
  }
  return results;
}

// ── Storage helpers ───────────────────────────────────────────────────────────
// Quantize embeddings to int8 (4x smaller: 384 bytes vs 1536 per bookmark).
// 5000 bookmarks ≈ 1.9 MB quantized vs 7.5 MB raw float32.

const STORAGE_KEY = 'bookmark_index_v2';

function quantizeEmbedding(f32) {
  let max = 0;
  for (let i = 0; i < f32.length; i++) {
    const abs = Math.abs(f32[i]);
    if (abs > max) max = abs;
  }
  const scale = max > 0 ? 127 / max : 1;
  const i8 = new Int8Array(f32.length);
  for (let i = 0; i < f32.length; i++) i8[i] = Math.round(f32[i] * scale);
  return { i8: Array.from(i8), scale };
}

function dequantizeEmbedding({ i8, scale }) {
  const f32 = new Float32Array(i8.length);
  const inv = 1 / scale;
  for (let i = 0; i < i8.length; i++) f32[i] = i8[i] * inv;
  return f32;
}

async function saveIndex(bookmarks) {
  const serializable = bookmarks.map(b => {
    const { i8, scale } = quantizeEmbedding(b.embedding);
    return { id: b.id, title: b.title, url: b.url, i8, scale };
  });
  await chrome.storage.local.set({ [STORAGE_KEY]: serializable });
  dbg('info', `Saved ${bookmarks.length} bookmarks to storage`);
}

async function loadIndex() {
  const result = await chrome.storage.local.get(STORAGE_KEY);
  const data = result[STORAGE_KEY];
  if (!data) return null;
  return data.map(b => ({
    id: b.id, title: b.title, url: b.url,
    embedding: dequantizeEmbedding({ i8: b.i8, scale: b.scale }),
  }));
}

async function clearIndex() {
  await chrome.storage.local.remove(STORAGE_KEY);
  dbg('info', 'Cleared storage index');
}

// ── Embed text ────────────────────────────────────────────────────────────────

async function embed(text) {
  const output = await embedder(text, { pooling: 'mean', normalize: true });
  return output.data;
}

// ── Main init flow ────────────────────────────────────────────────────────────

async function initialize(forceReindex = false) {
  if (state === 'loading' || state === 'indexing') {
    dbg('info', 'initialize() called but already in state:', state);
    return;
  }

  try {
    state = 'loading';
    progress = 5;
    dbg('info', 'Starting initialization. forceReindex =', forceReindex);
    dbg('info', 'env.allowLocalModels =', env.allowLocalModels, '| env.useBrowserCache =', env.useBrowserCache);

    // Load the embedding model
    dbg('info', 'Loading pipeline: Xenova/all-MiniLM-L6-v2');
    embedder = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2', {
      progress_callback: (p) => {
        dbg('info', `Model progress: status=${p.status} file=${p.file || ''} loaded=${p.loaded || 0} total=${p.total || 0}`);
        if (p.status === 'downloading' || p.status === 'loading' || p.status === 'progress') {
          progress = Math.min(60, Math.round(((p.loaded || 0) / (p.total || 1)) * 60));
        }
        if (p.status === 'done') {
          progress = 62;
          dbg('info', 'File done:', p.file);
        }
        if (p.status === 'ready') {
          progress = 65;
          dbg('info', 'Pipeline ready');
        }
      },
    });

    dbg('info', 'Pipeline loaded successfully');
    progress = 65;

    // Try loading cached index unless forced reindex
    if (!forceReindex) {
      dbg('info', 'Checking for cached index...');
      const cached = await loadIndex();
      if (cached && cached.length > 0) {
        dbg('info', `Found cached index with ${cached.length} bookmarks`);
        const tree = await chrome.bookmarks.getTree();
        const current = flattenBookmarks(tree);
        dbg('info', `Current bookmark count: ${current.length}`);
        const fingerprint = (bms) =>
          bms.map(b => `${b.id}:${b.title}:${b.url}`).sort().join('|');
        if (fingerprint(current) === fingerprint(cached)) {
          dbg('info', 'Cache is fresh — skipping reindex');
          indexedBookmarks = cached;
          bookmarkCount = cached.length;
          state = 'ready';
          progress = 100;
          return;
        } else {
          dbg('info', 'Cache is stale — reindexing');
        }
      } else {
        dbg('info', 'No cached index found — indexing fresh');
      }
    }

    await buildIndex();

  } catch (err) {
    state = 'error';
    errorMessage = err.message || 'Failed to initialize.';
    dbg('error', 'Initialization failed:', err.message, err.stack || '');
  }
}

async function buildIndex() {
  state = 'indexing';
  dbg('info', 'Building index...');

  const tree = await chrome.bookmarks.getTree();
  const bookmarks = flattenBookmarks(tree);
  bookmarkCount = bookmarks.length;
  dbg('info', `Found ${bookmarks.length} bookmarks to embed`);

  const embedded = [];
  const BATCH_SIZE = 8;

  for (let i = 0; i < bookmarks.length; i += BATCH_SIZE) {
    const batch = bookmarks.slice(i, i + BATCH_SIZE);
    await Promise.all(batch.map(async (bm) => {
      const text = `${bm.title} ${bm.url}`.slice(0, 512);
      try {
        const embedding = await embed(text);
        embedded.push({ ...bm, embedding });
      } catch (e) {
        dbg('warn', `Failed to embed bookmark "${bm.title}": ${e.message}`);
      }
    }));
    // Progress: 65% → 95% during indexing
    progress = 65 + Math.round(((i + BATCH_SIZE) / bookmarks.length) * 30);
  }

  dbg('info', `Embedded ${embedded.length} / ${bookmarks.length} bookmarks`);
  indexedBookmarks = embedded;
  await saveIndex(embedded);
  state = 'ready';
  progress = 100;
  dbg('info', 'Index build complete');
}

// ── Search ────────────────────────────────────────────────────────────────────

async function search(query, topK = 8) {
  if (state !== 'ready' || !embedder) throw new Error('Not ready');
  dbg('info', `Searching: "${query}"`);
  const queryEmbedding = await embed(query);
  const scored = indexedBookmarks.map(bm => ({
    id: bm.id, title: bm.title, url: bm.url,
    score: cosineSimilarity(queryEmbedding, bm.embedding),
  }));
  scored.sort((a, b) => b.score - a.score);
  const results = scored.slice(0, topK).filter(r => r.score > 0.15);
  dbg('info', `Search returned ${results.length} results`);
  return results;
}

// ── Message handler ───────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    try {
      if (message.type === 'INIT') {
        if (state === 'ready') {
          sendResponse({ status: 'ready', count: bookmarkCount });
        } else {
          initialize();
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
      } else if (message.type === 'GET_DEBUG') {
        sendResponse({ logs: debugLog, debug: DEBUG });
      }
    } catch (err) {
      dbg('error', 'Message handler error:', err.message);
      sendResponse({ error: err.message });
    }
  })();
  return true;
});

// Auto-init when service worker starts
dbg('info', 'Service worker started');
dbg('info', 'WASM base path:', WASM_BASE);
dbg('info', 'numThreads:', env.backends.onnx.wasm.numThreads);
initialize();
