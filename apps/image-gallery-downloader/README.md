# Gallery Image Downloader

A fresh Manifest V3 Chrome extension inspired by Imageye, with the image browser built around a gallery grid instead of a single timeline.

## Features

- Side panel UI opened from the extension toolbar.
- Scans the active tab for `img`, `picture/source`, CSS background images, video posters, favicons, and image-like resource entries.
- Dedupes repeated URLs across frames and sources.
- Gallery cards with thumbnail preview, source type, dimensions, display size, file type, and size metadata when available.
- Filters by URL/text, file type, visible-only, and an overall-size slider that defaults to images equivalent to 50 x 50 pixels or larger.
- Sorts largest-first by default, with a one-click reverse button for smallest-first.
- Dark side-panel UI with a minimal default toolbar and settings collapsed by default.
- Default gallery cards are image-first, with selection controls hidden and a single-image download button shown on hover.
- Column slider defaults to 4 images per row and can range from a single-column view to 8 columns.
- Quick JPG and PNG type chips, both enabled by default.
- Custom toolbar icon for easier identification in Chrome.
- Save current controls as the extension defaults.
- Select all visible, clear selection, single-image download, and bulk download.
- Download-all-visible shortcut.
- Downloads originals or converts selected images to JPG, PNG, or WEBP.
- Copies original URLs, opens image URLs, and launches reverse image search.
- Compact and comfortable gallery density modes.

## Load In Chrome

1. Open `chrome://extensions`.
2. Enable `Developer mode`.
3. Click `Load unpacked`.
4. Select:

   ```text
   C:\Users\lucyl\Desktop\hold\projects\chrome_extensions\image-gallery-downloader
   ```

5. Open any normal webpage and click the extension icon. Chrome opens the side panel and starts scanning.

## Notes

- Chrome blocks extension injection on internal pages such as `chrome://extensions`, the Chrome Web Store, and DevTools pages.
- Some sites protect images behind short-lived URLs, login cookies, strict referrers, or canvas restrictions. Original downloads usually work best; conversion depends on whether the extension can fetch and decode the image bytes.
- Opening `sidepanel.html` directly in a browser shows a small preview dataset. Live scanning and downloads require loading the folder as an unpacked extension.
