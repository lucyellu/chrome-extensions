# Smart Ad Filter Plan

## Core Idea

Build a Chrome extension that keeps browsing quiet by default:

- Block or hide ads in the moment.
- Log what was blocked or hidden.
- Let the user review later.
- Let the user mark each ad as `yes` or `no`.
- Allow a previous `yes` to be rescinded later.
- Export the log as Markdown or JSON so the record is not trapped in Chrome storage.

The product should not ask the user to whitelist whole websites. The interesting unit is the individual ad.

## MVP Scope

1. Manifest V3 Chrome extension.
2. Network blocking with `chrome.declarativeNetRequest`.
3. Cosmetic page cleanup with a content script for obvious sponsored/ad DOM elements.
4. Local IndexedDB log of ad events.
5. Popup with quick counts and links.
6. Review page with a simple list and two decision buttons: `Yes` and `No`.
7. Rescind support for ads previously marked `Yes`.
8. Weekly report reminder using `chrome.alarms` and `chrome.notifications`.
9. Manual Markdown and JSON exports using `chrome.downloads`.
10. Optional smart filter suggestions over saved ads using an editable OpenAI-compatible provider config.
11. Lightweight ad snapshots for DOM-detected ads.

## Non-Goals For MVP

- No automatic ad clicking.
- No automatic purchase or signup flow.
- No automatic acceptance of AI suggestions.
- No full video, script, iframe, or interactive ad archiving.
- No cloud sync.
- No direct Obsidian/Evernote integration yet.
- No claim of full parity with mature blockers like uBlock Origin.

## Data Model

Ad event:

- `id`
- `createdAt`
- `source`: `network-rule`, `cosmetic`, or future source
- `adUrl`
- `adDomain`
- `pageUrl`
- `pageDomain`
- `pageTitle`
- `resourceType`
- `ruleId`
- `rulesetId`
- `decision`: `yes`, `no`, or `null`
- `status`: `unseen`, `seen`, or `rescinded`
- `tags`
- `notes`
- `recommendedBy`: reserved for future model attribution
- `recommendationMeta`: reserved for prompt/model/version/device metadata

The decision stays neutral: `yes` means "show me/this was worth attention"; `no` means "not worth attention."

## Export Format

Markdown is the main human-readable backup format. It should work well in an Obsidian vault after download.

Example:

```md
# Ad Log - 2026-05-04

## Yes

- Example offer
  - Seen on: example.com
  - Ad: ads.example.com/campaign
  - Status: seen

## No

- Tracking or low-value ad
  - Seen on: news.example.com
  - Ad: doubleclick.net/...

## Unreviewed

- Sponsored result
  - Seen on: google.com
  - Ad: googleadservices.com/...
```

JSON export is included for future import, migration, or model analysis.

## Future AI Layer

AI should be an assistant, not the judge.

Future fields should record:

- model provider
- model name
- prompt version
- recommendation timestamp
- confidence or score
- short reason
- whether the user accepted the recommendation
- whether the user later rescinded it

The user verdict remains the source of truth.

## Smart Filter Dev Branch

The first smart filter should:

- run only when the user clicks it
- process unreviewed saved ads in a small batch
- call an editable OpenAI-compatible endpoint
- default to DeepSeek `deepseek-v4-flash`
- request strict JSON output
- save a suggested `yes` or `no`
- keep the user's final `decision` untouched

Secrets must stay out of Git. API keys are entered through the extension UI and stored locally.

## Implementation Notes

- Use plain HTML/CSS/JS for the first version to avoid unnecessary build tooling.
- Use IndexedDB for logs, not only `chrome.storage.local`.
- Use `chrome.downloads` for backup exports.
- Use `chrome.alarms` for weekly/monthly report cadence.
- Use `chrome.declarativeNetRequest.onRuleMatchedDebug` when available in unpacked/dev mode to record exact rule matches.
- Use content-script logging as a second path for visible sponsored/ad elements.
- Save lightweight ad receipts for DOM-detected ads: text, link, image URL, selector, capture time, and sanitized/truncated HTML.
