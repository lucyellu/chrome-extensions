# ad-filter

A small Manifest V3 Chrome extension prototype that blocks/hides ads, logs them locally, and lets you review them later with a neutral `yes` / `no` decision.

## Load In Chrome

1. Open `chrome://extensions`.
2. Enable Developer mode.
3. Click "Load unpacked".
4. Select this project folder.

## Current MVP

- Blocks a starter set of common ad/tracker request domains.
- Hides obvious sponsored/ad elements on pages.
- Logs ad events to IndexedDB.
- Provides a popup and review page.
- Exports Markdown or JSON backups.
- Schedules a weekly review reminder.
- Adds optional AI suggestions for saved ads from an OpenAI-compatible provider.
- Saves lightweight ad snapshots when a DOM ad is hidden.

This is a prototype starter, not a full mature ad blocker yet.

## Ad Snapshots

When the content script hides an ad-like page element, it saves a small receipt with available text, link URL, image URL, selector, capture time, and a sanitized HTML excerpt. Network-only blocks still log metadata only.

## Smart Filter

The review page can call an OpenAI-compatible chat completions API and save a suggested `yes` or `no` on unreviewed ads. The default provider settings are:

- Provider: DeepSeek
- Base URL: `https://api.deepseek.com`
- Model: `deepseek-v4-flash`

The API key is entered in the extension UI and stored locally in the extension's IndexedDB. It is not committed to the repository.
