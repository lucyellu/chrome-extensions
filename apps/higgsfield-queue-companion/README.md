# Higgsfield Queue Companion

Unpacked Chrome extension for queueing Higgsfield video generations through the normal web page.

## What it does

- Lets the normal Higgsfield video GUI remain the main input surface.
- When you click Generate while Higgsfield is busy, captures the current prompt/settings/page image and adds it to the queue instead of leaving you at the upgrade popup.
- Shows an in-page queued toast with estimated start and finish time.
- Keeps the side panel as a queue dashboard with active items, estimates, controls, logs, and completed history.
- Stores per-item prompt, optional image, model, resolution, duration, and size.
- Defaults to Seedance Unlimited, 720, 8s, Auto size.
- Watches an open Higgsfield tab and starts the next queued item only when the page appears idle.

## Install

1. Open `chrome://extensions`.
2. Turn on Developer mode.
3. Choose Load unpacked.
4. Select this folder:

   `C:\Users\lucyl\Desktop\hold\projects\chrome-extensions\apps\higgsfield-queue-companion`

5. Open `https://higgsfield.ai/ai/video` and sign in.
6. Click the extension icon to open the side panel when you want to watch the queue/history.
7. Use Higgsfield normally. If you click Generate while another video is busy, the extension queues the current GUI state and shows a wait estimate.


## Quick verification

After reloading the unpacked extension in `chrome://extensions` and refreshing Higgsfield:

- The side panel should say `Build 0.3.0` under the title.
- The Higgsfield page should show a small `HFQ 0.3.0 loaded` badge in the bottom-right corner.
- If the badge is missing, the content script is not injected into that page/frame.
- If the badge appears but clicks still show the upgrade popup, use `Capture current GUI` in the side panel once; that tests whether the extension can read the real Higgsfield form.
## Notes

This does not bypass Higgsfield limits or use an API. It serializes the same web actions you would do manually. Higgsfield can change its DOM at any time, so the side panel includes advanced CSS selector overrides for the prompt field, generate button, and file input if auto-detection fails.

Image capture/upload is best-effort. For normal page captures, the extension tries to infer the currently selected/uploaded Higgsfield page image and later reattach it through Higgsfield's file input. If the image CDN blocks refetching or the site requires a trusted native file picker event, the prompt can still be queued but the image may need manual attachment.

## Local sanity checks

From this folder:

```powershell
Get-Content -Raw manifest.json | ConvertFrom-Json | Out-Null
node --check background.js
node --check sidepanel.js
node --check content.js
```
