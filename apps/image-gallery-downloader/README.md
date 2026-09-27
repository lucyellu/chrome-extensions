# Gallery Image Downloader

A fresh Manifest V3 Chrome extension inspired by Imageye, with the image browser built around a gallery grid instead of a single timeline.

## Features

- Side panel UI opened from the extension toolbar.
- Scans the active tab for `img`, `picture/source`, CSS background images, video posters, favicons, and image-like resource entries.
- Native Google Images search results extraction: extracts high-resolution original image URLs, titles, and cached thumbnails directly from Google's embedded data and search anchors, while filtering out Google's internal tracking beacons (`/gen_204`, `/client_204`), telemetry endpoints, and 1x1 lazy placeholder GIFs.
- Anti-hotlinking and broken image resilience: side panel uses a `no-referrer` policy and thumbnail error fallbacks so protected external images load smoothly without 403 Forbidden errors, with automatic fallback from full-res source to cached thumbnail for downloads.
- Dedupes repeated URLs across frames and sources while preserving query-string identities on CDNs like Google's `encrypted-tbn*.gstatic.com`.
- Gallery cards with thumbnail preview, source type, dimensions, the resolution a download would actually fetch, file type, and size metadata when available.
- Ranks real page content above site furniture: the default `Photos first` sort scores each image on size, gallery-cohort size (how many siblings share its CDN path), alt text, and visibility.
- `Hide site graphics` (on by default) drops logos, icons, sprites, badges, spinners, avatars, SVG/ICO assets, sub-64px images, extreme-aspect banners, and analytics beacons from known tracker hosts.
- `Skip related sections` (on by default) drops images that belong to something other than the page subject - other listings, other products, staff avatars, ad units. Each image is labelled with the heading that precedes it in the document, and headings such as `Comparable homes`, `Market insights`, `Customers also bought` or `You might also like` mark their whole block as recommendations. Because it keys off headings rather than site-specific markup, a search or category page whose cards sit under a neutral heading is left untouched.
- `Full resolution` (on by default) rewrites thumbnail URLs to the original frame before downloading, copying, or opening. Host rules cover Zillow, Pinterest, realtor.com, Redfin and Shopify, plus generic size tokens and width query params. Every rewrite is HEAD-verified and falls back to the original URL.
- Filters by URL/text, file type, visible-only, and an overall-size slider that defaults to images equivalent to 50 x 50 pixels or larger. The size floor only applies to images whose dimensions are actually known, so lazy-loaded photos are no longer dropped before they decode.
- Sorts by content score first by default, with a one-click reverse button.
- Dark side-panel UI with a minimal default toolbar and settings collapsed by default.
- Default gallery cards are image-first, with selection controls hidden and a single-image download button shown on hover.
- Column slider defaults to 4 images per row and can range from a single-column view to 8 columns.
- JPG, PNG, WEBP and Other type chips, all enabled by default. WEBP matters: most photo CDNs now serve WEBP, and the earlier JPG/PNG-only default hid every property photo on sites like Zillow.
- Custom toolbar icon for easier identification in Chrome.
- Save current controls as the extension defaults.
- Select all visible, clear selection, single-image download, and bulk download.
- `Download all` saves every visible image as separate files; `Download ZIP` beside it packs the same set into one archive named `<host>-images-<date>.zip`. Both honour the current format, folder and animation settings.
- The ZIP is written by the extension itself - Manifest V3 forbids remote scripts and this project has no bundler, so there is no library to load. Entries are stored uncompressed because JPEG, PNG and WEBP payloads are already compressed. Archives are capped at 65535 entries and 4 GB (the limits of the non-ZIP64 format); the build stops cleanly and tells you rather than emitting a corrupt file.
- Downloads default to `Auto JPG/PNG`: files that are already JPG or PNG are saved byte-for-byte, while WEBP, AVIF, GIF and unknown types are converted. Transparency picks the target - PNG keeps the alpha channel, JPG is used for everything else. `Always JPG`, `Always PNG`, `Always WEBP` and `Original file` remain available.
- `Save to` sets a subfolder inside the browser's download folder; leave it blank to save to Downloads itself. Chrome does not let an extension write outside the download folder, so for any other destination tick `Ask where to save` and pick it in the OS dialog.
- `Keep animation` (on by default) saves animated GIF, WEBP and APNG files unchanged instead of flattening them to a single frame. Animation is detected by decoded frame count, not by file extension.
- Videos found in `<video>` tags are listed alongside images and always download in their original container. Players that stream through MSE/HLS expose only a `blob:` URL and cannot be captured.
- `Only largest of duplicates` (on by default) collapses every variant of the same photo into one card, including the same image published under several extensions - most photo CDNs serve each picture as both `.webp` and `.jpg`. The largest is chosen from the srcset width descriptor, a size token in the URL (`-cc_ft_768`, `_1536x1152`, `-1200w`, `/236x/`), or the decoded size, whichever is known; at equal resolution the format that needs no re-encoding wins.
- Cards render a small variant for speed but download the largest. The meta line shows `downloads <n>px` whenever the file you would get is bigger than the one the page displayed.
- Copies original URLs, opens image URLs, and launches reverse image search.
- Compact and comfortable gallery density modes.

## Load In Chrome

1. Open `chrome://extensions`.
2. Enable `Developer mode`.
3. Click `Load unpacked`.
4. Select:

   ```text
   C:\Users\lucyl\Desktop\hold\projects\chrome-extensions\apps\image-gallery-downloader
   ```

5. Open any normal webpage and click the extension icon. Chrome opens the side panel and starts scanning.

## Notes

- Chrome blocks extension injection on internal pages such as `chrome://extensions`, the Chrome Web Store, and DevTools pages.
- Some sites protect images behind short-lived URLs, login cookies, strict referrers, or canvas restrictions. `Original file` downloads usually work best; conversion depends on whether the extension can fetch and decode the image bytes.
- Converting an animated GIF or WEBP keeps only the first frame. Choose `Original file` to keep the animation.
- Opening `sidepanel.html` directly in a browser shows a small preview dataset. Live scanning and downloads require loading the folder as an unpacked extension.
