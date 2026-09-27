# Speed Read

A Chrome extension that compresses whatever you're reading — articles, blog
posts, X/Twitter threads, anything — into three one-line summaries in distinct
registers:

- **ELI5** — one sentence a curious 10-year-old would get
- **Elevator pitch** — one punchy sentence for a busy exec
- **Postdoc abstract** — one dense, technically precise sentence

Everything runs **on-device** with Chrome's built-in Gemini Nano (Prompt API).
No API keys, no cost, nothing leaves your machine.

## Requirements

- Chrome **138+** on Windows, macOS 13+, or Linux
- ~**22 GB free disk** on the drive holding your Chrome profile (one-time model download)
- GPU with **> 4 GB VRAM**, or 16 GB RAM + 4 CPU cores
- If the Prompt API isn't available, the extension degrades to Chrome's
  Summarizer API (fixed summary styles, registers are approximate)

## Install (unpacked)

1. Open `chrome://extensions`
2. Toggle **Developer mode** (top right)
3. **Load unpacked** → select this folder
4. Open the extension's **Options** page → check engine status → download the
   model if prompted (one time, ~2–4 GB)

## Use

| Action | How |
|---|---|
| Summarize current page | `Alt+S`, or click the toolbar icon |
| Summarize a selection | Select text → right-click → **Speed-read selection** |
| Expand a one-liner to a paragraph | Click it in the overlay card |
| Dismiss the overlay | `Esc` or ✕ |
| Side panel (history of this session) | `Alt+Shift+S`, or right-click the toolbar icon → **Open side panel** |
| Test without a page | Options page → **Test it** box |

## How it works

```
trigger (Alt+S / toolbar / context menu)
  → background.js injects lib/Readability.js + content.js (on demand)
  → content.js extracts text:  selection → X thread walker → Readability → raw innerText
  → background.js calls ai.js (in the service worker, or an offscreen
    document if this Chrome doesn't expose the AI APIs to workers)
  → ai.js: one Gemini Nano prompt returns all three registers as JSON
    (falls back to the Summarizer API when Nano isn't available)
  → overlay card renders on the page; entry saved to session history
    (chrome.storage.session — clears when Chrome closes)
```

### Files

| File | Role |
|---|---|
| `manifest.json` | MV3 manifest |
| `background.js` | Service worker: triggers, routing, history |
| `ai.js` | Shared AI module: registers, Prompt API + Summarizer fallback |
| `content.js` | Extraction + overlay card (shadow DOM) |
| `offscreen.html/.js` | AI host fallback for Chromes without worker AI |
| `sidepanel.html/.js` | Side panel: summarize button + session history |
| `options.html/.js` | Engine status, model download, test box |
| `lib/Readability.js` | Vendored Mozilla Readability (article extraction) |
| `tools/make-icons.js` | Regenerates `icons/*.png` (`node tools/make-icons.js`) |

## Ideas / later

- Custom registers (editable prompts in options, stored in `chrome.storage.sync`)
- Optional Claude API key for higher-quality registers on demand
- Persistent history (promote from `storage.session` to `storage.local`)
- Firefox port (WebExtensions + a cloud summarizer, no Gemini Nano there)
