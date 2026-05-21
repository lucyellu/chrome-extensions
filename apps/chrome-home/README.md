# Chrome Home

A self-contained Manifest V3 new-tab extension inspired by calm focus dashboards.

## Features

- Flip clock over a warm grainy liquid-gradient background
- Personalized greeting, daily quote, and daily focus
- Search with Google, Bing, DuckDuckGo, or Brave
- Local to-do drawer backed by `chrome.storage.local`
- Editable shortcuts
- Optional weather via Open-Meteo with city search or browser geolocation
- Settings for visibility, units, search provider, and name

## Attribution

The flip-card clock is adapted from Adem Ilter's CodePen, [Countdown Clock](https://codepen.io/ademilter/pen/nazxPX), rewritten locally without jQuery or external runtime dependencies for Manifest V3. The warm grainy palette is inspired by Juxtopposed's [Grainy Gradient, Gaussian Blur](https://codepen.io/Juxtopposed/pen/BaqLEQY), and the interactive liquid motion is inspired by Cameron Knight's [Interactive Liquid Gradient using Three.js](https://codepen.io/cameronknight/pen/ogxWmBP).

## Load in Chrome

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Choose **Load unpacked**.
4. Select `C:\Users\lucyl\Desktop\hold\projects\chrome_extensions\chrome-home`.

Chrome will ask whether to keep the new-tab override after install. Choose **Keep it** to use Chrome Home on new tabs.

## Files

- `manifest.json` declares Manifest V3 and the `chrome_url_overrides.newtab` page.
- `newtab.html`, `styles.css`, and `newtab.js` contain the dashboard.
- `assets/` contains extension icons.
