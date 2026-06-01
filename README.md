# 🔖 Bookmark Semantic Search

> Find any bookmark by describing it in plain English - powered by local AI, right in your browser.

Type _"that CSS grid tutorial I saved"_ or _"the article about React performance"_ and it finds the right bookmark - no exact keywords needed.

---

## ✨ Features

- **Semantic search** - understands meaning, not just keywords
- **100% local** - model runs in your browser, bookmarks never leave your device
- **No API keys** - completely free, works offline after first load
- **All browsers** (Chrome/Edge/Brave) - any Chromium-based browser
- **Fast** - searches 1000s of bookmarks in milliseconds
- **Auto-indexed** - picks up your bookmarks automatically

---

## 🚀 Install

### Chrome / Edge / Brave (Developer Mode)

1. **Clone or download** this repo as a ZIP and unzip it
2. Open your browser and go to `chrome://extensions`
3. Enable **Developer mode** (top right toggle)
4. Click **"Load unpacked"**
5. Select the `bookmark-search-extension` folder
6. Click the extension icon in your toolbar 🔖

> **First launch:** The AI model (~23MB) downloads once and is cached. This takes 10–30 seconds depending on your connection. All future launches are instant.

---

## 🧠 How It Works

| Step              | What happens                                                                            |
| ----------------- | --------------------------------------------------------------------------------------- |
| **1. Model load** | `all-MiniLM-L6-v2` loads via `transformers.js` (runs in browser)                        |
| **2. Indexing**   | Every bookmark's title + URL gets converted to a vector embedding                       |
| **3. Caching**    | Embeddings are stored in `chrome.storage.local` - never re-computed unless you re-index |
| **4. Search**     | Your query is embedded and compared to all bookmarks via cosine similarity              |
| **5. Rank**       | Top matches returned, ranked by semantic closeness                                      |

---

## 🎮 Usage

| Action        | How                                                                |
| ------------- | ------------------------------------------------------------------ |
| Search        | Type naturally in the search box                                   |
| Open bookmark | Click any result                                                   |
| Clear search  | Click ✕ or clear the input                                         |
| Re-index      | Click **re-index** in the footer (use after adding many bookmarks) |

---

## 📁 Project Structure

```
bookmark-search-extension/
├── manifest.json       # Extension config (MV3)
├── popup.html          # Search UI
├── popup.js            # UI logic
├── background.js       # Service worker - embeddings + search
├── icons/
│   ├── icon16.png
│   ├── icon48.png
│   └── icon128.png
└── README.md
```

---

## 🛠 Tech Stack

- **[transformers.js](https://github.com/xenova/transformers.js)** - runs HuggingFace models in the browser via WebAssembly
- **[all-MiniLM-L6-v2](https://huggingface.co/sentence-transformers/all-MiniLM-L6-v2)** - 23MB sentence embedding model, fast & accurate
- **Chrome Extensions Manifest V3** - service workers, `chrome.bookmarks` API
- **`chrome.storage.local`** - persistent embedding cache
- **Cosine similarity** - fast vector search (no external vector DB needed)

---

## 🔒 Privacy

- No data ever leaves your browser
- No external API calls (except CDN for model download on first use)
- Embeddings stored locally in browser storage
- Open source - audit it yourself

---

## 📝 Notes

- Works best with bookmarks that have descriptive titles
- Re-index after importing a large batch of bookmarks
- The model handles English best, but works reasonably for other languages
- Score shown (e.g. `87%`) is cosine similarity - higher = better match
