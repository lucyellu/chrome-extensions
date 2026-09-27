// Service worker: routing, triggers, history. AI calls run here when the
// built-in AI APIs are exposed to workers, otherwise in an offscreen document.

import * as AI from './ai.js';

const HISTORY_KEY = 'history';
const HISTORY_MAX = 50;

// ---------- AI dispatch (direct or via offscreen document) ----------

let offscreenCreating = null;

async function ensureOffscreen() {
  if (await chrome.offscreen.hasDocument()) return;
  if (!offscreenCreating) {
    offscreenCreating = chrome.offscreen
      .createDocument({
        url: 'offscreen.html',
        reasons: ['DOM_PARSER'],
        justification: "Chrome's built-in AI APIs require a document context in this Chrome version",
      })
      .finally(() => { offscreenCreating = null; });
  }
  await offscreenCreating;
}

async function callAI(fn, args) {
  if (AI.apisExposedHere()) {
    return AI[fn](...args);
  }
  await ensureOffscreen();
  const res = await chrome.runtime.sendMessage({ target: 'sr-offscreen', fn, args });
  if (!res) throw new Error('No response from the AI worker.');
  if (!res.ok) throw new Error(res.error);
  return res.value;
}

// ---------- Triggers ----------

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: 'sr-selection',
    title: 'Speed-read selection',
    contexts: ['selection'],
  });
  chrome.contextMenus.create({
    id: 'sr-open-panel',
    title: 'Open side panel',
    contexts: ['action'],
  });
});

chrome.action.onClicked.addListener((tab) => trigger(tab));

chrome.commands.onCommand.addListener((command, tab) => {
  if (command === 'summarize-page') trigger(tab);
  if (command === 'open-side-panel' && tab?.windowId != null) {
    chrome.sidePanel.open({ windowId: tab.windowId });
  }
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === 'sr-selection') trigger(tab, info.selectionText || null);
  if (info.menuItemId === 'sr-open-panel' && tab?.windowId != null) {
    chrome.sidePanel.open({ windowId: tab.windowId });
  }
});

async function trigger(tab, selectionText = null) {
  if (!tab?.id || !/^https?:/.test(tab.url || '')) {
    flashBadge('!');
    return;
  }
  try {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ['lib/Readability.js', 'content.js'],
    });
  } catch (e) {
    // Pages Chrome refuses to inject into (Web Store, PDFs, etc.)
    flashBadge('!');
    return;
  }
  chrome.tabs.sendMessage(tab.id, { type: 'sr-summarize', selectionText });
}

function flashBadge(text) {
  chrome.action.setBadgeText({ text });
  chrome.action.setBadgeBackgroundColor({ color: '#d63031' });
  setTimeout(() => chrome.action.setBadgeText({ text: '' }), 2500);
}

// ---------- Message routing ----------

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || msg.target === 'sr-offscreen') return; // offscreen doc handles its own

  if (msg.type === 'sr-extracted') {
    handleExtracted(msg, sender);
    return;
  }

  if (msg.type === 'sr-expand') {
    callAI('expand', [msg.register, msg.text])
      .then((value) => sendResponse({ ok: true, value }))
      .catch((e) => sendResponse({ ok: false, error: e.message }));
    return true;
  }

  if (msg.type === 'sr-run-active') {
    chrome.tabs
      .query({ active: true, lastFocusedWindow: true })
      .then(([tab]) => trigger(tab))
      .then(() => sendResponse({ ok: true }))
      .catch((e) => sendResponse({ ok: false, error: e.message }));
    return true;
  }
});

async function handleExtracted(msg, sender) {
  const tabId = sender.tab?.id;
  try {
    const { engine, results } = await callAI('summarizeAll', [
      msg.text,
      { kind: msg.kind, title: msg.title },
    ]);
    if (tabId != null) {
      chrome.tabs.sendMessage(tabId, { type: 'sr-result', engine, results });
    }
    await pushHistory({
      url: msg.url,
      title: msg.title,
      kind: msg.kind,
      engine,
      results,
      ts: Date.now(),
    });
  } catch (e) {
    if (tabId != null) {
      chrome.tabs.sendMessage(tabId, { type: 'sr-error', message: e.message });
    }
  }
}

async function pushHistory(entry) {
  const data = await chrome.storage.session.get(HISTORY_KEY);
  const history = Array.isArray(data[HISTORY_KEY]) ? data[HISTORY_KEY] : [];
  history.unshift(entry);
  await chrome.storage.session.set({ [HISTORY_KEY]: history.slice(0, HISTORY_MAX) });
}
