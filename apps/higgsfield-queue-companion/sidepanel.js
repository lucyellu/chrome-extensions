"use strict";

const BUILD_VERSION = "0.4.0";
const STORAGE = {
  queue: "hfqQueue",
  prefs: "hfqPrefs",
  runtime: "hfqRuntime",
  logs: "hfqLogs"
};

const VIDEO_URL = "https://higgsfield.ai/ai/video";
const DEFAULT_PREFS = {
  enabled: true,
  assumeDoneAfterMs: 720000
};

const state = {
  queue: [],
  prefs: DEFAULT_PREFS,
  runtime: {},
  logs: []
};

const hasChrome = typeof chrome !== "undefined" && chrome.storage && chrome.tabs;

const els = {
  pageStatus: document.querySelector("#pageStatus"),
  connectionHint: document.querySelector("#connectionHint"),
  refreshButton: document.querySelector("#refreshButton"),
  queuedCount: document.querySelector("#queuedCount"),
  runningCount: document.querySelector("#runningCount"),
  doneCount: document.querySelector("#doneCount"),
  diagnosticsButton: document.querySelector("#diagnosticsButton"),
  openVideoButton: document.querySelector("#openVideoButton"),
  captureButton: document.querySelector("#captureButton"),
  toggleQueueButton: document.querySelector("#toggleQueueButton"),
  queueList: document.querySelector("#queueList"),
  emptyState: document.querySelector("#emptyState"),
  historyList: document.querySelector("#historyList"),
  historySummary: document.querySelector("#historySummary"),
  historyEmptyState: document.querySelector("#historyEmptyState"),
  clearDoneButton: document.querySelector("#clearDoneButton"),
  resetErrorsButton: document.querySelector("#resetErrorsButton"),
  clearLogButton: document.querySelector("#clearLogButton"),
  logList: document.querySelector("#logList"),
  queueItemTemplate: document.querySelector("#queueItemTemplate")
};

init();

async function init() {
  bindEvents();
  await loadStore();
  render();

  if (hasChrome) {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== "local") return;
      if (changes[STORAGE.queue]) state.queue = normalizeQueue(changes[STORAGE.queue].newValue);
      if (changes[STORAGE.prefs]) state.prefs = mergePrefs(changes[STORAGE.prefs].newValue);
      if (changes[STORAGE.runtime]) state.runtime = changes[STORAGE.runtime].newValue || {};
      if (changes[STORAGE.logs]) state.logs = Array.isArray(changes[STORAGE.logs].newValue) ? changes[STORAGE.logs].newValue : [];
      render();
    });
  }

  await refreshPageStatus();
}

function bindEvents() {
  els.refreshButton.addEventListener("click", refreshPageStatus);
  els.diagnosticsButton.addEventListener("click", checkPageHook);
  els.openVideoButton.addEventListener("click", openVideoTab);
  els.captureButton.addEventListener("click", captureCurrentGui);
  els.toggleQueueButton.addEventListener("click", toggleQueue);
  els.clearDoneButton.addEventListener("click", clearDone);
  els.resetErrorsButton.addEventListener("click", resetErrors);
  els.clearLogButton.addEventListener("click", clearLogs);
}

async function loadStore() {
  if (!hasChrome) return;
  const data = await chrome.storage.local.get({
    [STORAGE.queue]: [],
    [STORAGE.prefs]: DEFAULT_PREFS,
    [STORAGE.runtime]: {},
    [STORAGE.logs]: []
  });
  state.queue = normalizeQueue(data[STORAGE.queue]);
  state.prefs = mergePrefs(data[STORAGE.prefs]);
  state.runtime = data[STORAGE.runtime] || {};
  state.logs = Array.isArray(data[STORAGE.logs]) ? data[STORAGE.logs] : [];
}

function mergePrefs(rawPrefs) {
  const raw = rawPrefs && typeof rawPrefs === "object" ? rawPrefs : {};
  return {
    ...DEFAULT_PREFS,
    ...raw
  };
}

function normalizeQueue(queue) {
  if (!Array.isArray(queue)) return [];
  return queue.map((item) => ({
    id: item.id || createId(),
    prompt: String(item.prompt || ""),
    image: item.image || null,
    settings: item.settings || {},
    status: item.status || "queued",
    attempts: Number(item.attempts) || 0,
    createdAt: Number(item.createdAt) || Date.now(),
    updatedAt: Number(item.updatedAt) || Date.now(),
    startedAt: Number(item.startedAt) || 0,
    completedAt: Number(item.completedAt) || 0,
    error: item.error || ""
  }));
}

async function saveQueue() {
  if (hasChrome) await chrome.storage.local.set({ [STORAGE.queue]: state.queue });
}

async function savePrefs() {
  if (hasChrome) await chrome.storage.local.set({ [STORAGE.prefs]: state.prefs });
}

function render() {
  renderSummary();
  renderControls();
  renderQueue();
  renderHistory();
  renderLogs();
}

function renderSummary() {
  els.queuedCount.textContent = String(state.queue.filter((item) => item.status === "queued").length);
  els.runningCount.textContent = String(state.queue.filter((item) => item.status === "running").length);
  els.doneCount.textContent = String(state.queue.filter((item) => item.status === "done").length);

  const label = state.runtime.statusLabel || state.runtime.status || (state.prefs.enabled ? "auto-run on" : "auto-run off");
  els.pageStatus.textContent = `Build ${BUILD_VERSION} · ${label}`;
}

function renderControls() {
  els.toggleQueueButton.textContent = state.prefs.enabled ? "Auto-run on" : "Auto-run off";
  els.toggleQueueButton.classList.toggle("is-active", Boolean(state.prefs.enabled));
}

function renderQueue() {
  els.queueList.textContent = "";
  const activeItems = state.queue.filter((item) => item.status !== "done");
  els.emptyState.classList.toggle("is-visible", activeItems.length === 0);

  activeItems.forEach((item, index) => {
    els.queueList.appendChild(createQueueCard(item, index, activeItems));
  });
}

function createQueueCard(item, index, activeItems) {
  const node = els.queueItemTemplate.content.firstElementChild.cloneNode(true);
  node.classList.toggle("is-running", item.status === "running");
  node.classList.toggle("is-error", item.status === "error");

  const status = node.querySelector(".status-pill");
  status.textContent = item.status;
  status.dataset.status = item.status;
  node.querySelector(".item-title").textContent = getItemTitle(item);
  node.querySelector(".item-prompt").textContent = item.prompt || "No prompt captured.";
  node.querySelector(".item-meta").textContent = buildSettingsLabel(item);
  node.querySelector(".item-estimate").textContent = buildEstimateLabel(item, activeItems);

  const error = node.querySelector(".item-error");
  error.textContent = item.error || "";
  error.classList.toggle("is-visible", Boolean(item.error));

  node.querySelector(".move-up").disabled = index === 0 || item.status === "running";
  node.querySelector(".move-down").disabled = index === activeItems.length - 1 || item.status === "running";
  node.querySelector(".move-up").addEventListener("click", () => moveItemById(item.id, -1));
  node.querySelector(".move-down").addEventListener("click", () => moveItemById(item.id, 1));
  node.querySelector(".duplicate-item").addEventListener("click", () => duplicateItem(item.id));
  node.querySelector(".reset-item").addEventListener("click", () => resetItem(item.id));
  node.querySelector(".remove-item").disabled = item.status === "running";
  node.querySelector(".remove-item").addEventListener("click", () => removeItem(item.id));

  return node;
}

function renderHistory() {
  els.historyList.textContent = "";
  const doneItems = state.queue
    .filter((item) => item.status === "done")
    .sort((a, b) => (b.completedAt || b.updatedAt || 0) - (a.completedAt || a.updatedAt || 0));

  els.historySummary.textContent = doneItems.length
    ? `${doneItems.length} completed`
    : "No completed generations";
  els.historyEmptyState.classList.toggle("is-visible", doneItems.length === 0);

  doneItems.slice(0, 30).forEach((item) => {
    const row = document.createElement("article");
    row.className = "history-row";
    const text = document.createElement("div");
    const title = document.createElement("strong");
    title.textContent = getItemTitle(item);
    const meta = document.createElement("span");
    meta.textContent = buildSettingsLabel(item);
    text.append(title, meta);
    const time = document.createElement("time");
    time.textContent = item.completedAt ? formatShortDate(item.completedAt) : "done";
    row.append(text, time);
    els.historyList.appendChild(row);
  });
}

function renderLogs() {
  els.logList.textContent = "";
  if (!state.logs.length) {
    const empty = document.createElement("div");
    empty.className = "log-entry";
    empty.innerHTML = "<time>--:--</time><span>No activity yet.</span>";
    els.logList.appendChild(empty);
    return;
  }

  state.logs.slice(0, 60).forEach((entry) => {
    const row = document.createElement("div");
    row.className = "log-entry";
    row.dataset.level = entry.level || "info";
    const time = document.createElement("time");
    time.textContent = formatTime(entry.time);
    const text = document.createElement("span");
    text.textContent = entry.message || "";
    row.append(time, text);
    els.logList.appendChild(row);
  });
}

async function refreshPageStatus() {
  const response = await sendToHiggsfield({ type: "HFQ_STATUS" }, { quiet: true });
  if (response?.snapshot) {
    state.runtime = { ...state.runtime, ...response.snapshot, statusLabel: response.snapshot.statusLabel };
    els.connectionHint.textContent = response.snapshot.generateButton
      ? "Connected to Higgsfield page hook. Queue capture should be available."
      : "Connected, but the Generate button was not found on the current page.";
    await addLocalLog("Page hook connected.", response.snapshot.generateButton ? "info" : "warn");
  } else {
    els.connectionHint.textContent = "Not connected to a Higgsfield page hook. Open or refresh Higgsfield, then check again.";
    await addLocalLog("No Higgsfield page hook responded.", "warn");
  }
  render();
}

async function checkPageHook() {
  await refreshPageStatus();
}

async function captureCurrentGui() {
  const response = await sendToHiggsfield({ type: "HFQ_CAPTURE_CURRENT" });
  if (!response?.ok) {
    await addLocalLog(`Capture failed: ${response?.error || "no page hook"}.`, "error");
    render();
    return;
  }

  await addLocalLog(response.result?.item ? "Captured current Higgsfield GUI into queue." : "Capture ran but no item was queued.", response.result?.item ? "info" : "warn");
  render();
}

async function toggleQueue() {
  state.prefs = mergePrefs({ ...state.prefs, enabled: !state.prefs.enabled });
  await savePrefs();
  await addLocalLog(state.prefs.enabled ? "Auto-run enabled." : "Auto-run disabled.", "info");
  if (state.prefs.enabled) await sendToHiggsfield({ type: "HFQ_PUMP_NOW" }, { quiet: true });
  render();
}

async function openVideoTab() {
  if (!hasChrome) return;
  const tabs = await queryHiggsfieldTabs();
  const existing = tabs.find((tab) => tab.url?.includes("/ai/video")) || tabs[0];
  if (existing?.id) {
    await chrome.tabs.update(existing.id, { active: true });
    if (existing.windowId) await chrome.windows.update(existing.windowId, { focused: true }).catch(() => {});
    return;
  }
  await chrome.tabs.create({ url: VIDEO_URL });
}

async function clearDone() {
  state.queue = state.queue.filter((item) => item.status !== "done");
  await saveQueue();
  render();
}

async function resetErrors() {
  state.queue = state.queue.map((item) => item.status === "error" ? { ...item, status: "queued", error: "", updatedAt: Date.now() } : item);
  await saveQueue();
  render();
}

async function clearLogs() {
  state.logs = [];
  if (hasChrome) await chrome.storage.local.set({ [STORAGE.logs]: [] });
  renderLogs();
}

async function moveItemById(id, direction) {
  const activeIds = state.queue.filter((item) => item.status !== "done").map((item) => item.id);
  const activeIndex = activeIds.indexOf(id);
  const targetActiveId = activeIds[activeIndex + direction];
  if (!targetActiveId) return;
  const index = state.queue.findIndex((item) => item.id === id);
  const target = state.queue.findIndex((item) => item.id === targetActiveId);
  if (index < 0 || target < 0) return;
  const next = [...state.queue];
  [next[index], next[target]] = [next[target], next[index]];
  state.queue = next;
  await saveQueue();
  render();
}

async function duplicateItem(id) {
  const item = state.queue.find((candidate) => candidate.id === id);
  if (!item) return;
  const copy = {
    ...structuredClone(item),
    id: createId(),
    status: "queued",
    attempts: 0,
    startedAt: 0,
    completedAt: 0,
    error: "",
    createdAt: Date.now(),
    updatedAt: Date.now()
  };
  const index = state.queue.findIndex((candidate) => candidate.id === id);
  state.queue.splice(index + 1, 0, copy);
  await saveQueue();
  render();
}

async function resetItem(id) {
  state.queue = state.queue.map((item) => item.id === id ? { ...item, status: "queued", attempts: 0, startedAt: 0, completedAt: 0, error: "", updatedAt: Date.now() } : item);
  await saveQueue();
  render();
}

async function removeItem(id) {
  state.queue = state.queue.filter((item) => item.id !== id);
  await saveQueue();
  render();
}

async function sendToHiggsfield(message, options = {}) {
  if (!hasChrome) return null;
  const tabs = await queryHiggsfieldTabs();
  const tab = tabs.find((candidate) => candidate.active && candidate.url?.includes("higgsfield.ai")) || tabs[0];
  if (!tab?.id) {
    if (!options.quiet) await addLocalLog("No Higgsfield tab found.", "warn");
    return null;
  }

  try {
    return await chrome.tabs.sendMessage(tab.id, message);
  } catch (error) {
    if (!options.quiet) await addLocalLog(`Could not reach Higgsfield page hook: ${error.message}`, "warn");
    return null;
  }
}

async function queryHiggsfieldTabs() {
  return chrome.tabs.query({
    url: ["https://higgsfield.ai/*", "https://*.higgsfield.ai/*"]
  });
}

async function addLocalLog(message, level = "info") {
  const entry = { id: createId(), time: Date.now(), level, message };
  state.logs = [entry, ...state.logs].slice(0, 120);
  if (hasChrome) await chrome.storage.local.set({ [STORAGE.logs]: state.logs });
}

function buildEstimateLabel(item, activeItems) {
  if (item.status === "running") return `Running. Estimated finish ${formatDuration(estimateRunningRemaining(item))}.`;
  if (item.status === "queued") {
    const estimate = estimateQueueTiming(item, activeItems);
    return `Starts ${formatDuration(estimate.startMs)}. Estimated finish ${formatDuration(estimate.finishMs)}.`;
  }
  if (item.status === "error") return item.error || "Needs retry.";
  return item.completedAt ? `Completed ${formatShortDate(item.completedAt)}.` : "Completed.";
}

function estimateQueueTiming(item, activeItems) {
  const perItemMs = Number(state.prefs.assumeDoneAfterMs) || DEFAULT_PREFS.assumeDoneAfterMs;
  const queued = activeItems.filter((candidate) => candidate.status === "queued");
  const queuedAhead = Math.max(0, queued.findIndex((candidate) => candidate.id === item.id));
  const running = activeItems.find((candidate) => candidate.status === "running");
  const pageBusy = state.runtime.busy || state.runtime.status === "busy" || state.runtime.status === "preloaded";
  let activeRemaining = 0;
  if (running) activeRemaining = estimateRunningRemaining(running);
  else if (pageBusy) {
    const startedAt = Number(state.runtime.lastStartAt) || Number(state.runtime.lastBusyAt) || Date.now();
    activeRemaining = Math.max(60000, perItemMs - (Date.now() - startedAt));
  }
  const startMs = activeRemaining + queuedAhead * perItemMs;
  return { startMs, finishMs: startMs + perItemMs };
}

function estimateRunningRemaining(item) {
  const perItemMs = Number(state.prefs.assumeDoneAfterMs) || DEFAULT_PREFS.assumeDoneAfterMs;
  const startedAt = Number(item.startedAt) || Number(state.runtime.lastStartAt) || Date.now();
  return Math.max(60000, perItemMs - (Date.now() - startedAt));
}

function buildSettingsLabel(item) {
  const settings = item.settings || {};
  const labels = [settings.model, settings.resolution, settings.duration, settings.size, item.image ? "image" : "text"].filter(Boolean);
  return labels.length ? labels.join(" · ") : "Captured from Higgsfield";
}

function getItemTitle(item) {
  const firstLine = String(item.prompt || "").split(/\r?\n/).map((line) => line.trim()).find(Boolean);
  return firstLine ? firstLine.slice(0, 90) : "Untitled generation";
}

function formatDuration(ms) {
  const minutes = Math.max(1, Math.ceil((Number(ms) || 0) / 60000));
  if (minutes < 60) return `in ~${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `in ~${hours}h ${rest}m` : `in ~${hours}h`;
}

function formatShortDate(time) {
  return new Date(time).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function formatTime(time) {
  if (!time) return "--:--";
  return new Date(time).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function createId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}