# CodePen Library Saver

A Manifest V3 Chrome extension that opens as a companion side panel on CodePen and saves Pens as standalone `.html` files.

## What It Does

- Opens a Chrome side panel from the extension toolbar button.
- Saves the active `codepen.io` Pen into a searchable local library.
- Saves every currently open CodePen Pen tab into one chosen folder.
- Builds one standalone HTML file from CodePen's raw `.html`, `.css`, and `.js` URL extensions.
- Shows a preview thumbnail and a link back to the original Pen.
- Adds folders and comma-separated tags for organizing saved Pens.
- Selects multiple Pens for combined copy, single-file HTML export, or ZIP export.
- Copies saved HTML to the clipboard.
- Downloads saved HTML into a configurable Chrome Downloads subfolder.
- Exports the full library as a restorable ZIP with `library.json`, `metadata.json`, and HTML files.
- Imports a previously exported library ZIP on another Chrome profile.
- Imports a folder of loose `.html` files exported earlier.
- Seeds an empty local library from `public/imports/codepen-library-seed.json` when that file exists.
- Repairs older saved entries by refetching runnable CodePen Debug View HTML when available, then overwriting the downloaded `.html` files.

## Build

```bash
npm install
npm run build
```

The unpacked extension is generated in:

```text
dist
```

This project also includes a root `manifest.json`, so Chrome can load either the project folder or the `dist` folder.

## Install In Chrome

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked**.
4. Select this project folder, or select the `dist` folder directly.
5. Pin **CodePen Library Saver** and open any CodePen Pen.

## Folder Behavior

Chrome extensions cannot silently write to an arbitrary folder on your computer. This extension uses `chrome.downloads` and saves files inside the Chrome Downloads directory under the subfolder shown in the side panel, defaulting to:

```text
CodePen Library
```

You can change that subfolder name in the side panel. Use the per-item **HTML** button with Save As if you want to choose a different destination for one file.

## Notes

CodePen does not currently expose a full public REST API for Pen source. This extension uses CodePen's documented oEmbed endpoint for metadata, Debug View when available for runnable standalone HTML, and raw file URL extensions as a fallback. Pens that are private, deleted, or unavailable as resources may still require a manual check after export.
