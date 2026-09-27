"use strict";

const STORAGE = {
  queue: "hfqQueue",
  prefs: "hfqPrefs",
  runtime: "hfqRuntime",
  logs: "hfqLogs"
};

const BUILD_VERSION = "0.4.0";
const IS_TOP_FRAME = window.top === window;

const DEFAULT_SETTINGS = {
  model: "Seedance Unlimited",
  resolution: "720",
  duration: "8s",
  size: "Auto size"
};

const DEFAULT_PREFS = {
  enabled: false,
  preloadWhileBusy: true,
  pollMs: 5000,
  minRunningMs: 35000,
  idleCompleteMs: 8000,
  assumeDoneAfterMs: 720000,
  defaults: DEFAULT_SETTINGS,
  selectors: {
    prompt: "",
    generate: "",
    fileInput: ""
  }
};

let pumpBusy = false;
let scheduledPump = 0;
let modalQueueTimer = 0;

document.addEventListener(
  "click",
  (event) => {
    handleGenerateClick(event).catch((error) => {
      console.warn("Higgsfield queue click handler failed", error);
    });
  },
  true
);

const modalObserver = new MutationObserver(() => {
  if (!findUpgradeModal()) return;
  clearTimeout(modalQueueTimer);
  modalQueueTimer = setTimeout(() => {
    handleUpgradeModalDetected().catch((error) => {
      console.warn("Higgsfield queue modal handler failed", error);
    });
  }, 250);
});

modalObserver.observe(document.documentElement, { childList: true, subtree: true });
installCompanionBadge();

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || typeof message.type !== "string") return false;

  if (message.type === "HFQ_STATUS") {
    sendResponse({ ok: true, snapshot: getSnapshot() });
    return false;
  }

  if (message.type === "HFQ_DIAGNOSTICS") {
    sendResponse({ ok: true, snapshot: getSnapshot({ diagnostics: true }) });
    return false;
  }

  if (message.type === "HFQ_PUMP_NOW") {
    pumpQueue({ source: "sidepanel" })
      .then((result) => sendResponse({ ok: true, result, snapshot: getSnapshot() }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message.type === "HFQ_RUN_ONCE") {
    pumpQueue({ manual: true, source: "sidepanel" })
      .then((result) => sendResponse({ ok: true, result, snapshot: getSnapshot() }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message.type === "HFQ_CAPTURE_CURRENT") {
    queueCurrentPageGeneration("sidepanel-capture")
      .then((result) => {
        if (result.ok) showCompanionToast(`Captured current GUI. Starts ${formatDuration(result.estimate.startMs)}; finishes ${formatDuration(result.estimate.finishMs)}.`, "ok");
        sendResponse({ ok: result.ok, result, snapshot: getSnapshot(), error: result.error || "" });
      })
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message.type === "HFQ_SCAN_IMAGES") {
    try {
      sendResponse({ ok: true, images: scanPageImages() });
    } catch (error) {
      sendResponse({ ok: false, error: error.message });
    }
    return false;
  }

  return false;
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  if (changes[STORAGE.queue] || changes[STORAGE.prefs]) {
    schedulePump(500);
  }
});

setInterval(() => {
  pumpQueue({ source: "interval" }).catch((error) => {
    console.warn("Higgsfield queue pump failed", error);
  });
}, DEFAULT_PREFS.pollMs);

schedulePump(1200);
writeRuntime({ status: "ready", statusLabel: "Higgsfield ready", url: location.href }).catch(() => {});
addLog("Higgsfield companion loaded.", "info").catch(() => {});

function schedulePump(delay) {
  clearTimeout(scheduledPump);
  scheduledPump = setTimeout(() => {
    pumpQueue({ source: "scheduled" }).catch((error) => {
      console.warn("Higgsfield queue pump failed", error);
    });
  }, delay);
}

async function pumpQueue(options = {}) {
  if (pumpBusy) return { skipped: "busy" };
  pumpBusy = true;

  try {
    const store = await readStore();
    const snapshot = getSnapshot();
    await writeRuntime({
      ...snapshot,
      status: snapshot.busy ? "busy" : "idle",
      statusLabel: snapshot.statusLabel
    });

    if (!store.prefs.enabled && !options.manual) {
      return { skipped: "paused" };
    }

    const running = store.queue.find((item) => item.status === "running");
    const next = store.queue.find((item) => item.status === "queued");

    if (snapshot.upgradeModal) {
      const queued = await queueCurrentPageGeneration("upgrade-modal");
      closeUpgradeModal();
      if (queued.ok) {
        showCompanionToast(`Queued instead of upgrade popup. Starts ${formatDuration(queued.estimate.startMs)}; finishes ${formatDuration(queued.estimate.finishMs)}.`, "ok");
        return { waiting: "queued-from-dialog" };
      }
      await addLog("Closed an upgrade/concurrency dialog.", "warn");
      await writeRuntime({ status: "blocked", statusLabel: "Dialog closed" });
      return { waiting: "upgrade-modal" };
    }

    if (snapshot.busy) {
      if (running && !running.sawBusy) {
        await patchItem(running.id, { sawBusy: true, error: "" });
      }

      if (store.prefs.preloadWhileBusy !== false && next && !store.runtime.preloadedItemId && !isUserEditingForm()) {
        const preload = await fillVideoForm(next, store.prefs, { preload: true });
        if (preload.ok) {
          await writeRuntime({
            preloadedItemId: next.id,
            status: "preloaded",
            statusLabel: "Next prompt preloaded"
          });
          await addLog("Preloaded next queued generation.", "info");
        } else if (preload.error) {
          await writeRuntime({ statusLabel: "Busy; preload skipped" });
        }
      }

      return { waiting: "page-busy" };
    }

    if (running) {
      const now = Date.now();
      const elapsed = now - (running.startedAt || now);
      const sawBusy = running.sawBusy || store.runtime.lastBusyAt > running.startedAt;
      const idleLongEnough = !store.runtime.lastBusyAt || now - store.runtime.lastBusyAt >= store.prefs.idleCompleteMs;
      const assumedDone = elapsed >= store.prefs.assumeDoneAfterMs;

      if ((sawBusy && elapsed >= store.prefs.minRunningMs && idleLongEnough) || assumedDone) {
        await patchItem(running.id, {
          status: "done",
          completedAt: now,
          updatedAt: now,
          error: ""
        });
        await writeRuntime({
          currentItemId: "",
          preloadedItemId: "",
          status: "complete",
          statusLabel: "Generation complete"
        });
        await addLog(`Marked generation done: ${titleFor(running)}.`, "info");
      } else {
        await writeRuntime({ status: "watching", statusLabel: "Watching active generation" });
        return { waiting: "running-item" };
      }
    }

    const refreshed = await readStore();
    const refreshedNext = refreshed.queue.find((item) => item.status === "queued");
    if (!refreshedNext) {
      await writeRuntime({ status: "idle", statusLabel: "Queue empty", preloadedItemId: "" });
      return { idle: true };
    }

    const fill = await fillVideoForm(refreshedNext, refreshed.prefs, { preload: false });
    if (!fill.ok) {
      await patchItem(refreshedNext.id, {
        status: "error",
        error: fill.error || "Could not fill Higgsfield form.",
        updatedAt: Date.now()
      });
      await addLog(`Could not fill form: ${fill.error || "unknown error"}`, "error");
      return { error: fill.error };
    }

    const clicked = await clickGenerate(refreshed.prefs);
    if (!clicked.ok) {
      if (clicked.blockedByUpgrade) {
        closeUpgradeModal();
        await writeRuntime({ status: "blocked", statusLabel: "Waiting for generation slot" });
        await addLog("Generate was blocked by the concurrent-generation dialog; waiting.", "warn");
        return { waiting: "slot" };
      }

      await patchItem(refreshedNext.id, {
        status: "error",
        error: clicked.error || "Generate button was not available.",
        updatedAt: Date.now()
      });
      await addLog(`Could not start generation: ${clicked.error || "unknown error"}`, "error");
      return { error: clicked.error };
    }

    const now = Date.now();
    await patchItem(refreshedNext.id, {
      status: "running",
      attempts: Number(refreshedNext.attempts || 0) + 1,
      startedAt: now,
      completedAt: 0,
      sawBusy: false,
      error: "",
      updatedAt: now
    });
    await writeRuntime({
      currentItemId: refreshedNext.id,
      preloadedItemId: "",
      lastStartAt: now,
      status: "running",
      statusLabel: "Generation started"
    });
    await addLog(`Started generation: ${titleFor(refreshedNext)}.`, "info");
    schedulePump(2500);
    return { started: refreshedNext.id };
  } finally {
    pumpBusy = false;
  }
}

async function readStore() {
  const data = await chrome.storage.local.get({
    [STORAGE.queue]: [],
    [STORAGE.prefs]: DEFAULT_PREFS,
    [STORAGE.runtime]: {}
  });
  return {
    queue: normalizeQueue(data[STORAGE.queue]),
    prefs: mergePrefs(data[STORAGE.prefs]),
    runtime: data[STORAGE.runtime] || {}
  };
}

function mergePrefs(rawPrefs) {
  const raw = rawPrefs && typeof rawPrefs === "object" ? rawPrefs : {};
  return {
    ...DEFAULT_PREFS,
    ...raw,
    defaults: {
      ...DEFAULT_SETTINGS,
      ...(raw.defaults || {})
    },
    selectors: {
      ...DEFAULT_PREFS.selectors,
      ...(raw.selectors || {})
    }
  };
}

function normalizeQueue(queue) {
  if (!Array.isArray(queue)) return [];
  return queue.map((item) => ({
    ...item,
    settings: {
      ...DEFAULT_SETTINGS,
      ...(item.settings || {})
    },
    status: item.status || "queued"
  }));
}

async function patchItem(id, patch) {
  const { queue } = await readStore();
  const nextQueue = queue.map((item) => (item.id === id ? { ...item, ...patch, updatedAt: Date.now() } : item));
  await chrome.storage.local.set({ [STORAGE.queue]: nextQueue });
}

async function writeRuntime(patch) {
  const data = await chrome.storage.local.get({ [STORAGE.runtime]: {} });
  const runtime = {
    ...(data[STORAGE.runtime] || {}),
    ...patch,
    updatedAt: Date.now(),
    url: location.href,
    title: document.title
  };

  if (patch.busy) runtime.lastBusyAt = Date.now();
  await chrome.storage.local.set({ [STORAGE.runtime]: runtime });
}

async function addLog(message, level = "info") {
  const data = await chrome.storage.local.get({ [STORAGE.logs]: [] });
  const logs = Array.isArray(data[STORAGE.logs]) ? data[STORAGE.logs] : [];
  logs.unshift({
    id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    time: Date.now(),
    level,
    message
  });
  await chrome.storage.local.set({ [STORAGE.logs]: logs.slice(0, 120) });
}

function installCompanionBadge() {
  if (!IS_TOP_FRAME) return;
  const mount = () => {
    if (!document.documentElement || document.querySelector("#hfq-page-badge")) return;
    const badge = document.createElement("div");
    badge.id = "hfq-page-badge";
    badge.textContent = `HFQ ${BUILD_VERSION} loaded`;
    badge.title = "Higgsfield Queue Companion is injected on this page.";
    badge.style.cssText = [
      "position:fixed",
      "right:12px",
      "bottom:12px",
      "z-index:2147483646",
      "padding:6px 8px",
      "border-radius:999px",
      "font:11px/1.2 system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif",
      "font-weight:700",
      "color:#061510",
      "background:#8ee6c9",
      "box-shadow:0 10px 30px rgba(0,0,0,.24)",
      "pointer-events:none",
      "opacity:.88"
    ].join(";");
    document.documentElement.appendChild(badge);
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", mount, { once: true });
  } else {
    mount();
  }
}

function updateCompanionBadge(message, tone = "ok") {
  if (!IS_TOP_FRAME) return;
  const badge = document.querySelector("#hfq-page-badge");
  if (!badge) return;
  badge.textContent = message;
  badge.style.background = tone === "error" ? "#ff796b" : tone === "warn" ? "#f6b16d" : "#8ee6c9";
}
async function handleGenerateClick(event) {
  const button = getGenerateButtonFromTarget(event.target);
  if (!button) return;

  const snapshot = getSnapshot();
  if (!snapshot.busy && !snapshot.upgradeModal) return;

  event.preventDefault();
  event.stopPropagation();
  event.stopImmediatePropagation();

  updateCompanionBadge("HFQ queueing...", "warn");
  const result = await queueCurrentPageGeneration("busy-click");
  closeUpgradeModal();

  if (result.ok) {
    updateCompanionBadge(`HFQ queued ${formatDuration(result.estimate.startMs)}`, "ok");
    showCompanionToast(`Queued. Starts ${formatDuration(result.estimate.startMs)}; finishes ${formatDuration(result.estimate.finishMs)}.`, "ok");
  } else {
    updateCompanionBadge("HFQ capture failed", "error");
    showCompanionToast(result.error || "Could not queue this generation.", "error");
  }
}

async function handleUpgradeModalDetected() {
  const modal = findUpgradeModal();
  if (!modal) return;

  const result = await queueCurrentPageGeneration("upgrade-modal");
  closeUpgradeModal();

  if (result.ok) {
    showCompanionToast(`Queued instead of upgrade popup. Starts ${formatDuration(result.estimate.startMs)}; finishes ${formatDuration(result.estimate.finishMs)}.`, "ok");
  } else {
    updateCompanionBadge("HFQ capture failed", "error");
    showCompanionToast(result.error || "Could not queue this generation.", "error");
  }
}

function getGenerateButtonFromTarget(target) {
  if (!(target instanceof Element)) return null;
  const button = target.closest("button, [role='button'], input[type='button'], input[type='submit'], [class*='button'], [data-testid*='button']");
  if (!button || !isVisible(button)) return null;

  const detected = findGenerateButton();
  if (detected && (button === detected || button.contains(detected) || detected.contains(button))) return button;

  const text = normalizeText(textOf(button));
  if (!/generate|create video|start/.test(text)) return null;
  if (/upgrade|subscribe|pricing|sign in|login/.test(text)) return null;
  return button;
}

async function queueCurrentPageGeneration(reason) {
  const store = await readStore();
  const capture = captureCurrentGuiItem(store.prefs);

  if (!capture.prompt) {
    await addLog("Could not queue from page: prompt is empty or was not found.", "warn");
    return { ok: false, error: "Prompt was empty or not found." };
  }

  const duplicate = findRecentDuplicate(store.queue, capture);
  if (duplicate) {
    const estimate = estimateQueueTiming(store.queue, duplicate.id, store.prefs, store.runtime);
    await addLog("Skipped duplicate page capture; it is already queued.", "warn");
    return { ok: true, item: duplicate, estimate, duplicate: true };
  }

  const now = Date.now();
  const item = {
    id: createId(),
    prompt: capture.prompt,
    image: capture.image,
    settings: capture.settings,
    status: "queued",
    attempts: 0,
    createdAt: now,
    updatedAt: now,
    startedAt: 0,
    completedAt: 0,
    sawBusy: false,
    error: "",
    source: reason || "page"
  };

  const nextQueue = [...store.queue, item];
  const nextPrefs = mergePrefs({ ...store.prefs, enabled: true });
  await chrome.storage.local.set({
    [STORAGE.queue]: nextQueue,
    [STORAGE.prefs]: nextPrefs
  });

  const estimate = estimateQueueTiming(nextQueue, item.id, nextPrefs, store.runtime);
  await writeRuntime({
    status: "queued",
    statusLabel: `Queued: starts ${formatDuration(estimate.startMs)}`,
    lastQueuedAt: now
  });
  await addLog(`Queued from Higgsfield page: ${titleFor(item)}.`, "info");
  schedulePump(1000);

  return { ok: true, item, estimate };
}

function captureCurrentGuiItem(prefs) {
  const promptField = findPromptField(prefs.selectors.prompt);
  const prompt = getEditableValue(promptField).trim();
  const settings = {
    model: detectVisibleSetting(["Seedance Unlimited", "Seedance Pro", "Seedance"], DEFAULT_SETTINGS.model),
    resolution: detectVisibleSetting(["1080", "720", "480"], DEFAULT_SETTINGS.resolution),
    duration: detectVisibleSetting(["10s", "8s", "5s", "10 seconds", "8 seconds", "5 seconds"], DEFAULT_SETTINGS.duration),
    size: detectVisibleSetting(["Auto size", "16:9", "9:16", "1:1", "4:3", "3:4", "Auto"], DEFAULT_SETTINGS.size)
  };

  if (settings.duration.endsWith(" seconds")) settings.duration = settings.duration.replace(" seconds", "s");
  if (settings.size === "Auto") settings.size = "Auto size";

  return {
    prompt,
    settings,
    image: findLikelyReferenceImage(promptField)
  };
}

function getEditableValue(element) {
  if (!element) return "";
  if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) return element.value || "";
  if (element.isContentEditable || element.getAttribute("role") === "textbox") return element.textContent || "";
  return textOf(element);
}

function detectVisibleSetting(options, fallback) {
  const visibleText = normalizeText(document.body?.innerText || "");
  const match = options.find((option) => visibleText.includes(normalizeText(option)));
  return match || fallback;
}

function findLikelyReferenceImage(promptField) {
  const images = scanPageImages();
  if (!images.length) return null;

  const promptRect = promptField?.getBoundingClientRect?.();
  const scored = images.map((image) => {
    let score = image.area || 0;
    const text = normalizeText(image.context || "");
    if (/upload|image|reference|first frame|start frame|source/.test(text)) score += 120000;
    if (promptRect && image.rect) {
      const dy = Math.abs(image.rect.top - promptRect.top);
      const dx = Math.abs(image.rect.left - promptRect.left);
      score += Math.max(0, 90000 - dy * 120 - dx * 10);
    }
    if (/logo|avatar|profile|icon/.test(normalizeText(`${image.name} ${image.alt}`))) score -= 140000;
    return { image, score };
  });

  scored.sort((a, b) => b.score - a.score);
  const best = scored[0]?.image;
  if (!best || best.area < 1600) return null;

  return {
    source: "higgsfield-page",
    name: best.name || "higgsfield-page-image.jpg",
    type: best.type || "image/jpeg",
    size: 0,
    url: best.url,
    thumbnailUrl: best.thumbnailUrl || best.url,
    alt: best.alt || ""
  };
}

function findRecentDuplicate(queue, capture) {
  const captureImage = capture.image?.url || capture.image?.dataUrl || "";
  const now = Date.now();
  return [...queue].reverse().find((item) => {
    if (!item || item.status === "done" || item.status === "error") return false;
    const itemImage = item.image?.url || item.image?.dataUrl || "";
    const samePrompt = normalizeText(item.prompt) === normalizeText(capture.prompt);
    const sameImage = itemImage === captureImage;
    const recent = now - (Number(item.createdAt) || 0) < 30000;
    return samePrompt && sameImage && recent;
  }) || null;
}

function estimateQueueTiming(queue, itemId, prefs, runtime = {}) {
  const perItemMs = Number(prefs.assumeDoneAfterMs) || DEFAULT_PREFS.assumeDoneAfterMs;
  const itemIndex = queue.findIndex((item) => item.id === itemId);
  const queuedAhead = Math.max(0, queue.slice(0, itemIndex).filter((item) => item.status === "queued").length);
  const running = queue.find((item) => item.status === "running");
  const pageBusy = getSnapshot().busy;
  let activeRemaining = 0;

  if (running?.startedAt) {
    activeRemaining = Math.max(60000, perItemMs - (Date.now() - running.startedAt));
  } else if (pageBusy) {
    const startedAt = Number(runtime.lastStartAt) || Number(runtime.lastBusyAt) || Date.now();
    activeRemaining = Math.max(60000, perItemMs - (Date.now() - startedAt));
  }

  const startMs = activeRemaining + queuedAhead * perItemMs;
  return {
    startMs,
    finishMs: startMs + perItemMs
  };
}

function showCompanionToast(message, tone = "ok") {
  let toast = document.querySelector("#hfq-page-toast");
  if (!toast) {
    toast = document.createElement("div");
    toast.id = "hfq-page-toast";
    toast.style.cssText = [
      "position:fixed",
      "right:18px",
      "bottom:18px",
      "z-index:2147483647",
      "max-width:min(360px, calc(100vw - 36px))",
      "padding:12px 14px",
      "border-radius:10px",
      "font:13px/1.35 system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif",
      "box-shadow:0 18px 48px rgba(0,0,0,.32)",
      "transition:opacity .16s ease, transform .16s ease",
      "pointer-events:none"
    ].join(";");
    document.documentElement.appendChild(toast);
  }

  toast.textContent = message;
  toast.style.color = tone === "error" ? "#fff" : "#061510";
  toast.style.background = tone === "error" ? "#d94d42" : "#8ee6c9";
  toast.style.opacity = "1";
  toast.style.transform = "translateY(0)";

  clearTimeout(showCompanionToast.timer);
  showCompanionToast.timer = setTimeout(() => {
    toast.style.opacity = "0";
    toast.style.transform = "translateY(8px)";
  }, 5200);
}
function getSnapshot(options = {}) {
  const generateButton = findGenerateButton();
  const promptField = findPromptField();
  const fileInput = findFileInput();
  const upgradeModal = findUpgradeModal();
  const busySignals = [];

  if (upgradeModal) busySignals.push("upgrade dialog");
  if (generateButton && isDisabled(generateButton)) busySignals.push("generate disabled");
  if (generateButton && /generating|creating|rendering|processing|waiting/i.test(textOf(generateButton))) {
    busySignals.push("generate busy text");
  }

  const progress = findProgressSignal();
  if (progress) busySignals.push(progress);

  const busy = busySignals.length > 0 && !upgradeModal;
  const statusLabel = upgradeModal
    ? "Dialog open"
    : busy
      ? "Generation in progress"
      : generateButton
        ? "Ready to generate"
        : "Generate button missing";

  return {
    busy,
    busySignals,
    statusLabel,
    promptField: Boolean(promptField),
    generateButton: Boolean(generateButton),
    generateText: generateButton ? textOf(generateButton).slice(0, 80) : "",
    generateDisabled: generateButton ? isDisabled(generateButton) : false,
    fileInput: Boolean(fileInput),
    upgradeModal: Boolean(upgradeModal),
    url: location.href,
    diagnostics: Boolean(options.diagnostics)
  };
}

async function fillVideoForm(item, prefs, options = {}) {
  const promptField = findPromptField(prefs.selectors.prompt);
  if (!promptField) {
    return { ok: false, error: "Prompt field not found." };
  }

  promptField.scrollIntoView({ block: "center", behavior: "smooth" });
  await delay(120);
  setEditableValue(promptField, item.prompt);
  await delay(120);

  const warnings = [];
  const settings = item.settings || DEFAULT_SETTINGS;

  const settingResults = [];
  settingResults.push(await applySetting("model", settings.model, ["model"], prefs));
  settingResults.push(await applySetting("resolution", settings.resolution, ["resolution", "quality"], prefs));
  settingResults.push(await applySetting("duration", settings.duration, ["duration", "length"], prefs));
  settingResults.push(await applySetting("size", settings.size, ["size", "aspect", "ratio"], prefs));
  settingResults.filter((result) => !result.ok && result.warning).forEach((result) => warnings.push(result.warning));

  if (item.image?.dataUrl || item.image?.url) {
    const uploaded = await uploadImage(item.image, prefs.selectors.fileInput);
    if (!uploaded.ok) warnings.push(uploaded.error || "Image upload control not found.");
  }

  if (warnings.length && !options.preload) {
    await addLog(`Filled prompt with warnings: ${warnings.join("; ")}`, "warn");
  }

  return { ok: true, warnings };
}

function isUserEditingForm() {
  const active = document.activeElement;
  if (!active || active === document.body || active === document.documentElement) return false;
  return Boolean(active.closest?.("textarea, input, [contenteditable='true'], [role='textbox']"));
}
function findPromptField(selector = "") {
  const explicit = queryVisible(selector);
  if (explicit) return explicit;

  const fields = visibleElements("textarea, input[type='text'], input:not([type]), [contenteditable='true'], [role='textbox']");
  const scored = fields.map((element) => {
    const descriptor = [
      element.getAttribute("placeholder"),
      element.getAttribute("aria-label"),
      element.getAttribute("name"),
      element.getAttribute("data-testid"),
      textOf(element.closest("label") || element.parentElement)
    ].join(" ").toLowerCase();
    const rect = element.getBoundingClientRect();
    let score = rect.width * rect.height;
    if (/prompt|describe|description|idea|video|motion/.test(descriptor)) score += 100000;
    if (element.tagName === "TEXTAREA") score += 30000;
    if (element.isContentEditable) score += 20000;
    return { element, score };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored[0]?.element || null;
}

function findGenerateButton(selector = "") {
  const explicit = queryVisible(selector);
  if (explicit) return explicit;

  const candidates = visibleElements("button, [role='button'], input[type='button'], input[type='submit'], [class*='button'], [data-testid*='button']");
  const scored = candidates
    .map((element) => {
      const text = textOf(element).toLowerCase();
      if (!text || /upgrade|subscribe|pricing|sign in|login/.test(text)) return null;
      let score = 0;
      if (/^generate\b/.test(text)) score += 100;
      if (/\bgenerate\b/.test(text)) score += 80;
      if (/create video|start|submit/.test(text)) score += 35;
      if (/video/.test(text)) score += 10;
      if (!score) return null;
      return { element, score };
    })
    .filter(Boolean)
    .sort((a, b) => b.score - a.score);

  return scored[0]?.element || null;
}

function findFileInput(selector = "") {
  const explicit = queryVisible(selector, { allowHiddenFile: true });
  if (explicit && explicit.matches("input[type='file']")) return explicit;

  const inputs = Array.from(document.querySelectorAll("input[type='file']"));
  const imageInputs = inputs.filter((input) => !input.disabled && /image|\*/i.test(input.accept || "image"));
  return imageInputs[0] || inputs.find((input) => !input.disabled) || null;
}

async function uploadImage(image, selector = "") {
  let input = findFileInput(selector);
  if (!input) {
    const trigger = findTextControl(["image", "upload", "reference", "first frame", "start frame"]);
    if (trigger) {
      clickElement(trigger);
      await delay(700);
      input = findFileInput(selector);
    }
  }

  if (!input) {
    return { ok: false, error: "Image file input not found." };
  }

  try {
    const file = await imageToFile(image);
    const transfer = new DataTransfer();
    transfer.items.add(file);
    input.files = transfer.files;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

async function applySetting(kind, value, labelAliases, prefs) {
  if (!value) return { ok: true };
  const aliases = settingAliases(kind, value);

  if (selectNativeOption(aliases)) return { ok: true };

  const visibleOption = findTextControl(aliases, { exact: true });
  if (visibleOption) {
    clickElement(visibleOption);
    await delay(160);
    return { ok: true };
  }

  const control = findControlNearLabel(labelAliases);
  if (control) {
    clickElement(control);
    await delay(260);
    const option = findTextControl(aliases, { exact: true }) || findTextControl(aliases);
    if (option) {
      clickElement(option);
      await delay(160);
      return { ok: true };
    }
  }

  return { ok: false, warning: `${kind} option '${value}' was not found.` };
}

function settingAliases(kind, value) {
  const normalized = normalizeText(value);
  const aliases = new Set([normalized]);

  if (kind === "duration") {
    aliases.add(normalized.replace(/\s+/g, ""));
    aliases.add(normalized.replace("s", " sec"));
    aliases.add(normalized.replace("s", " seconds"));
  }

  if (kind === "resolution") {
    aliases.add(`${normalized}p`);
    aliases.add(`${normalized} px`);
  }

  if (kind === "size" && normalized === "auto size") {
    aliases.add("auto");
    aliases.add("automatic");
  }

  if (kind === "model" && normalized.includes("seedance")) {
    aliases.add("seedance unlimited");
    aliases.add("seedance");
  }

  return Array.from(aliases);
}

function selectNativeOption(aliases) {
  const aliasSet = new Set(aliases.map(normalizeText));
  const selects = visibleElements("select");

  for (const select of selects) {
    const option = Array.from(select.options).find((candidate) => aliasSet.has(normalizeText(candidate.textContent || candidate.value)));
    if (!option || option.selected) continue;
    select.value = option.value;
    select.dispatchEvent(new Event("input", { bubbles: true }));
    select.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  }

  return false;
}

async function clickGenerate(prefs) {
  const button = findGenerateButton(prefs.selectors.generate);
  if (!button) return { ok: false, error: "Generate button not found." };
  if (isDisabled(button)) return { ok: false, error: "Generate button is disabled." };

  button.scrollIntoView({ block: "center", behavior: "smooth" });
  await delay(120);
  clickElement(button);
  await delay(1200);

  if (findUpgradeModal()) {
    return { ok: false, blockedByUpgrade: true };
  }

  return { ok: true };
}

function findProgressSignal() {
  const direct = visibleElements("[aria-busy='true'], [role='progressbar'], [data-loading='true'], [class*='spinner'], [class*='loading'], [class*='progress']");
  if (direct.length) return "progress indicator";

  const status = visibleElements("[role='status'], [aria-live], span, p, div")
    .find((element) => {
      const text = normalizeText(textOf(element));
      if (text.length < 6 || text.length > 180) return false;
      return /\b(generating|creating video|rendering|processing|in progress|this may take|queued)\b/.test(text);
    });

  return status ? "status text" : "";
}

function findUpgradeModal() {
  const modalWords = /upgrade|subscribe|subscription|plan|concurrent|one\s+(?:video|generation)|only\s+one|wait\s+for|currently\s+generating|already\s+generating/i;
  const candidates = visibleElements("dialog, [role='dialog'], [aria-modal='true'], [data-state='open'], section, div");

  for (const element of candidates) {
    const text = textOf(element);
    if (text.length < 8 || text.length > 2400) continue;
    if (!modalWords.test(text)) continue;
    if (element.matches("dialog, [role='dialog'], [aria-modal='true']")) return element;
    if (isOverlayLike(element)) return element;

    const overlayParent = closestOverlay(element);
    if (overlayParent) return overlayParent;
  }

  return null;
}

function closestOverlay(element) {
  let current = element;
  for (let depth = 0; depth < 5 && current; depth += 1) {
    if (isOverlayLike(current)) return current;
    current = current.parentElement;
  }
  return null;
}

function isOverlayLike(element) {
  if (!element || !(element instanceof Element)) return false;
  const rect = element.getBoundingClientRect();
  const styles = getComputedStyle(element);
  const zIndex = Number.parseInt(styles.zIndex || "0", 10);
  const fixedOrSticky = styles.position === "fixed" || styles.position === "sticky" || styles.position === "absolute";
  const largeEnough = rect.width >= Math.min(window.innerWidth * 0.25, 320) && rect.height >= 80;
  const centered = rect.left < window.innerWidth * 0.8 && rect.right > window.innerWidth * 0.2 && rect.top < window.innerHeight * 0.85;
  return fixedOrSticky && largeEnough && centered && (Number.isNaN(zIndex) || zIndex >= 10 || styles.position === "fixed");
}
function closeUpgradeModal() {
  const modal = findUpgradeModal();
  if (!modal) return false;

  const close = Array.from(modal.querySelectorAll("button, [role='button']")).find((button) => {
    const text = normalizeText(textOf(button));
    const aria = normalizeText(button.getAttribute("aria-label") || "");
    return /close|dismiss|cancel|later|not now|x/.test(text) || /close|dismiss/.test(aria);
  });

  if (close) {
    clickElement(close);
    return true;
  }

  document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  return true;
}

function findTextControl(aliases, options = {}) {
  const aliasSet = new Set(aliases.map(normalizeText));
  const elements = visibleElements("button, [role='button'], [role='option'], [role='menuitem'], label, span, div");
  const matches = elements
    .map((element) => {
      const text = normalizeText(textOf(element));
      if (!text || text.length > 80) return null;
      const exact = aliasSet.has(text);
      const partial = !options.exact && Array.from(aliasSet).some((alias) => text.includes(alias) || alias.includes(text));
      if (!exact && !partial) return null;
      const clickable = closestClickable(element) || element;
      return { element: clickable, score: exact ? 2 : 1 };
    })
    .filter(Boolean)
    .sort((a, b) => b.score - a.score);

  return matches[0]?.element || null;
}

function findControlNearLabel(labelAliases) {
  const aliasSet = labelAliases.map(normalizeText);
  const labels = visibleElements("label, span, div, p").filter((element) => {
    const text = normalizeText(textOf(element));
    return text.length <= 80 && aliasSet.some((alias) => text.includes(alias));
  });

  for (const label of labels) {
    let scope = label;
    for (let depth = 0; depth < 4 && scope; depth += 1) {
      const control = Array.from(scope.querySelectorAll("button, [role='button'], [role='combobox'], select"))
        .find((candidate) => isVisible(candidate) && !isDisabled(candidate));
      if (control) return control;
      scope = scope.parentElement;
    }
  }

  return null;
}

function queryVisible(selector, options = {}) {
  if (!selector || typeof selector !== "string") return null;
  try {
    const element = document.querySelector(selector);
    if (!element) return null;
    if (options.allowHiddenFile && element.matches("input[type='file']")) return element;
    return isVisible(element) ? element : null;
  } catch {
    return null;
  }
}

function visibleElements(selector) {
  return Array.from(document.querySelectorAll(selector)).filter(isVisible);
}

function closestClickable(element) {
  return element.closest("button, [role='button'], [role='option'], [role='menuitem'], label, a, [tabindex]");
}

function isVisible(element) {
  if (!element || !(element instanceof Element)) return false;
  const rect = element.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return false;
  const styles = getComputedStyle(element);
  return styles.visibility !== "hidden" && styles.display !== "none" && Number(styles.opacity || 1) > 0.01;
}

function isDisabled(element) {
  return Boolean(
    element.disabled ||
      element.getAttribute("aria-disabled") === "true" ||
      element.getAttribute("data-disabled") === "true" ||
      /\bdisabled\b/i.test(element.className || "")
  );
}

function textOf(element) {
  if (!element) return "";
  if (element instanceof HTMLInputElement) return element.value || element.getAttribute("aria-label") || "";
  return [
    element.textContent,
    element.getAttribute?.("aria-label"),
    element.getAttribute?.("title"),
    element.getAttribute?.("placeholder")
  ]
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

function setEditableValue(element, value) {
  element.focus();

  if (element.isContentEditable || element.getAttribute("role") === "textbox") {
    element.textContent = value;
    element.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: value }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
    return;
  }

  const prototype =
    element instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : element instanceof HTMLInputElement
        ? HTMLInputElement.prototype
        : null;
  const setter = prototype ? Object.getOwnPropertyDescriptor(prototype, "value")?.set : null;

  if (setter) {
    setter.call(element, value);
  } else {
    element.value = value;
  }

  element.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: value }));
  element.dispatchEvent(new Event("change", { bubbles: true }));
}

function clickElement(element) {
  element.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, pointerId: 1 }));
  element.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
  element.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
  element.click();
}

function scanPageImages() {
  const byUrl = new Map();

  const addImage = (rawUrl, element, source) => {
    const url = toAbsoluteUrl(rawUrl);
    if (!url || /^blob:|^chrome:|^edge:|^about:/i.test(url)) return;
    if (/\.svg(?:$|[?#])/i.test(url)) return;

    const rect = element?.getBoundingClientRect?.() || { left: 0, top: 0, width: 0, height: 0 };
    const width = Math.round(element?.naturalWidth || rect.width || 0);
    const height = Math.round(element?.naturalHeight || rect.height || 0);
    const displayWidth = Math.round(rect.width || width || 0);
    const displayHeight = Math.round(rect.height || height || 0);
    const area = Math.max(width * height, displayWidth * displayHeight);
    if (Math.max(width, height, displayWidth, displayHeight) < 42 || area < 1200) return;

    const existing = byUrl.get(url);
    const context = textOf(element?.closest?.("label, button, [role='button'], section, form, article, div") || element?.parentElement || element);
    const image = {
      id: hashString(url),
      url,
      thumbnailUrl: url,
      name: getFileName(url, element?.currentSrc ? "" : "image/jpeg"),
      type: imageTypeFromUrl(url),
      alt: element?.getAttribute?.("alt") || element?.getAttribute?.("aria-label") || element?.getAttribute?.("title") || "",
      width,
      height,
      displayWidth,
      displayHeight,
      area,
      rect: {
        left: Math.round(rect.left),
        top: Math.round(rect.top),
        width: displayWidth,
        height: displayHeight
      },
      context: context.slice(0, 220),
      source
    };

    if (!existing || image.area > existing.area) byUrl.set(url, image);
  };

  document.querySelectorAll("img").forEach((img) => {
    addImage(img.currentSrc || img.src, img, "img");
    parseSrcset(img.getAttribute("srcset")).forEach((url) => addImage(url, img, "srcset"));
  });

  document.querySelectorAll("source[srcset]").forEach((source) => {
    const parent = source.closest("picture")?.querySelector("img") || source;
    parseSrcset(source.getAttribute("srcset")).forEach((url) => addImage(url, parent, "source"));
  });

  document.querySelectorAll("video[poster]").forEach((video) => addImage(video.getAttribute("poster"), video, "poster"));

  visibleElements("*").forEach((element) => {
    const style = getComputedStyle(element);
    parseCssUrls(style.backgroundImage).forEach((url) => addImage(url, element, "background"));
  });

  return Array.from(byUrl.values())
    .sort((a, b) => b.area - a.area)
    .slice(0, 60);
}

function parseSrcset(srcset = "") {
  return String(srcset)
    .split(",")
    .map((part) => part.trim().split(/\s+/)[0])
    .filter(Boolean);
}

function parseCssUrls(value = "") {
  const urls = [];
  const pattern = /url\((?:"([^"]+)"|'([^']+)'|([^'")]+))\)/g;
  let match;
  while ((match = pattern.exec(value)) !== null) {
    urls.push(match[1] || match[2] || match[3]);
  }
  return urls;
}

function toAbsoluteUrl(value) {
  if (!value || typeof value !== "string") return "";
  try {
    return new URL(value.trim(), document.baseURI).href;
  } catch {
    return "";
  }
}

function getFileName(url, mimeType = "") {
  try {
    const parsed = new URL(url);
    const last = decodeURIComponent(parsed.pathname.split("/").filter(Boolean).pop() || "");
    if (last && /\.[a-z0-9]{2,5}$/i.test(last)) return safeFileName(last);
  } catch {
    // Fall through to MIME-derived name.
  }

  const extension = mimeToExtension(mimeType) || mimeToExtension(imageTypeFromUrl(url)) || "jpg";
  return `higgsfield-page-image.${extension}`;
}

function imageTypeFromUrl(url) {
  try {
    const parsed = new URL(url);
    const ext = parsed.pathname.match(/\.([a-z0-9]{2,5})$/i)?.[1]?.toLowerCase() || "";
    if (ext === "jpg") return "image/jpeg";
    if (["jpeg", "png", "webp", "gif", "avif"].includes(ext)) return `image/${ext}`;
  } catch {
    return "image/jpeg";
  }
  return "image/jpeg";
}

function mimeToExtension(mimeType = "") {
  const subtype = String(mimeType).split("/")[1]?.split(";")[0]?.toLowerCase() || "";
  if (subtype === "jpeg") return "jpg";
  if (["png", "webp", "gif", "avif"].includes(subtype)) return subtype;
  return "";
}

function safeFileName(value) {
  return String(value).replace(/[<>:"/\\|?*\x00-\x1F]/g, "-").slice(0, 120) || "higgsfield-page-image.jpg";
}

function createId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function hashString(value) {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash << 5) - hash + value.charCodeAt(index);
    hash |= 0;
  }
  return Math.abs(hash).toString(36);
}

function formatDuration(ms) {
  const minutes = Math.max(1, Math.ceil((Number(ms) || 0) / 60000));
  if (minutes < 60) return `in ~${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `in ~${hours}h ${rest}m` : `in ~${hours}h`;
}
async function imageToFile(image) {
  if (image.dataUrl) {
    const response = await fetch(image.dataUrl);
    const blob = await response.blob();
    return new File([blob], image.name || "reference-image.png", { type: image.type || blob.type || "image/png" });
  }

  if (image.url) {
    const response = await fetch(image.url, { credentials: "include", cache: "force-cache" });
    if (!response.ok) throw new Error(`Could not fetch selected page image (${response.status}).`);
    const blob = await response.blob();
    return new File([blob], image.name || getFileName(image.url, blob.type), { type: image.type || blob.type || "image/jpeg" });
  }

  throw new Error("No image data available.");
}

function titleFor(item) {
  const first = String(item.prompt || "").split(/\r?\n/).map((line) => line.trim()).find(Boolean);
  return first ? first.slice(0, 70) : "Untitled";
}

function normalizeText(value = "") {
  return String(value).replace(/\s+/g, " ").trim().toLowerCase();
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
