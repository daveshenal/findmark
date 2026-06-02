# <img src="icons/icon48.png" width="32" valign="middle"> Findmark - Bookmark Search

**Find saved bookmarks by describing them - not by remembering the exact title.**

<img src="assets/demo.gif" alt="Findmark demo" width="80%">

If you have hundreds of bookmarks, you have probably been there: you know you saved something, but you cannot recall what it was called or which folder it is in. Findmark lets you search the way you would ask a friend - in your own words.

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

1. **Download the latest release** - go to the [Releases page](../../releases/latest) and download `findmark.zip`, then unzip it.
2. **Open extensions in your browser**
   - Chrome or Brave: type `chrome://extensions` in the address bar and press Enter
   - Edge: type `edge://extensions` and press Enter
3. Turn on **Developer mode** (usually a switch in the top-right corner).
4. Click **Load unpacked** and choose the folder you unzipped.
5. Pin **Findmark** to your toolbar (puzzle-piece icon → pin) so it is easy to open.

**The first time you open it:** Findmark downloads a 23 MB AI model file once, then saves it in your browser. That can take 10–30 seconds depending on your internet speed. It also reads through your bookmarks once to build the search index. A progress bar in the popup shows what is happening. After that, startup is much faster.

<table>
  <tr>
    <td><b>Initial Setup</b></td>
    <td><b>Search Ready</b></td>
  </tr>
  <tr>
    <td width="400" valign="top"><img src="assets/screenshots/first_start.png" width="100%"></td>
    <td width="400" valign="top"><img src="assets/screenshots/search.png" width="100%"></td>
  </tr>
</table>

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

## How it works

1. **Model** - On startup, the background service worker loads `Xenova/all-MiniLM-L6-v2` using a bundled ONNX Runtime WASM build (`lib/ort-wasm-simd.wasm`). Threading is disabled to stay compatible with MV3 service workers.
2. **Index** - Each bookmark's title and URL (up to 512 characters) is embedded in batches of 8. Vectors are L2-normalized mean-pooled outputs (384 dimensions).
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

## Project structure

```
findmark/
├── manifest.json            # MV3 manifest (v1.0.0)
├── background.js            # Model load, indexing, search, storage
├── popup.html               # Popup UI
├── popup.js                 # Search UI, status polling, results
├── lib/
│   ├── transformers.min.js  # Xenova/transformers.js — in-browser ML inference
│   ├── ort-wasm.wasm        # ONNX Runtime WASM (fallback)
│   └── ort-wasm-simd.wasm   # ONNX Runtime WASM with SIMD (primary)
├── icons/
├── assets/
│   ├── demo.gif             # README demo
│   └── screenshots/
├── LICENSE
└── README.md
```

---

## Tech stack

| Piece                     | Role                                                       |
| ------------------------- | ---------------------------------------------------------- |
| **transformers.js**       | In-browser inference (WebAssembly)                         |
| **all-MiniLM-L6-v2**      | Sentence embedding model (~23 MB)                          |
| **Chrome Extensions MV3** | Service worker, `bookmarks`, `storage`, `unlimitedStorage` |
| **Cosine similarity**     | Ranking without an external vector database                |

---

## Debug mode

Set `DEBUG = true` at the top of `background.js` to expose the in-popup debug log (copy/clear).

<img src="assets/screenshots/debug_logs.png" width="400">

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

Bookmarks themselves are not sent to those services - only the model fetch and the UI resources above. You can audit the code; it's MIT-licensed open source.

---

## Tips and limits

- Search quality depends on bookmark titles — a title like "Python decorator tutorial" will match better than "Untitled" or a bare URL.
- English works best; other languages may work but are untested with this model.
- First-time indexing gets slower with larger libraries, but the cache keeps it fast after that. Storage stays reasonable (~2 MB for thousands of bookmarks).
- **Firefox is not supported** — Findmark uses Chromium-only APIs (`chrome.*`) and MV3 service worker features.

---

## What’s next

Have an idea or found a bug? [Open an issue](../../issues) - feedback is welcome.

Things being considered for future versions:

- [ ] Page content indexing - embed actual page text for richer, more accurate search
- [ ] Keyboard shortcut to open Findmark from any tab
- [ ] Firefox support

---

## License

MIT © [Dave Perera](LICENSE) (2026). See [LICENSE](LICENSE) for full terms.

---

<p align="center">
If Findmark is useful or you like the idea, consider leaving a ⭐ to help more people find it.
</p>
