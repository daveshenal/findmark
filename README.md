# <img src="icons/icon48.png" width="32" valign="middle"> Findmark

**Find saved bookmarks by describing them-not by remembering the exact title.**

<img src="assets/demo.gif" alt="Findmark demo - search bookmarks in plain English" width="80%">

If you have hundreds of bookmarks, you have probably been there: you know you saved something, but you cannot recall what it was called or which folder it is in. Findmark lets you search the way you would ask a friend-in your own words.

**Try searching like this:**

- _the pasta recipe I saved last year_
- _that article about getting better sleep_
- _hotel we looked at for our trip_
- _birthday gift ideas for mom_

You do not need the right keywords or the website name. Findmark looks for pages that _mean_ the same thing as what you typed.

**Works in:** Google Chrome, Microsoft Edge, Brave, and other Chromium-based browsers.

**Private by design:** Your bookmarks are read and searched on your computer. You do not sign up, pay, or send your bookmark list to a company to use Findmark. See [Privacy](#privacy) for the few optional internet requests (mostly a one-time setup download).

---

## What you get

- **Search in plain English** - describe the page, not the exact title
- **Free** - no account, no subscription, no API keys
- **Stays on your device** - built for local search, not a cloud bookmark service
- **Remembers your library** - after the first setup, opening Findmark is quick
- **Keeps up with changes** - new or edited bookmarks are picked up automatically; you can also tap **re-index** if you import a big batch at once
- **Works offline** - after the first-time setup, search still works without internet

---

## How to install

1. **Get the extension files** - download this project as a ZIP from GitHub (green **Code** button → **Download ZIP**), then unzip it. You should end up with a folder named `findmark`.
2. **Open extensions in your browser**
   - Chrome or Brave: type `chrome://extensions` in the address bar and press Enter
   - Edge: type `edge://extensions` and press Enter
3. Turn on **Developer mode** (usually a switch in the top-right corner).
4. Click **Load unpacked** and choose the `findmark` folder you unzipped.
5. Pin **Findmark** to your toolbar (puzzle-piece icon → pin) so it is easy to open.

**The first time you open it:** Findmark downloads a small AI helper file (about 23 MB) once, then saves it in your browser. That can take 10–30 seconds depending on your internet. It also reads through your bookmarks once to get ready. A progress bar in the popup shows what is happening. After that, startup is much faster.

---

## How to use

| What you want      | What to do                                                              |
| ------------------ | ----------------------------------------------------------------------- |
| Find a bookmark    | Click the Findmark icon, type a short description, and read the list    |
| Open one           | Click a result - it opens in a new tab                                  |
| Start over         | Click **✕** next to the search box, or delete what you typed            |
| Refresh everything | Click **re-index** at the bottom after importing many bookmarks at once |

Each result shows a **match %** - higher means Findmark thinks that bookmark is a better fit for what you described.

---

## For developers

### How it works

1. **Model** - On startup, the background service worker loads `Xenova/all-MiniLM-L6-v2` using a bundled ONNX Runtime WASM build (`lib/ort-wasm-simd.wasm`). Threading is disabled to stay compatible with MV3 service workers.
2. **Index** - Each bookmark’s title and URL (up to 512 characters) is embedded in batches of 8. Vectors are L2-normalized mean-pooled outputs (384 dimensions).
3. **Cache** - Embeddings are quantized to int8 and stored under `bookmark_index_v2`. A fingerprint of bookmark id, title, and URL skips rebuilds when nothing changed.
4. **Search** - Your query is embedded the same way; cosine similarity ranks bookmarks and the top matches are returned to the popup.

```
Popup (popup.html / popup.js)
    │  INIT · STATUS · SEARCH · REINDEX
    ▼
Service worker (background.js)
    ├── transformers.js + bundled WASM
    ├── chrome.bookmarks API
    └── chrome.storage.local (quantized index)
```

---

### Project structure

```
findmark/
├── manifest.json          # MV3 manifest (v1.0.1)
├── background.js          # Model load, indexing, search, storage
├── popup.html             # Popup UI
├── popup.js               # Search UI, status polling, results
├── style.css              # Popup styles
├── lib/
│   ├── transformers.min.js
│   ├── ort-wasm.wasm
│   └── ort-wasm-simd.wasm
├── icons/
│   ├── icon16.png
│   ├── icon48.png
│   └── icon128.png
├── assets/
│   └── demo.gif           # README demo
├── LICENSE                # MIT
└── README.md
```

---

### Tech stack

| Piece                     | Role                                                       |
| ------------------------- | ---------------------------------------------------------- |
| **transformers.js**       | In-browser inference (WebAssembly)                         |
| **all-MiniLM-L6-v2**      | Sentence embedding model (~23 MB)                          |
| **Chrome Extensions MV3** | Service worker, `bookmarks`, `storage`, `unlimitedStorage` |
| **Cosine similarity**     | Ranking without an external vector database                |

---

## Privacy

**Stays on your device**

- Bookmark titles, URLs, and embeddings are processed and stored locally.
- No analytics, accounts, or third-party search APIs.

**Network (optional / UI only)**

| Request                | When                           | Purpose                                    |
| ---------------------- | ------------------------------ | ------------------------------------------ |
| Hugging Face CDN       | First model load (then cached) | Download `Xenova/all-MiniLM-L6-v2` weights |
| Google Fonts           | Popup open                     | DM Sans / DM Mono typography               |
| Google favicon service | Search results                 | Site icons in the result list              |

Bookmarks themselves are not sent to those services-only the model fetch and the UI resources above. You can audit the code; it’s MIT-licensed open source.

---

## Tips and limits

- Descriptive bookmark titles improve matches; bare URLs still work but are weaker signals.
- English works best; other languages may be hit-or-miss with this model.
- Very large libraries take longer to index on first run; the quantized cache keeps storage reasonable (on the order of ~2 MB for thousands of bookmarks).
- **Firefox** is not supported (Chromium `chrome.*` APIs and MV3 service worker constraints).

---

### Development

Set `DEBUG = true` at the top of `background.js` to expose the in-popup debug log (copy/clear).
