"use strict";

const state = {
  tab: null,
  images: [],
  filtered: [],
  selected: new Set(),
  columns: 4,
  minSize: 50,
  reverseSort: false,
  busy: false
};

const extensionApi = typeof chrome !== "undefined" && chrome.tabs && chrome.scripting && chrome.downloads;

const els = {
  pageHost: document.querySelector("#pageHost"),
  refreshButton: document.querySelector("#refreshButton"),
  visibleCount: document.querySelector("#visibleCount"),
  totalCount: document.querySelector("#totalCount"),
  selectedCount: document.querySelector("#selectedCount"),
  urlFilter: document.querySelector("#urlFilter"),
  minSizeRange: document.querySelector("#minSizeRange"),
  minSizeValue: document.querySelector("#minSizeValue"),
  sortMode: document.querySelector("#sortMode"),
  visibleOnly: document.querySelector("#visibleOnly"),
  selectAllButton: document.querySelector("#selectAllButton"),
  clearSelectionButton: document.querySelector("#clearSelectionButton"),
  reverseButton: document.querySelector("#reverseButton"),
  saveDefaultsButton: document.querySelector("#saveDefaultsButton"),
  downloadAllButton: document.querySelector("#downloadAllButton"),
  downloadButton: document.querySelector("#downloadButton"),
  downloadFormat: document.querySelector("#downloadFormat"),
  columnsRange: document.querySelector("#columnsRange"),
  columnCount: document.querySelector("#columnCount"),
  typeShortcuts: Array.from(document.querySelectorAll(".typeShortcut")),
  gallery: document.querySelector("#gallery"),
  template: document.querySelector("#imageCardTemplate"),
  statePanel: document.querySelector("#statePanel"),
  stateTitle: document.querySelector("#stateTitle"),
  stateMessage: document.querySelector("#stateMessage"),
  previewDialog: document.querySelector("#previewDialog"),
  previewTitle: document.querySelector("#previewTitle"),
  previewImage: document.querySelector("#previewImage"),
  previewMeta: document.querySelector("#previewMeta"),
  closePreviewButton: document.querySelector("#closePreviewButton"),
  toast: document.querySelector("#toast")
};

const IMAGE_TYPES = new Map([
  ["jpg", "jpeg"],
  ["jpeg", "jpeg"],
  ["png", "png"],
  ["webp", "webp"],
  ["gif", "gif"],
  ["svg", "svg"],
  ["avif", "avif"],
  ["bmp", "bmp"],
  ["ico", "ico"]
]);

const PREFS_VERSION = 5;
const DEFAULT_SETTINGS = {
  sortMode: "area",
  visibleOnly: false,
  columns: 4,
  minSize: 50,
  reverseSort: false,
  downloadFormat: "original",
  typeGroups: ["jpeg", "png"]
};

init();

async function init() {
  bindEvents();
  setColumns(state.columns);
  setMinSize(state.minSize);
  updateReverseButton();
  await restorePreferences();
  await scanActiveTab();
}

function bindEvents() {
  els.refreshButton.addEventListener("click", scanActiveTab);
  els.urlFilter.addEventListener("input", applyFilters);
  els.minSizeRange.addEventListener("input", () => {
    setMinSize(Number(els.minSizeRange.value));
    applyFilters();
  });
  els.sortMode.addEventListener("change", () => {
    savePreferences();
    applyFilters();
  });
  els.visibleOnly.addEventListener("change", applyFilters);
  els.selectAllButton.addEventListener("click", selectVisible);
  els.clearSelectionButton.addEventListener("click", clearSelection);
  els.reverseButton.addEventListener("click", toggleReverseSort);
  els.saveDefaultsButton.addEventListener("click", saveCurrentSettingsAsDefault);
  els.downloadAllButton.addEventListener("click", downloadVisible);
  els.downloadButton.addEventListener("click", downloadSelected);
  els.downloadFormat.addEventListener("change", savePreferences);
  els.columnsRange.addEventListener("input", () => {
    setColumns(Number(els.columnsRange.value));
    savePreferences();
  });
  els.closePreviewButton.addEventListener("click", () => els.previewDialog.close());

  els.typeShortcuts.forEach((input) => {
    input.addEventListener("change", applyFilters);
  });
}

async function restorePreferences() {
  if (!extensionApi) return;

  const stored = await chrome.storage.local.get({
    prefsVersion: 0,
    ...DEFAULT_SETTINGS,
    savedDefaults: null
  });
  const savedDefaults = normalizeSettings(stored.savedDefaults);
  const prefs = stored.prefsVersion === PREFS_VERSION ? stored : { ...DEFAULT_SETTINGS, ...savedDefaults };

  els.sortMode.value = prefs.sortMode || DEFAULT_SETTINGS.sortMode;
  els.visibleOnly.checked = Boolean(prefs.visibleOnly);
  els.downloadFormat.value = prefs.downloadFormat || DEFAULT_SETTINGS.downloadFormat;
  els.typeShortcuts.forEach((input) => {
    input.checked = (prefs.typeGroups || DEFAULT_SETTINGS.typeGroups).includes(input.value);
  });
  state.reverseSort = Boolean(prefs.reverseSort);
  setColumns(prefs.columns);
  setMinSize(prefs.minSize);
  updateReverseButton();
}

function savePreferences() {
  if (!extensionApi) return;

  chrome.storage.local.set({
    prefsVersion: PREFS_VERSION,
    ...getCurrentSettings()
  });
}

async function saveCurrentSettingsAsDefault() {
  const settings = getCurrentSettings();

  if (!extensionApi) {
    toast("Load as an unpacked Chrome extension to save defaults.");
    return;
  }

  await chrome.storage.local.set({
    prefsVersion: PREFS_VERSION,
    ...settings,
    savedDefaults: settings
  });
  toast("Current settings saved as default.");
}

function getCurrentSettings() {
  return {
    sortMode: els.sortMode.value,
    visibleOnly: els.visibleOnly.checked,
    columns: state.columns,
    minSize: state.minSize,
    reverseSort: state.reverseSort,
    downloadFormat: els.downloadFormat.value,
    typeGroups: getSelectedTypeGroups()
  };
}

function normalizeSettings(settings) {
  if (!settings || typeof settings !== "object") return {};

  const minSize = Number(settings.minSize);

  return {
    sortMode: settings.sortMode || DEFAULT_SETTINGS.sortMode,
    visibleOnly: Boolean(settings.visibleOnly),
    columns: Number(settings.columns) || DEFAULT_SETTINGS.columns,
    minSize: Number.isFinite(minSize) ? minSize : DEFAULT_SETTINGS.minSize,
    reverseSort: Boolean(settings.reverseSort),
    downloadFormat: settings.downloadFormat || DEFAULT_SETTINGS.downloadFormat,
    typeGroups: Array.isArray(settings.typeGroups) ? settings.typeGroups : DEFAULT_SETTINGS.typeGroups
  };
}

async function scanActiveTab() {
  if (state.busy) return;

  if (!extensionApi) {
    loadDemoImages();
    return;
  }

  state.busy = true;
  state.selected.clear();
  renderState("Scanning images", "Looking through the active tab.", true);
  updateCounts();

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    state.tab = tab;
    setHostLabel(tab?.url);

    if (!tab?.id || !isInjectableUrl(tab.url)) {
      throw new Error("This tab cannot be scanned by Chrome extensions.");
    }

    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id, allFrames: true },
      func: collectImagesFromPage
    });

    const rawImages = results.flatMap((result, frameIndex) => {
      const frameImages = Array.isArray(result.result) ? result.result : [];
      return frameImages.map((image) => ({ ...image, frameIndex }));
    });

    state.images = dedupeImages(rawImages);
    applyFilters();
    enrichVisibleMetadata();
  } catch (error) {
    console.error(error);
    state.images = [];
    state.filtered = [];
    renderGallery();
    renderState("Could not scan this tab", error.message || "Try a normal webpage tab.", false);
  } finally {
    state.busy = false;
  }
}

function collectImagesFromPage() {
  const images = [];
  let order = 0;

  const toAbsolute = (value, base = document.baseURI) => {
    if (!value || typeof value !== "string") return "";
    const trimmed = value.trim();
    if (!trimmed || trimmed === "none") return "";
    try {
      return new URL(trimmed, base).href;
    } catch {
      return "";
    }
  };

  const parseSrcset = (srcset) => {
    if (!srcset || typeof srcset !== "string") return [];
    return srcset
      .split(",")
      .map((item) => item.trim().split(/\s+/)[0])
      .map((url) => toAbsolute(url))
      .filter(Boolean);
  };

  const parseCssUrls = (value) => {
    if (!value || value === "none") return [];
    const urls = [];
    const pattern = /url\((?:"([^"]+)"|'([^']+)'|([^'")]+))\)/g;
    let match;
    while ((match = pattern.exec(value)) !== null) {
      const url = toAbsolute(match[1] || match[2] || match[3]);
      if (url) urls.push(url);
    }
    return urls;
  };

  const getRectData = (element) => {
    const rect = element.getBoundingClientRect();
    const width = Math.round(rect.width);
    const height = Math.round(rect.height);
    const inViewport =
      rect.bottom > 0 &&
      rect.right > 0 &&
      rect.top < window.innerHeight &&
      rect.left < window.innerWidth;

    return {
      displayWidth: width,
      displayHeight: height,
      pageX: Math.round(rect.left + window.scrollX),
      pageY: Math.round(rect.top + window.scrollY),
      visible: width > 0 && height > 0 && inViewport
    };
  };

  const textOf = (element) => {
    const alt = element.getAttribute("alt");
    const aria = element.getAttribute("aria-label");
    const title = element.getAttribute("title");
    return [alt, aria, title].filter(Boolean).join(" | ").slice(0, 180);
  };

  const addImage = (input) => {
    const url = toAbsolute(input.url);
    if (!url || /^chrome:|^edge:|^about:|^devtools:/i.test(url)) return;

    images.push({
      url,
      pageUrl: location.href,
      pageTitle: document.title,
      source: input.source || "image",
      alt: input.alt || "",
      width: Math.max(0, Math.round(input.width || input.displayWidth || 0)),
      height: Math.max(0, Math.round(input.height || input.displayHeight || 0)),
      displayWidth: Math.max(0, Math.round(input.displayWidth || input.width || 0)),
      displayHeight: Math.max(0, Math.round(input.displayHeight || input.height || 0)),
      pageX: Math.max(0, Math.round(input.pageX || 0)),
      pageY: Math.max(0, Math.round(input.pageY || 0)),
      visible: Boolean(input.visible),
      order: order++
    });
  };

  document.querySelectorAll("img").forEach((img) => {
    const rect = getRectData(img);
    const urls = [
      img.currentSrc,
      img.src,
      ...parseSrcset(img.getAttribute("srcset")),
      img.getAttribute("data-src"),
      img.getAttribute("data-original"),
      img.getAttribute("data-lazy-src")
    ];

    urls.forEach((url) => {
      addImage({
        url,
        source: "img",
        alt: textOf(img),
        width: img.naturalWidth,
        height: img.naturalHeight,
        ...rect
      });
    });
  });

  document.querySelectorAll("source[srcset]").forEach((source) => {
    parseSrcset(source.getAttribute("srcset")).forEach((url) => {
      const parent = source.closest("picture")?.querySelector("img") || source;
      addImage({
        url,
        source: "source",
        alt: textOf(parent),
        width: parent.naturalWidth,
        height: parent.naturalHeight,
        ...getRectData(parent)
      });
    });
  });

  document.querySelectorAll("video[poster], link[rel~='icon'], link[rel~='apple-touch-icon']").forEach((element) => {
    const attr = element.tagName === "VIDEO" ? "poster" : "href";
    addImage({
      url: element.getAttribute(attr),
      source: element.tagName === "VIDEO" ? "poster" : "icon",
      alt: textOf(element),
      ...getRectData(element)
    });
  });

  document.querySelectorAll("*").forEach((element) => {
    const rect = getRectData(element);
    const styles = [getComputedStyle(element)];

    try {
      styles.push(getComputedStyle(element, "::before"), getComputedStyle(element, "::after"));
    } catch {
      // Some pages block pseudo style reads; real element backgrounds are still collected.
    }

    styles.forEach((style) => {
      parseCssUrls(style.backgroundImage).forEach((url) => {
        addImage({
          url,
          source: "background",
          alt: textOf(element),
          ...rect
        });
      });
    });
  });

  if (performance?.getEntriesByType) {
    performance
      .getEntriesByType("resource")
      .filter((entry) => ["img", "image", "css"].includes(entry.initiatorType))
      .forEach((entry) => {
        addImage({
          url: entry.name,
          source: "resource",
          width: 0,
          height: 0,
          displayWidth: 0,
          displayHeight: 0,
          visible: false
        });
      });
  }

  return images;
}

function dedupeImages(rawImages) {
  const byUrl = new Map();

  rawImages.forEach((image) => {
    const key = normalizeUrlKey(image.url);
    const existing = byUrl.get(key);
    const next = normalizeImage(image);

    if (!existing) {
      byUrl.set(key, next);
      return;
    }

    const existingArea = existing.width * existing.height;
    const nextArea = next.width * next.height;
    const preferNext = nextArea > existingArea || (existing.source === "resource" && next.source !== "resource");

    byUrl.set(key, {
      ...(preferNext ? existing : next),
      ...(preferNext ? next : existing),
      alt: existing.alt || next.alt,
      visible: existing.visible || next.visible,
      sources: Array.from(new Set([...(existing.sources || [existing.source]), next.source])),
      order: Math.min(existing.order, next.order)
    });
  });

  return Array.from(byUrl.values()).map((image, index) => ({
    ...image,
    id: `${index}-${hashString(image.url)}`,
    fileName: getFileName(image.url, index),
    type: getImageType(image.url),
    area: image.width * image.height,
    sizeLabel: ""
  }));
}

function normalizeImage(image) {
  return {
    url: image.url,
    pageUrl: image.pageUrl || "",
    pageTitle: image.pageTitle || "",
    source: image.source || "image",
    sources: [image.source || "image"],
    alt: image.alt || "",
    width: Number(image.width) || 0,
    height: Number(image.height) || 0,
    displayWidth: Number(image.displayWidth) || 0,
    displayHeight: Number(image.displayHeight) || 0,
    pageX: Number(image.pageX) || 0,
    pageY: Number(image.pageY) || 0,
    visible: Boolean(image.visible),
    order: Number(image.order) || 0
  };
}

function normalizeUrlKey(url) {
  try {
    const parsed = new URL(url);
    parsed.hash = "";
    return parsed.href;
  } catch {
    return url;
  }
}

function applyFilters() {
  const query = els.urlFilter.value.trim().toLowerCase();
  const typeGroups = getSelectedTypeGroups();
  const visibleOnly = els.visibleOnly.checked;

  state.filtered = state.images.filter((image) => {
    const haystack = `${image.url} ${image.alt} ${image.fileName}`.toLowerCase();
    if (query && !haystack.includes(query)) return false;
    if (state.minSize && getEquivalentSize(image) < state.minSize) return false;
    if (!matchesTypeGroups(image, typeGroups)) return false;
    if (visibleOnly && !image.visible) return false;
    return true;
  });

  sortImages(state.filtered, els.sortMode.value);
  if (state.reverseSort) state.filtered.reverse();
  savePreferences();
  renderGallery();
  updateCounts();
}

function sortImages(images, mode) {
  const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });
  const sorts = {
    position: (a, b) => a.pageY - b.pageY || a.pageX - b.pageX || a.order - b.order,
    area: (a, b) => b.area - a.area || b.width - a.width,
    width: (a, b) => b.width - a.width,
    height: (a, b) => b.height - a.height,
    name: (a, b) => collator.compare(a.fileName, b.fileName),
    type: (a, b) => collator.compare(a.type, b.type) || collator.compare(a.fileName, b.fileName)
  };

  images.sort(sorts[mode] || sorts.position);
}

function getSelectedTypeGroups() {
  return els.typeShortcuts.filter((input) => input.checked).map((input) => input.value);
}

function matchesTypeGroups(image, groups) {
  if (!groups.length) return false;
  if (groups.includes("jpeg") && image.type === "jpeg") return true;
  if (groups.includes("png") && image.type === "png") return true;
  if (groups.includes("other") && image.type !== "jpeg" && image.type !== "png") return true;
  return false;
}

function renderGallery() {
  els.gallery.textContent = "";

  if (state.busy) return;

  if (!state.images.length) {
    renderState("No images found", "Refresh after the page finishes loading.", false);
    return;
  }

  if (!state.filtered.length) {
    renderState("No matches", "Adjust the filters to bring images back.", false);
    return;
  }

  hideState();

  const fragment = document.createDocumentFragment();
  state.filtered.forEach((image) => {
    fragment.appendChild(createCard(image));
  });
  els.gallery.appendChild(fragment);
}

function createCard(image) {
  const node = els.template.content.firstElementChild.cloneNode(true);
  const check = node.querySelector(".card-check");
  const previewButton = node.querySelector(".preview-button");
  const thumb = node.querySelector(".thumb");
  const title = node.querySelector(".file-name");
  const pill = node.querySelector(".type-pill");
  const meta = node.querySelector(".meta");
  const source = node.querySelector(".source-line");

  check.checked = state.selected.has(image.id);
  node.classList.toggle("is-selected", check.checked);
  check.addEventListener("change", () => {
    if (check.checked) {
      state.selected.add(image.id);
    } else {
      state.selected.delete(image.id);
    }
    node.classList.toggle("is-selected", check.checked);
    updateCounts();
  });

  thumb.src = image.url;
  thumb.alt = image.alt || image.fileName;
  thumb.loading = "lazy";
  title.textContent = image.fileName;
  pill.textContent = image.type || "img";
  meta.textContent = buildMetaLine(image);
  source.textContent = `${image.sources?.join(", ") || image.source} · ${trimUrl(image.url)}`;
  previewButton.addEventListener("click", () => showPreview(image));

  node.querySelector(".copy-url").addEventListener("click", () => copyUrl(image.url));
  node.querySelector(".open-url").addEventListener("click", () => openTab(image.url));
  node.querySelector(".reverse-search").addEventListener("click", () => {
    openTab(`https://lens.google.com/uploadbyurl?url=${encodeURIComponent(image.url)}`);
  });
  node.querySelector(".download-one").addEventListener("click", () => downloadImages([image], els.downloadFormat.value));

  return node;
}

function buildMetaLine(image) {
  const dimensions = image.width && image.height ? `${image.width} x ${image.height}` : "size unknown";
  const display = image.displayWidth && image.displayHeight ? `shown ${image.displayWidth} x ${image.displayHeight}` : "";
  return [dimensions, image.sizeLabel, display].filter(Boolean).join(" · ");
}

function updateCounts() {
  els.visibleCount.textContent = String(state.filtered.length);
  els.totalCount.textContent = `of ${state.images.length} images`;
  els.selectedCount.textContent = String(state.selected.size);
  els.downloadButton.disabled = state.selected.size === 0;
  els.clearSelectionButton.disabled = state.selected.size === 0;
  els.downloadAllButton.disabled = state.filtered.length === 0;
}

function selectVisible() {
  state.filtered.forEach((image) => state.selected.add(image.id));
  renderGallery();
  updateCounts();
}

function clearSelection() {
  state.selected.clear();
  renderGallery();
  updateCounts();
}

async function downloadSelected() {
  const selected = state.images.filter((image) => state.selected.has(image.id));
  await downloadImages(selected, els.downloadFormat.value);
}

async function downloadVisible() {
  await downloadImages(state.filtered, els.downloadFormat.value);
}

async function downloadImages(images, format) {
  if (!images.length) return;
  if (!extensionApi) {
    toast("Load as an unpacked Chrome extension to download.");
    return;
  }

  els.downloadButton.disabled = true;
  toast(`Preparing ${images.length} image${images.length === 1 ? "" : "s"}...`);

  let success = 0;
  let failed = 0;

  for (const image of images) {
    try {
      if (format === "original") {
        await chrome.downloads.download({
          url: image.url,
          filename: buildDownloadPath(image, image.type || "image"),
          saveAs: false,
          conflictAction: "uniquify"
        });
      } else {
        await downloadConvertedImage(image, format);
      }
      success += 1;
    } catch (error) {
      console.warn("Download failed", image.url, error);
      failed += 1;
    }
  }

  updateCounts();
  toast(failed ? `${success} downloaded, ${failed} failed.` : `${success} downloaded.`);
}

async function downloadConvertedImage(image, format) {
  const blob = await fetchImageBlob(image.url);
  const converted = await convertBlob(blob, format);
  const objectUrl = URL.createObjectURL(converted);
  const extension = format === "jpeg" ? "jpg" : format;

  try {
    await chrome.downloads.download({
      url: objectUrl,
      filename: buildDownloadPath(image, extension),
      saveAs: false,
      conflictAction: "uniquify"
    });
  } finally {
    setTimeout(() => URL.revokeObjectURL(objectUrl), 30000);
  }
}

async function fetchImageBlob(url) {
  if (url.startsWith("data:")) {
    const response = await fetch(url);
    return response.blob();
  }

  const response = await fetch(url, { credentials: "include", cache: "force-cache" });
  if (!response.ok) throw new Error(`Fetch failed: ${response.status}`);
  return response.blob();
}

async function convertBlob(blob, format) {
  const bitmap = await createImageBitmap(blob);
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const ctx = canvas.getContext("2d");

  if (format === "jpeg") {
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }

  ctx.drawImage(bitmap, 0, 0);
  bitmap.close?.();

  return canvas.convertToBlob({
    type: `image/${format}`,
    quality: format === "png" ? undefined : 0.92
  });
}

function buildDownloadPath(image, extension) {
  const host = safeName(getHostName(state.tab?.url || image.pageUrl) || "page");
  const base = safeName(stripExtension(image.fileName) || "image");
  const ext = extension === "jpeg" ? "jpg" : extension || "image";
  return `Gallery Image Downloader/${host}/${base}.${ext}`;
}

function showPreview(image) {
  els.previewTitle.textContent = image.fileName;
  els.previewImage.src = image.url;
  els.previewImage.alt = image.alt || image.fileName;
  els.previewMeta.textContent = `${buildMetaLine(image)} · ${image.url}`;
  els.previewDialog.showModal();
}

async function copyUrl(url) {
  try {
    if (!navigator.clipboard?.writeText) throw new Error("Clipboard API unavailable");
    await navigator.clipboard.writeText(url);
  } catch {
    const input = document.createElement("textarea");
    input.value = url;
    document.body.appendChild(input);
    input.select();
    document.execCommand("copy");
    input.remove();
  }
  toast("URL copied.");
}

function openTab(url) {
  if (extensionApi) {
    chrome.tabs.create({ url });
    return;
  }

  window.open(url, "_blank", "noopener,noreferrer");
}

function setColumns(columns = 4) {
  state.columns = Math.min(8, Math.max(1, Number(columns) || 4));
  els.columnsRange.value = String(state.columns);
  els.columnCount.textContent = String(state.columns);
  els.gallery.style.setProperty("--columns", String(state.columns));
  els.gallery.dataset.columns = String(state.columns);
}

function setMinSize(size = 50) {
  state.minSize = Math.min(1600, Math.max(0, Number(size) || 0));
  els.minSizeRange.value = String(state.minSize);
  els.minSizeValue.textContent = state.minSize ? `${state.minSize}px+` : "Any";
}

function getEquivalentSize(image) {
  const area = (Number(image.width) || 0) * (Number(image.height) || 0);
  return area > 0 ? Math.sqrt(area) : 0;
}

function toggleReverseSort() {
  state.reverseSort = !state.reverseSort;
  updateReverseButton();
  applyFilters();
}

function updateReverseButton() {
  els.reverseButton.classList.toggle("is-active", state.reverseSort);
  els.reverseButton.title = state.reverseSort ? "Show largest first" : "Show smallest first";
  els.reverseButton.setAttribute("aria-label", els.reverseButton.title);
}

async function enrichVisibleMetadata() {
  const candidates = state.filtered.slice(0, 80).filter((image) => !image.sizeLabel);
  await Promise.allSettled(candidates.map(enrichOneImage));
  renderGallery();
}

async function enrichOneImage(image) {
  if (image.url.startsWith("data:")) {
    const [meta, data = ""] = image.url.split(",");
    image.type = mimeToType(meta.match(/data:([^;]+)/)?.[1]) || image.type;
    image.sizeLabel = formatBytes(Math.ceil((data.length * 3) / 4));
    return;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 2500);

  try {
    const response = await fetch(image.url, {
      method: "HEAD",
      credentials: "include",
      signal: controller.signal
    });

    const mimeType = response.headers.get("content-type");
    const length = Number(response.headers.get("content-length"));
    image.type = mimeToType(mimeType) || image.type;
    image.sizeLabel = Number.isFinite(length) && length > 0 ? formatBytes(length) : image.sizeLabel;
  } finally {
    clearTimeout(timeout);
  }
}

function renderState(title, message, loading) {
  els.statePanel.classList.add("is-visible");
  els.statePanel.classList.toggle("is-loading", loading);
  els.stateTitle.textContent = title;
  els.stateMessage.textContent = message;
}

function hideState() {
  els.statePanel.classList.remove("is-visible", "is-loading");
}

function toast(message) {
  els.toast.textContent = message;
  els.toast.classList.add("is-visible");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => els.toast.classList.remove("is-visible"), 2600);
}

function setHostLabel(url) {
  els.pageHost.textContent = getHostName(url) || "Current tab";
}

function loadDemoImages() {
  setHostLabel("https://example.com/gallery");
  state.images = [
    {
      url: "https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?auto=format&fm=jpg&fit=crop&w=1200&q=80",
      pageUrl: "https://example.com/gallery",
      pageTitle: "Demo gallery",
      source: "img",
      sources: ["img"],
      alt: "House beside a lake",
      width: 1200,
      height: 800,
      displayWidth: 640,
      displayHeight: 426,
      pageX: 44,
      pageY: 220,
      visible: true,
      order: 0
    },
    {
      url: "https://images.unsplash.com/photo-1493246507139-91e8fad9978e?auto=format&fm=jpg&fit=crop&w=1200&q=80",
      pageUrl: "https://example.com/gallery",
      pageTitle: "Demo gallery",
      source: "background",
      sources: ["background"],
      alt: "Forest path",
      width: 1200,
      height: 801,
      displayWidth: 560,
      displayHeight: 374,
      pageX: 44,
      pageY: 760,
      visible: true,
      order: 1
    },
    {
      url: "https://images.unsplash.com/photo-1516117172878-fd2c41f4a759?auto=format&fm=jpg&fit=crop&w=900&q=80",
      pageUrl: "https://example.com/gallery",
      pageTitle: "Demo gallery",
      source: "resource",
      sources: ["resource"],
      alt: "Camera on desk",
      width: 900,
      height: 600,
      displayWidth: 0,
      displayHeight: 0,
      pageX: 0,
      pageY: 0,
      visible: false,
      order: 2
    },
    {
      url: "https://images.unsplash.com/photo-1500534314209-a25ddb2bd429?auto=format&fm=jpg&fit=crop&w=1100&q=80",
      pageUrl: "https://example.com/gallery",
      pageTitle: "Demo gallery",
      source: "img",
      sources: ["img"],
      alt: "Desert valley",
      width: 1100,
      height: 734,
      displayWidth: 420,
      displayHeight: 280,
      pageX: 40,
      pageY: 1180,
      visible: true,
      order: 3
    },
    {
      url: "https://images.unsplash.com/photo-1507525428034-b723cf961d3e?auto=format&fm=jpg&fit=crop&w=1000&q=80",
      pageUrl: "https://example.com/gallery",
      pageTitle: "Demo gallery",
      source: "background",
      sources: ["background"],
      alt: "Ocean shoreline",
      width: 1000,
      height: 667,
      displayWidth: 360,
      displayHeight: 240,
      pageX: 44,
      pageY: 1540,
      visible: true,
      order: 4
    },
    {
      url: "https://images.unsplash.com/photo-1500534314209-a25ddb2bd429?auto=format&fm=jpg&fit=crop&w=640&q=80",
      pageUrl: "https://example.com/gallery",
      pageTitle: "Demo gallery",
      source: "source",
      sources: ["source"],
      alt: "Small desert variant",
      width: 640,
      height: 427,
      displayWidth: 180,
      displayHeight: 120,
      pageX: 44,
      pageY: 1900,
      visible: true,
      order: 5
    },
    {
      url: "https://images.unsplash.com/photo-1495567720989-cebdbdd97913?auto=format&fm=jpg&fit=crop&w=720&q=80",
      pageUrl: "https://example.com/gallery",
      pageTitle: "Demo gallery",
      source: "img",
      sources: ["img"],
      alt: "City street",
      width: 720,
      height: 480,
      displayWidth: 280,
      displayHeight: 186,
      pageX: 44,
      pageY: 2240,
      visible: true,
      order: 6
    },
    {
      url: "https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?auto=format&fm=jpg&fit=crop&w=420&q=80",
      pageUrl: "https://example.com/gallery",
      pageTitle: "Demo gallery",
      source: "resource",
      sources: ["resource"],
      alt: "Small lake resource",
      width: 420,
      height: 280,
      displayWidth: 0,
      displayHeight: 0,
      pageX: 0,
      pageY: 0,
      visible: false,
      order: 7
    }
  ].map((image, index) => ({
    ...image,
    id: `${index}-${hashString(image.url)}`,
    fileName: getFileName(image.url, index),
    type: getImageType(image.url),
    area: image.width * image.height,
    sizeLabel: ""
  }));
  applyFilters();
  toast("Preview mode. Load the folder as an unpacked extension for live scanning.");
}

function isInjectableUrl(url = "") {
  return /^(https?|file):/i.test(url);
}

function getHostName(url = "") {
  try {
    return new URL(url).hostname || url;
  } catch {
    return "";
  }
}

function getFileName(url, index) {
  if (url.startsWith("data:")) return `inline-image-${index + 1}`;

  try {
    const parsed = new URL(url);
    const last = decodeURIComponent(parsed.pathname.split("/").filter(Boolean).pop() || "");
    const clean = last.replace(/[?#].*$/, "");
    return clean || `image-${index + 1}.${getImageType(url) || "img"}`;
  } catch {
    return `image-${index + 1}`;
  }
}

function getImageType(url) {
  if (url.startsWith("data:")) {
    return mimeToType(url.match(/^data:([^;,]+)/)?.[1]) || "data";
  }

  try {
    const parsed = new URL(url);
    const pathType = parsed.pathname.match(/\.([a-z0-9]{2,5})$/i)?.[1]?.toLowerCase();
    if (pathType && IMAGE_TYPES.has(pathType)) return IMAGE_TYPES.get(pathType);

    const formatHint = parsed.search.match(/[?&](?:fm|format|type)=([a-z0-9]+)/i)?.[1]?.toLowerCase();
    if (formatHint && IMAGE_TYPES.has(formatHint)) return IMAGE_TYPES.get(formatHint);
  } catch {
    return "";
  }

  return "";
}

function mimeToType(mime = "") {
  const subtype = mime.toLowerCase().split("/")[1]?.split(";")[0] || "";
  return IMAGE_TYPES.get(subtype) || subtype.replace("svg+xml", "svg");
}

function stripExtension(fileName) {
  return fileName.replace(/\.[a-z0-9]{2,5}$/i, "");
}

function safeName(value) {
  const clean = value
    .replace(/\.[a-z0-9]{2,5}$/i, "")
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 90);
  return clean || "image";
}

function trimUrl(url) {
  return url.length > 86 ? `${url.slice(0, 44)}...${url.slice(-34)}` : url;
}

function formatBytes(bytes) {
  if (!bytes) return "";
  const units = ["B", "KB", "MB", "GB"];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** index;
  return `${value >= 10 || index === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[index]}`;
}

function hashString(value) {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash << 5) - hash + value.charCodeAt(index);
    hash |= 0;
  }
  return Math.abs(hash).toString(36);
}

