# Chrome Extensions

A small monorepo for Chrome extension experiments and finished utilities.

## Apps

- [Ad Filter](apps/ad-filter) - a Manifest V3 ad-blocking and review prototype with local ad logs and optional user-provided AI triage.
- [Chrome Home](apps/chrome-home) - a Manifest V3 calm new-tab dashboard with search, tasks, shortcuts, weather, and daily inspiration.
- [Gallery Image Downloader](apps/image-gallery-downloader) - a Manifest V3 side-panel extension for finding, filtering, previewing, converting, and downloading images from the active tab in a grid gallery.
- [CodePen Library Saver](apps/codepen-library-saver) - a Manifest V3 side-panel extension for saving CodePens as local HTML library files.
- [Session Keeper](apps/session-keeper) - a Manifest V3 session manager for autosaving, manually naming, restoring, copying, and exporting tab sessions.

## Local Development

Each app is self-contained and can be loaded directly from Chrome:

1. Open `chrome://extensions`.
2. Enable `Developer mode`.
3. Click `Load unpacked`.
4. Select the app folder under `apps/`.

For example:

```text
apps/image-gallery-downloader
```

## Repository Layout

```text
apps/
  ad-filter/
  chrome-home/
  codepen-library-saver/
  image-gallery-downloader/
  session-keeper/
```
