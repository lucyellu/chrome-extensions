"use strict";

const STORAGE_KEY = "sessionKeeper.sessions";
const SETTINGS_KEY = "sessionKeeper.settings";
const AUTOSAVE_ALARM = "session-keeper-autosave";
const DEFAULT_SETTINGS = {
  autosaveMinutes: 15,
  maxAutosaves: 80
};

chrome.runtime.onInstalled.addListener(async () => {
  await ensureSettings();
  await scheduleAutosave();
  await captureSession({ kind: "auto" });
  await updateBadge();
});

chrome.runtime.onStartup.addListener(async () => {
  await ensureSettings();
  await scheduleAutosave();
  setTimeout(() => captureSession({ kind: "auto" }).then(updateBadge), 2500);
});

chrome.action.onClicked.addListener(() => {
  chrome.tabs.create({ url: chrome.runtime.getURL("dashboard.html") });
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name !== AUTOSAVE_ALARM) return;
  captureSession({ kind: "auto" }).then(updateBadge);
});

chrome.tabs.onCreated.addListener(updateBadge);
chrome.tabs.onRemoved.addListener(updateBadge);
chrome.tabs.onUpdated.addListener((_tabId, changeInfo) => {
  if (changeInfo.status === "complete") updateBadge();
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  handleMessage(message)
    .then((response) => sendResponse({ ok: true, ...response }))
    .catch((error) => sendResponse({ ok: false, error: error.message }));
  return true;
});

async function handleMessage(message) {
  switch (message?.type) {
    case "GET_DASHBOARD_DATA": {
      const [sessions, currentWindows, settings] = await Promise.all([
        getSessions(),
        getCurrentWindows(),
        ensureSettings()
      ]);
      return { sessions, currentWindows, settings };
    }
    case "CAPTURE_SESSION": {
      const session = await captureSession({
        kind: message.kind === "manual" ? "manual" : "auto",
        name: message.name
      });
      return { session, sessions: await getSessions() };
    }
    case "DELETE_SESSION": {
      const sessions = (await getSessions()).filter((session) => session.id !== message.id);
      await setSessions(sessions);
      return { sessions };
    }
    case "RESTORE_SESSION": {
      const sessions = await getSessions();
      const session = sessions.find((item) => item.id === message.id);
      if (!session) throw new Error("Session not found.");
      await restoreSession(session, message.mode || "new-window");
      return {};
    }
    case "UPDATE_SETTINGS": {
      const settings = await saveSettings(message.settings || {});
      await scheduleAutosave();
      return { settings };
    }
    default:
      throw new Error("Unknown message.");
  }
}

async function captureSession({ kind = "auto", name = "" } = {}) {
  const windows = await getCurrentWindows();
  const now = new Date();
  const createdAt = now.toISOString();
  const session = {
    id: `${kind}-${now.getTime()}-${Math.random().toString(36).slice(2, 8)}`,
    kind,
    name: name?.trim() || formatTimestamp(now),
    createdAt,
    tabCount: windows.reduce((total, item) => total + item.tabs.length, 0),
    windowCount: windows.length,
    windows
  };

  const settings = await ensureSettings();
  const sessions = await getSessions();
  const next = [session, ...sessions];
  const autosaves = next.filter((item) => item.kind === "auto");
  const autosaveIdsToDrop = new Set(autosaves.slice(settings.maxAutosaves).map((item) => item.id));
  await setSessions(next.filter((item) => !autosaveIdsToDrop.has(item.id)));
  return session;
}

async function getCurrentWindows() {
  const windows = await chrome.windows.getAll({ populate: true, windowTypes: ["normal"] });
  return windows.map((window) => ({
    id: window.id,
    focused: Boolean(window.focused),
    left: window.left ?? null,
    top: window.top ?? null,
    width: window.width ?? null,
    height: window.height ?? null,
    state: window.state || "normal",
    tabs: (window.tabs || []).map((tab) => ({
      id: tab.id,
      index: tab.index,
      title: tab.title || tab.url || "Untitled",
      url: tab.url || "",
      favIconUrl: tab.favIconUrl || "",
      pinned: Boolean(tab.pinned),
      active: Boolean(tab.active),
      incognito: Boolean(tab.incognito)
    }))
  }));
}

async function restoreSession(session, mode) {
  const windows = session.windows || [];
  if (mode === "current-window") {
    const tabs = windows.flatMap((window) => window.tabs || []).filter((tab) => isRestorableUrl(tab.url));
    for (const tab of tabs) {
      await chrome.tabs.create({ url: tab.url, pinned: Boolean(tab.pinned), active: false });
    }
    return;
  }

  for (const window of windows) {
    const tabs = (window.tabs || []).filter((tab) => isRestorableUrl(tab.url));
    if (!tabs.length) continue;

    const created = await chrome.windows.create({
      url: tabs[0].url,
      focused: false,
      left: Number.isFinite(window.left) ? window.left : undefined,
      top: Number.isFinite(window.top) ? window.top : undefined,
      width: Number.isFinite(window.width) ? window.width : undefined,
      height: Number.isFinite(window.height) ? window.height : undefined
    });

    const firstTab = created.tabs?.[0];
    if (firstTab?.id && tabs[0].pinned) {
      await chrome.tabs.update(firstTab.id, { pinned: true });
    }

    for (const tab of tabs.slice(1)) {
      await chrome.tabs.create({
        windowId: created.id,
        url: tab.url,
        pinned: Boolean(tab.pinned),
        active: false
      });
    }
  }
}

function isRestorableUrl(url = "") {
  return /^(https?|file|chrome-extension):/i.test(url);
}

async function getSessions() {
  const result = await chrome.storage.local.get({ [STORAGE_KEY]: [] });
  return Array.isArray(result[STORAGE_KEY]) ? result[STORAGE_KEY] : [];
}

async function setSessions(sessions) {
  await chrome.storage.local.set({ [STORAGE_KEY]: sessions });
}

async function ensureSettings() {
  const result = await chrome.storage.local.get({ [SETTINGS_KEY]: DEFAULT_SETTINGS });
  const settings = {
    ...DEFAULT_SETTINGS,
    ...(result[SETTINGS_KEY] || {})
  };
  await chrome.storage.local.set({ [SETTINGS_KEY]: settings });
  return settings;
}

async function saveSettings(patch) {
  const current = await ensureSettings();
  const settings = {
    ...current,
    autosaveMinutes: clampNumber(patch.autosaveMinutes, 5, 240, current.autosaveMinutes),
    maxAutosaves: clampNumber(patch.maxAutosaves, 10, 500, current.maxAutosaves)
  };
  await chrome.storage.local.set({ [SETTINGS_KEY]: settings });
  return settings;
}

async function scheduleAutosave() {
  const settings = await ensureSettings();
  await chrome.alarms.clear(AUTOSAVE_ALARM);
  await chrome.alarms.create(AUTOSAVE_ALARM, {
    periodInMinutes: settings.autosaveMinutes,
    delayInMinutes: settings.autosaveMinutes
  });
}

async function updateBadge() {
  const windows = await getCurrentWindows();
  const tabCount = windows.reduce((total, item) => total + item.tabs.length, 0);
  await chrome.action.setBadgeText({ text: tabCount ? String(tabCount) : "" });
  await chrome.action.setBadgeBackgroundColor({ color: "#5f6875" });
  if (chrome.action.setBadgeTextColor) {
    await chrome.action.setBadgeTextColor({ color: "#d8dee8" });
  }
}

function formatTimestamp(date) {
  return new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

function clampNumber(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, Math.round(number)));
}
