// Fallback AI host: used when the built-in AI APIs aren't exposed to the
// service worker. The background script proxies calls here via messages.

import * as AI from './ai.js';

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.target !== 'sr-offscreen') return;
  const fn = AI[msg.fn];
  if (typeof fn !== 'function') {
    sendResponse({ ok: false, error: 'Unknown AI function: ' + msg.fn });
    return;
  }
  fn(...(msg.args || []))
    .then((value) => sendResponse({ ok: true, value }))
    .catch((e) => sendResponse({ ok: false, error: e.message }));
  return true;
});
