"use strict";

const state = {
  tab: null,
  images: [],
  filtered: [],
  selected: new Set(),
  columns: 4,
  minSize: 50,
  reverseSort: false,
  busy: false,
  enrichToken: 0
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
  dedupeVariants: document.querySelector("#dedupeVariants"),
  hideChrome: document.querySelector("#hideChrome"),
  fullRes: document.querySelector("#fullRes"),
  mainContentOnly: document.querySelector("#mainContentOnly"),
  downloadFolder: document.querySelector("#downloadFolder"),
  askWhereToSave: document.querySelector("#askWhereToSave"),
  keepAnimated: document.querySelector("#keepAnimated"),
  selectAllButton: document.querySelector("#selectAllButton"),
  clearSelectionButton: document.querySelector("#clearSelectionButton"),
  reverseButton: document.querySelector("#reverseButton"),
  saveDefaultsButton: document.querySelector("#saveDefaultsButton"),
  downloadAllButton: document.querySelector("#downloadAllButton"),
  downloadZipButton: document.querySelector("#downloadZipButton"),
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

const PREFS_VERSION = 10;
const DEFAULT_SETTINGS = {
  sortMode: "content",
  visibleOnly: false,
  dedupeVariants: true,
  hideChrome: true,
  fullRes: true,
  mainContentOnly: true,
  columns: 4,
  minSize: 50,
  reverseSort: false,
  downloadFormat: "auto",
  downloadFolder: "",
  askWhereToSave: false,
  keepAnimated: true,
  typeGroups: ["jpeg", "png", "webp", "other"]
};

// Video and animation containers the gallery lists but never re-encodes.
const VIDEO_TYPES = new Map([
  ["mp4", "mp4"],
  ["m4v", "mp4"],
  ["webm", "webm"],
  ["mov", "mov"],
  ["ogv", "ogv"]
]);

const NAMED_TYPE_GROUPS = ["jpeg", "png", "webp"];

// Hosts that only ever serve tracking beacons, never content worth downloading.
const TRACKER_HOSTS =
  /(^|\.)(doubleclick\.net|googlesyndication\.com|google-analytics\.com|googletagmanager\.com|googleadservices\.com|facebook\.com|facebook\.net|bing\.com|scorecardresearch\.com|adnxs\.com|agkn\.com|kargo\.com|ispot\.tv|criteo\.(?:com|net)|taboola\.com|outbrain\.com|quantserve\.com|segment\.(?:io|com)|branch\.io|adsrvr\.org|everesttech\.net|rubiconproject\.com|pubmatic\.com|casalemedia\.com|amazon-adsystem\.com|krxd\.net|demdex\.net|omtrdc\.net|mathtag\.com|bluekai\.com)$/i;

// Fragments that are never part of a photo worth downloading.
const STRONG_CHROME_HINTS =
  /(?:^|[/_.-])(?:logo|logos|wordmark|brandmark|icon|icons|favicon|sprite|sprites|badge|badges|placeholder|spinner|loader|skeleton|avatar|watermark|pixel|tracking|beacon|blank|spacer|transparent|1x1|divider|bullet|emoji|no-?image|default-?(?:img|image|photo)|app-store|google-play)(?:[/_.-]|\d|$)/i;

// Fragments that often mark furniture but also appear in real photo names
// ("close-up-kitchen.jpg", "star-wars-poster.jpg"), so they only count against
// an image that is also small or isolated.
const WEAK_CHROME_HINTS =
  /(?:^|[/_.-])(?:btn|button|nav|navbar|menu|arrow|chevron|caret|close|cross|checkmark|star|rating|social|share|banner|header|footer|thumb|thumbnail)(?:[/_.-]|\d|$)/i;

const fullResCache = new Map();

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
  els.dedupeVariants.addEventListener("change", applyFilters);
  els.hideChrome.addEventListener("change", applyFilters);
  els.fullRes.addEventListener("change", savePreferences);
  els.mainContentOnly.addEventListener("change", applyFilters);
  els.downloadFolder.addEventListener("input", savePreferences);
  els.askWhereToSave.addEventListener("change", savePreferences);
  els.keepAnimated.addEventListener("change", savePreferences);
  els.selectAllButton.addEventListener("click", selectVisible);
  els.clearSelectionButton.addEventListener("click", clearSelection);
  els.reverseButton.addEventListener("click", toggleReverseSort);
  els.saveDefaultsButton.addEventListener("click", saveCurrentSettingsAsDefault);
  els.downloadAllButton.addEventListener("click", downloadVisible);
  els.downloadZipButton.addEventListener("click", downloadVisibleAsZip);
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
  els.dedupeVariants.checked = prefs.dedupeVariants !== false;
  els.hideChrome.checked = prefs.hideChrome !== false;
  els.fullRes.checked = prefs.fullRes !== false;
  els.mainContentOnly.checked = prefs.mainContentOnly !== false;
  els.downloadFolder.value = prefs.downloadFolder || "";
  els.askWhereToSave.checked = Boolean(prefs.askWhereToSave);
  els.keepAnimated.checked = prefs.keepAnimated !== false;
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
    dedupeVariants: els.dedupeVariants.checked,
    hideChrome: els.hideChrome.checked,
    fullRes: els.fullRes.checked,
    mainContentOnly: els.mainContentOnly.checked,
    downloadFolder: els.downloadFolder.value.trim(),
    askWhereToSave: els.askWhereToSave.checked,
    keepAnimated: els.keepAnimated.checked,
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
    dedupeVariants: settings.dedupeVariants !== false,
    hideChrome: settings.hideChrome !== false,
    fullRes: settings.fullRes !== false,
    mainContentOnly: settings.mainContentOnly !== false,
    downloadFolder: typeof settings.downloadFolder === "string" ? settings.downloadFolder : "",
    askWhereToSave: Boolean(settings.askWhereToSave),
    keepAnimated: settings.keepAnimated !== false,
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
      func: collectImagesFromPage,
      args: [TRACKER_HOSTS.source]
    });

    const rawImages = results.flatMap((result, frameIndex) => {
      const frameImages = Array.isArray(result.result) ? result.result : [];
      return frameImages.map((image) => ({ ...image, frameIndex }));
    });

    state.images = dedupeImages(rawImages);
    state.busy = false;
    applyFilters();
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

function collectImagesFromPage(trackerHostSource) {
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
      .split(/,(?=\s*(?:https?:\/\/|data:|\/|\.{0,2}\/|[\w-]+\.[\w-]+\/))/)
      .map((item) => {
        const parts = item.trim().split(/\s+/);
        const url = toAbsolute(parts[0]);
        if (!url) return null;
        const descriptor = parts[1] || "";
        const widthMatch = descriptor.match(/^(\d+)w$/i);
        return { url, widthHint: widthMatch ? Number(widthMatch[1]) : 0 };
      })
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

  const trackerHosts = new RegExp(trackerHostSource, "i");

  const isBeacon = (url, input = {}) => {
    // 1x1 spacer / beacon data URIs
    if (/^data:image\/(?:gif|png|webp);base64,R0lGODlhAQAB|data:image\/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB/i.test(url)) {
      return true;
    }
    if (url.startsWith("data:") && url.length < 150) {
      return true;
    }

    try {
      const parsed = new URL(url);
      if (trackerHosts.test(parsed.hostname)) return true;
      if (/\/(?:gen_204|client_204|tr|pixel|track|tracking|beacon|collect|impression|event|telemetry|ping|record|p\.gif)(?:\/|[?#]|$)/i.test(parsed.pathname)) {
        return true;
      }
      if (/(?:^|\.)google\.[a-z.]+/i.test(parsed.hostname) && /^\/(?:gen_204|client_204|async|log|batch)/i.test(parsed.pathname)) {
        return true;
      }
      if (/\/(?:spacer|blank|pixel|cleardot|1x1|transparent)\.(?:gif|png|jpe?g|webp|ico)$/i.test(parsed.pathname)) {
        return true;
      }
    } catch {
      return false;
    }

    // 1x1 (and other sub-8px) spacer/beacon images are never worth listing.
    const w = Number(input.width) || Number(input.displayWidth) || 0;
    const h = Number(input.height) || Number(input.displayHeight) || 0;
    return w > 0 && h > 0 && w < 8 && h < 8;
  };

  const addImage = (input) => {
    const url = toAbsolute(input.url);
    if (!url || /^chrome:|^edge:|^about:|^devtools:/i.test(url)) return;
    if (isBeacon(url, input)) return;

    images.push({
      url,
      thumbUrl: input.thumbUrl || "",
      originalUrl: input.originalUrl || "",
      section: input.section || "",
      widthHint: Math.max(0, Math.round(input.widthHint || 0)),
      pageUrl: input.pageUrl || location.href,
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

  // Pages label their recommendation modules with ordinary headings
  // ("Comparable homes", "Customers also bought"). Tagging every element with
  // the heading that precedes it gives a region label that works site to site.
  const headingFor = new Map();
  {
    const root = document.body || document.documentElement;
    if (root) {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
      let current = "";
      let node = walker.currentNode;
      while (node) {
        if (/^H[1-6]$/.test(node.tagName)) {
          current = (node.textContent || "").replace(/\s+/g, " ").trim().slice(0, 120);
        } else {
          headingFor.set(node, current);
        }
        node = walker.nextNode();
      }
    }
  }

  const sectionOf = (element) => headingFor.get(element) || "";

  const LAZY_ATTRS = [
    "data-src",
    "data-original",
    "data-lazy-src",
    "data-lazy",
    "data-srcset",
    "data-original-src",
    "data-full-src",
    "data-large",
    "data-zoom-image",
    "data-image",
    "data-defer-src",
    "data-hi-res-src"
  ];

  document.querySelectorAll("img").forEach((img) => {
    const rawSrc = img.getAttribute("src") || "";
    // Skip 1x1 blank/spacer GIF or PNG placeholders unless they have a lazy-load attribute
    if (/^data:image\/(?:gif|png|webp);base64,R0lGODlhAQAB|data:image\/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB/i.test(rawSrc)) {
      const hasLazy = LAZY_ATTRS.some((attr) => Boolean(img.getAttribute(attr)));
      if (!hasLazy) return;
    }

    const rect = getRectData(img);
    const candidates = [
      { url: img.currentSrc, widthHint: 0 },
      { url: img.src, widthHint: 0 },
      ...parseSrcset(img.getAttribute("srcset"))
    ];

    LAZY_ATTRS.forEach((attr) => {
      const value = img.getAttribute(attr);
      if (!value) return;
      if (/srcset$/i.test(attr)) {
        candidates.push(...parseSrcset(value));
      } else {
        candidates.push({ url: value, widthHint: 0 });
      }
    });

    candidates.forEach(({ url, widthHint }) => {
      addImage({
        url,
        widthHint,
        source: "img",
        section: sectionOf(img),
        alt: textOf(img),
        width: img.naturalWidth,
        height: img.naturalHeight,
        ...rect
      });
    });
  });

  // On Google search / Google Images: extract structured results from embedded script data and links
  const isGoogle = /(?:^|\.)google\.[a-z.]+/i.test(location.hostname);
  if (isGoogle) {
    // 1. Scan script tags for Google's embedded image results data
    document.querySelectorAll("script").forEach((script) => {
      const text = script.textContent || "";
      if (!text.includes("gstatic.com") || !text.includes("http")) return;
      const decoded = text.replace(/\\u003d/g, "=").replace(/\\u0026/g, "&");
      const blockRegex = /\["(https:\/\/encrypted-tbn\d\.gstatic\.com\/images\?q=[^"]+)",\s*(\d+),\s*(\d+)\],\s*\["(https?:\/\/[^"]+)",\s*(\d+),\s*(\d+)\](?:[\s\S]*?"2003":\[null,[^,]*,"([^"]*)","([^"]*)")?/g;
      let m;
      while ((m = blockRegex.exec(decoded))) {
        const thumbUrl = m[1];
        const thumbH = Number(m[2]) || 0;
        const thumbW = Number(m[3]) || 0;
        const origUrl = toAbsolute(m[4]);
        const origH = Number(m[5]) || 0;
        const origW = Number(m[6]) || 0;
        const pageUrl = m[7] || "";
        const title = (m[8] || "").replace(/\\"/g, '"').replace(/&amp;/g, '&');

        if (origUrl) {
          addImage({
            url: origUrl,
            thumbUrl: thumbUrl,
            originalUrl: origUrl,
            width: origW,
            height: origH,
            displayWidth: thumbW,
            displayHeight: thumbH,
            alt: title,
            pageUrl: pageUrl,
            source: "google-result",
            visible: true
          });
        }
      }
    });

    // 2. Scan anchor tags for /imgres?imgurl=
    document.querySelectorAll("a[href*='imgurl=']").forEach((a) => {
      try {
        const parsed = new URL(a.href, location.href);
        const rawImgUrl = parsed.searchParams.get("imgurl");
        if (!rawImgUrl) return;
        const origUrl = toAbsolute(rawImgUrl);
        if (!origUrl) return;
        const pageUrl = parsed.searchParams.get("imgrefurl") || "";
        const w = Number(parsed.searchParams.get("w")) || 0;
        const h = Number(parsed.searchParams.get("h")) || 0;
        const tbnid = parsed.searchParams.get("tbnid") || parsed.searchParams.get("docid") || "";
        const thumbUrl = tbnid ? `https://encrypted-tbn0.gstatic.com/images?q=tbn:${tbnid}` : "";
        const title = a.textContent.trim() || a.getAttribute("aria-label") || textOf(a);

        addImage({
          url: origUrl,
          thumbUrl: thumbUrl,
          originalUrl: origUrl,
          width: w,
          height: h,
          displayWidth: w ? Math.min(w, 200) : 0,
          displayHeight: h ? Math.min(h, 200) : 0,
          alt: title,
          pageUrl: pageUrl,
          source: "google-result",
          visible: true
        });
      } catch {}
    });
  }

  document.querySelectorAll("source[srcset]").forEach((source) => {
    parseSrcset(source.getAttribute("srcset")).forEach(({ url, widthHint }) => {
      const parent = source.closest("picture")?.querySelector("img") || source;
      addImage({
        url,
        widthHint,
        source: "source",
        section: sectionOf(parent),
        alt: textOf(parent),
        width: parent.naturalWidth,
        height: parent.naturalHeight,
        ...getRectData(parent)
      });
    });
  });

  document.querySelectorAll("video").forEach((video) => {
    const rect = getRectData(video);
    const candidates = [video.currentSrc, video.getAttribute("src")];
    video.querySelectorAll("source[src]").forEach((source) => candidates.push(source.getAttribute("src")));

    candidates.forEach((candidate) => {
      // MSE/HLS players expose a blob: URL that only exists inside the page,
      // so there is nothing downloadable to list.
      if (!candidate || /^blob:/i.test(candidate)) return;
      addImage({
        url: candidate,
        source: "video",
        section: sectionOf(video),
        alt: textOf(video),
        width: video.videoWidth,
        height: video.videoHeight,
        ...rect
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
          section: sectionOf(element),
          alt: textOf(element),
          ...rect
        });
      });
    });
  });

  if (performance?.getEntriesByType) {
    performance
      .getEntriesByType("resource")
      .filter((entry) => ["img", "image"].includes(entry.initiatorType))
      .forEach((entry) => {
        const url = entry.name;
        if (!url || /^blob:|^data:/i.test(url)) return;
        try {
          const parsed = new URL(url);
          if (/\/(?:gen_204|client_204|tr|pixel|track|beacon|collect|log|event|telemetry|analytics)(?:\/|[?#]|$)/i.test(parsed.pathname)) return;
          if (trackerHosts.test(parsed.hostname)) return;
          const hasImgExt = /\.(?:jpe?g|png|webp|gif|avif|bmp|svg)(?:[?#]|$)/i.test(parsed.pathname);
          const isImgCdn = /(?:encrypted-tbn\d\.gstatic\.com|images\.unsplash\.com|cloudinary|imgix|twimg|fbcdn|pinimg|shopifycdn)/i.test(parsed.hostname);
          if (!hasImgExt && !isImgCdn) return;
        } catch {
          return;
        }

        addImage({
          url,
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
      thumbUrl: existing.thumbUrl || next.thumbUrl || "",
      originalUrl: existing.originalUrl || next.originalUrl || "",
      alt: existing.alt || next.alt,
      visible: existing.visible || next.visible,
      section: existing.section || next.section,
      widthHint: Math.max(existing.widthHint || 0, next.widthHint || 0),
      sources: Array.from(new Set([...(existing.sources || [existing.source]), next.source])),
      order: Math.min(existing.order, next.order)
    });
  });

  const merged = Array.from(byUrl.values()).map((image, index) => ({
    ...image,
    id: `${index}-${hashString(image.url)}`,
    fileName: getFileName(image.url, index, image.alt),
    type: getMediaType(image.url, image.source),
    isVideo: isVideoUrl(image.url, image.source),
    urlSizeHint: urlSizeHint(image.url),
    area: image.width * image.height,
    sizeLabel: "",
    sizeBytes: 0
  }));

  return scoreImages(assignVariantGroups(merged));
}

function assignVariantGroups(images) {
  const groups = new Map();
  images.forEach((image) => {
    const key = normalizeGroupKey(image.url);
    image.groupKey = key;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(image);
  });

  groups.forEach((group) => {
    group.sort(
      (a, b) =>
        variantSize(b) - variantSize(a) ||
        (b.area || 0) - (a.area || 0) ||
        (b.width || 0) - (a.width || 0) ||
        formatRank(b) - formatRank(a) ||
        (b.url.length || 0) - (a.url.length || 0)
    );
    const largest = group[0];
    // The grid renders dozens of cards at once, so point the thumbnail at the
    // smallest variant that still looks sharp rather than the full-size file.
    const forThumb = [...group].reverse().find((candidate) => variantSize(candidate) >= 200) || largest;

    group.forEach((image) => {
      image.groupSize = group.length;
      image.isLargestInGroup = image === largest;
      image.variantUrls = group.map((g) => g.url);
      image.thumbUrl = image.thumbUrl || forThumb.url;
      image.largestSize = Math.round(variantSize(largest));
    });
  });

  return images;
}

function normalizeGroupKey(url) {
  try {
    const parsed = new URL(url);

    // Preserve query parameters for Google Images and other query-identified endpoints
    if (/(^|\.)gstatic\.com$/i.test(parsed.hostname) && parsed.searchParams.has("q")) {
      return `gstatic.com/images?q=${parsed.searchParams.get("q")}`;
    }

    const genericEndpoints = /^\/(?:images?|photos?|pics?|media|view|thumb(?:nail)?|fetch|get|api\/image)(?:\/|$)/i;
    if (genericEndpoints.test(parsed.pathname)) {
      const idParam = ["id", "q", "item", "file", "url", "image", "img", "photo_id"].find((p) => parsed.searchParams.has(p));
      if (idParam) {
        return `${parsed.hostname}${parsed.pathname}?${idParam}=${parsed.searchParams.get(idParam)}`;
      }
    }

    let path = parsed.pathname;

    // Strip Cloudinary / Imgix-style transformation segments (e.g. /w_300,h_200/)
    path = path.replace(/\/(?:[a-z]_[a-z0-9_.,:-]+)(?:,[a-z]_[a-z0-9_.,:-]+)*(?=\/)/gi, "");
    // Strip word-based resize segments (/resize/, /thumbnail/, /large/, /originals/)
    path = path.replace(/\/(?:resize|thumb(?:nail)?|scaled|small|medium|large|xlarge|full|orig(?:inals?)?)(?=\/|$)/gi, "");
    // Strip dimension segments (/300x200/, /236x/) — must include 'x' to avoid stripping year/id folders.
    path = path.replace(/\/\d{2,4}x\d{0,4}(?=\/)/g, "");

    const segments = path.split("/").filter(Boolean);
    const fileName = segments.pop() || "";
    const extMatch = fileName.match(/\.([a-z0-9]{2,5})$/i);
    // The extension is deliberately dropped from the key: the same photo is
    // routinely published as both .webp and .jpg.
    let base = extMatch ? fileName.slice(0, -extMatch[0].length) : fileName;

    // Strip size hints from the filename: _300x200, -1200w, @2x, -150, .thumb
    base = base.replace(/[-_]?\d{2,4}x\d{2,4}$/i, "");
    base = base.replace(/[-_]?@\d+x$/i, "");
    base = base.replace(/[-_]?\d{2,4}[wh]$/i, "");
    base = base.replace(/[-_.](?:thumb|small|medium|large|xlarge|full|orig|original|preview)$/i, "");
    base = base.replace(/[-_]s\d{2,4}$/i, "");
    // Zillow bakes the size into the filename: <hash>-cc_ft_768, -p_e,
    // -uncropped_scaled_within_1536_1152. Strip it so variants group together.
    base = base.replace(/-(?:cc_ft_\d+|uncropped_scaled_within_\d+_\d+|p_[a-z])$/i, "");

    // Pinterest fans pins out across i.pinimg.com, i1-c.pinimg.com, etc. — collapse those.
    const host = parsed.hostname.replace(/^i\d*(?:-[a-z0-9]+)?\.pinimg\.com$/i, "i.pinimg.com");

    // When the filename is a content hash (long alphanumeric, no separators), the path is just
    // CDN sharding (e.g. Pinterest's /ab/cd/ef/<hash>.jpg) and varies between size variants on
    // some hosts. Group by host + filename only.
    if (/^[a-z0-9]{12,}$/i.test(base)) {
      return `${host}/${base.toLowerCase()}`;
    }

    const cleanPath = [...segments, base].join("/").toLowerCase();
    return `${host}/${cleanPath}`;
  } catch {
    return url;
  }
}

// Real galleries publish many images through one CDN path shape; site furniture
// does not. Cohort size is the strongest host-agnostic signal we have.
const SIZE_TOKEN_PATTERNS = [
  /within[-_](\d{2,5})[-_](\d{2,5})/i,                                  // uncropped_scaled_within_1536_1152
  /(?:^|[-_/])(\d{2,5})x(\d{2,5})(?=[-_./]|$)/i,                        // 1536x1152
  /(?:^|[-_/])(?:cc_ft|ft|w|width|size|sz|s)[-_](\d{2,5})(?=[-_./]|$)/i, // cc_ft_768, w_1200
  /(?:^|[-_/])(\d{3,5})w(?=[-_./]|$)/i,                                  // 1200w
  /\/(\d{2,5})x\d{0,4}\//i                                             // /236x/
];

// Only reads recognised size tokens. A bare number sweep would pick digits out
// of content hashes like 0a62001bbf715b2609... and rank variants backwards.
function urlSizeHint(url) {
  let best = 0;

  try {
    const path = new URL(url).pathname;
    SIZE_TOKEN_PATTERNS.forEach((pattern) => {
      const match = path.match(pattern);
      if (!match) return;
      match.slice(1).forEach((value) => {
        const size = Number(value);
        if (size >= 32 && size <= 10000) best = Math.max(best, size);
      });
    });
  } catch {
    return 0;
  }

  return best;
}

// At equal resolution, prefer the encoding that Auto JPG/PNG can save
// byte-for-byte instead of re-encoding.
function formatRank(image) {
  if (image.type === "jpeg" || image.type === "png") return 2;
  if (image.type === "gif") return 1;
  return 0;
}

// How big a variant claims to be, from whichever source knows: the srcset
// descriptor, the URL's own size token, or a decoded natural size.
function variantSize(image) {
  return Math.max(
    Number(image.widthHint) || 0,
    Number(image.urlSizeHint) || 0,
    Math.sqrt(Number(image.area) || 0)
  );
}

function cohortKey(url) {
  try {
    const parsed = new URL(url);
    const segments = parsed.pathname.split("/").filter(Boolean);
    segments.pop();
    return `${parsed.hostname}/${segments.slice(0, 2).join("/")}`;
  } catch {
    return url;
  }
}

function bestKnownSize(image) {
  const natural = Math.sqrt((Number(image.width) || 0) * (Number(image.height) || 0));
  const shown = Math.sqrt((Number(image.displayWidth) || 0) * (Number(image.displayHeight) || 0));
  return Math.max(natural, shown, Number(image.widthHint) || 0);
}

// Headings that introduce a block of images belonging to something other than
// the thing the page is about: other listings, other products, other articles,
// staff and reviewer avatars, ad units.
const RECOMMENDATION_HEADINGS =
  /(?:comparable|similar|related|recommended|recommendations|suggested|nearby|sponsored|advertisement|promoted|trending|popular)|(?:you (?:might|may) (?:also )?like|for you|also (?:viewed|bought|liked|considered|purchased)|people also|customers also|frequently bought|more (?:like|from|homes|listings|products|stories|articles)|other (?:homes|listings|properties|products|sellers)|keep (?:shopping|browsing)|browse more|market insights|find an agent|meet the|our team|reviews?)/i;

function inRecommendedSection(image) {
  const heading = image.section || "";
  if (!heading) return false;
  return RECOMMENDATION_HEADINGS.test(heading);
}

function looksLikeSiteChrome(image) {
  if (image.isVideo) return false;
  if (image.source === "google-result") return false;
  if (image.source === "icon") return true;
  if (image.type === "svg" || image.type === "ico") return true;

  if (image.url.startsWith("data:")) {
    // Inline data URIs under ~3KB are icons, spacers and spinners.
    return image.url.length < 3000;
  }

  const size = bestKnownSize(image);
  if (size > 0 && size < 64) return true;

  const ratio = image.width && image.height ? image.width / image.height : 0;
  if (ratio && (ratio > 6 || ratio < 1 / 6)) return true;

  let path = image.url;
  try {
    path = new URL(image.url).pathname;
  } catch {
    // Keep the raw string; the hint patterns still apply.
  }

  if (STRONG_CHROME_HINTS.test(path)) return true;
  if (STRONG_CHROME_HINTS.test(image.alt || "")) return true;

  // A weak hint only condemns an image that is small, or that has no gallery
  // siblings to vouch for it.
  if (WEAK_CHROME_HINTS.test(path)) {
    if (size > 0 && size < 200) return true;
    if ((image.cohortSize || 1) < 3) return true;
  }

  return false;
}

function scoreImages(images) {
  const cohorts = new Map();
  images.forEach((image) => {
    const key = cohortKey(image.url);
    cohorts.set(key, (cohorts.get(key) || 0) + 1);
  });

  images.forEach((image) => {
    image.cohortSize = cohorts.get(cohortKey(image.url)) || 1;
  });

  images.forEach((image) => {
    image.isChrome = looksLikeSiteChrome(image);
    image.isRecommendation = inRecommendedSection(image);
    image.contentScore = scoreImage(image);
  });

  return images;
}

function scoreImage(image) {
  let score = 0;

  if (image.isChrome) score -= 140;
  if (image.isRecommendation) score -= 100;
  if (image.type === "svg" || image.type === "ico") score -= 60;
  if (image.source === "icon") score -= 80;

  // Resource-timing entries have no dimensions and are often prefetch noise.
  if (image.source === "resource" && !image.visible) score -= 20;

  const size = bestKnownSize(image);
  score += Math.min(60, size / 8);
  if (size > 0 && size < 64) score -= 60;
  if (size === 0) score -= 15;

  // A run of sibling images on the same CDN path is almost always the gallery.
  score += Math.min(36, (image.cohortSize || 1) * 4);

  // Descriptive alt text ("3rd image of 1850 Roscomare Rd") marks real content;
  // logos get "Zillow logo" or nothing.
  const alt = image.alt || "";
  if (alt.length > 8 && !STRONG_CHROME_HINTS.test(alt)) score += 14;

  if (image.visible) score += 8;
  if (image.groupSize > 1) score += 6;

  return Math.round(score);
}

function normalizeImage(image) {
  return {
    url: image.url,
    thumbUrl: image.thumbUrl || "",
    originalUrl: image.originalUrl || "",
    pageUrl: image.pageUrl || "",
    pageTitle: image.pageTitle || "",
    source: image.source || "image",
    sources: [image.source || "image"],
    alt: image.alt || "",
    width: Number(image.width) || 0,
    height: Number(image.height) || 0,
    displayWidth: Number(image.displayWidth) || 0,
    displayHeight: Number(image.displayHeight) || 0,
    section: image.section || "",
    widthHint: Number(image.widthHint) || 0,
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
  const dedupeVariants = els.dedupeVariants.checked;
  const hideChrome = els.hideChrome.checked;
  const mainOnly = els.mainContentOnly.checked;

  state.filtered = state.images.filter((image) => {
    if (dedupeVariants && !image.isLargestInGroup) return false;
    if (hideChrome && image.isChrome) return false;
    if (mainOnly && image.isRecommendation) return false;
    const haystack = `${image.url} ${image.alt} ${image.fileName}`.toLowerCase();
    if (query && !haystack.includes(query)) return false;
    // Only apply the size floor when a size is actually known; lazy-loaded
    // photos report 0 x 0 until they decode and were being dropped outright.
    const known = getEquivalentSize(image);
    if (state.minSize && known > 0 && known < state.minSize) return false;
    if (!matchesTypeGroups(image, typeGroups)) return false;
    if (visibleOnly && !image.visible) return false;
    return true;
  });

  sortImages(state.filtered, els.sortMode.value);
  if (state.reverseSort) state.filtered.reverse();
  savePreferences();
  renderGallery();
  updateCounts();
  enrichVisibleMetadata();
}

function sortImages(images, mode) {
  const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });
  const sorts = {
    content: (a, b) =>
      (b.contentScore || 0) - (a.contentScore || 0) ||
      (b.area || 0) - (a.area || 0) ||
      a.order - b.order,
    position: (a, b) => a.pageY - b.pageY || a.pageX - b.pageX || a.order - b.order,
    area: (a, b) => b.area - a.area || b.width - a.width,
    width: (a, b) => b.width - a.width,
    height: (a, b) => b.height - a.height,
    name: (a, b) => collator.compare(a.fileName, b.fileName),
    type: (a, b) => collator.compare(a.type, b.type) || collator.compare(a.fileName, b.fileName)
  };

  images.sort(sorts[mode] || sorts.content);
}

function getSelectedTypeGroups() {
  return els.typeShortcuts.filter((input) => input.checked).map((input) => input.value);
}

function matchesTypeGroups(image, groups) {
  if (!groups.length) return false;
  if (groups.includes(image.type)) return true;
  if (groups.includes("other") && !NAMED_TYPE_GROUPS.includes(image.type)) return true;
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

  thumb.referrerPolicy = "no-referrer";
  thumb.loading = "lazy";
  thumb.alt = image.alt || image.fileName;

  const initialSrc = image.thumbUrl || image.url;
  const fallbackSrc = image.thumbUrl && image.thumbUrl !== image.url ? image.url : (image.originalUrl || "");

  let triedFallback = false;
  thumb.onerror = () => {
    if (!triedFallback && fallbackSrc && thumb.src !== fallbackSrc) {
      triedFallback = true;
      thumb.src = fallbackSrc;
      return;
    }
    node.classList.add("is-broken");
    thumb.style.display = "none";
    if (!previewButton.querySelector(".broken-placeholder")) {
      const brokenEl = document.createElement("div");
      brokenEl.className = "broken-placeholder";
      brokenEl.innerHTML = `
        <svg viewBox="0 0 24 24" aria-hidden="true" width="22" height="22">
          <path d="M21 15l-3.086-3.086a2 2 0 0 0-2.828 0L6 21"></path>
          <path d="M3 3l18 18"></path>
          <circle cx="9" cy="9" r="2"></circle>
          <path d="M19 13V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h8"></path>
        </svg>
        <span>Image unavailable</span>
      `;
      previewButton.appendChild(brokenEl);
    }
  };

  thumb.onload = () => {
    node.classList.remove("is-broken");
    thumb.style.display = "block";
    const brokenEl = previewButton.querySelector(".broken-placeholder");
    if (brokenEl) brokenEl.remove();
  };

  thumb.src = initialSrc;
  title.textContent = image.fileName;
  pill.textContent = image.type || "img";
  meta.textContent = buildMetaLine(image);
  source.textContent = `${image.sources?.join(", ") || image.source} · ${trimUrl(image.url)}`;
  previewButton.addEventListener("click", () => showPreview(image));

  node.querySelector(".copy-url").addEventListener("click", async () => {
    copyUrl(await resolveFullResUrl(image.url, image));
  });
  node.querySelector(".open-url").addEventListener("click", async () => {
    openTab(await resolveFullResUrl(image.url, image));
  });
  node.querySelector(".reverse-search").addEventListener("click", async () => {
    const target = await resolveFullResUrl(image.url, image);
    openTab(`https://lens.google.com/uploadbyurl?url=${encodeURIComponent(target)}`);
  });
  node.querySelector(".download-one").addEventListener("click", () => downloadImages([image], els.downloadFormat.value));

  return node;
}

function buildMetaLine(image) {
  const dimensions = image.width && image.height ? `${image.width} x ${image.height}` : "size unknown";
  const variants = image.groupSize > 1 ? `${image.groupSize} variants` : "";
  // What a download will actually fetch, which is usually larger than the
  // thumbnail the page rendered.
  const best = Math.max(Number(image.fullResSize) || 0, Number(image.largestSize) || 0);
  const downloads = best > Math.max(image.width || 0, image.height || 0) ? `downloads ${best}px` : "";
  return [dimensions, image.sizeLabel, downloads, variants].filter(Boolean).join(" · ");
}

function updateCounts() {
  els.visibleCount.textContent = String(state.filtered.length);
  els.totalCount.textContent = `of ${state.images.length} images`;
  els.selectedCount.textContent = String(state.selected.size);
  els.downloadButton.disabled = state.selected.size === 0;
  els.clearSelectionButton.disabled = state.selected.size === 0;
  els.downloadAllButton.disabled = state.filtered.length === 0;
  els.downloadZipButton.disabled = state.filtered.length === 0;
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
          url: await resolveFullResUrl(image.url, image),
          ...downloadOptions(buildDownloadPath(image, image.type || "image"))
        });
      } else if (format === "auto") {
        await downloadAsJpgOrPng(image);
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

// Gallery listings stay wide open; normalising happens here instead. WEBP,
// AVIF and GIF become JPG or PNG, while files that are already JPG or PNG are
// saved byte-for-byte rather than re-encoded.
// Produces the exact bytes and extension a download should write, without
// writing them. Both the per-file downloads and the ZIP builder go through
// this, so the two can never disagree about conversion rules.
async function resolveDownloadBlob(image, format) {
  // Videos are containers, not stills; never re-encode them.
  if (image.isVideo) {
    return { blob: await fetchImageBlob(image.url), extension: image.type || "mp4" };
  }
  let blob;
  const targetUrl = await resolveFullResUrl(image.url, image);
  try {
    blob = await fetchImageBlob(targetUrl);
  } catch (err) {
    if (targetUrl !== image.url) {
      try {
        blob = await fetchImageBlob(image.url);
      } catch {
        if (image.thumbUrl && image.thumbUrl !== image.url) {
          blob = await fetchImageBlob(image.thumbUrl);
        } else {
          throw err;
        }
      }
    } else if (image.thumbUrl && image.thumbUrl !== image.url) {
      blob = await fetchImageBlob(image.thumbUrl);
    } else {
      throw err;
    }
  }

  const mime = (blob.type || "").toLowerCase().split(";")[0];

  if (format === "original") {
    return { blob, extension: extensionForMime(mime) || image.type || "image" };
  }

  // Flattening an animation to a single frame throws away the whole point of
  // the file, so keep the original bytes instead.
  if (els.keepAnimated.checked && (await isAnimated(blob))) {
    return { blob, extension: extensionForMime(mime) || image.type || "gif" };
  }

  if (format === "auto") {
    if (mime === "image/jpeg" || mime === "image/png") {
      return { blob, extension: mime === "image/jpeg" ? "jpg" : "png" };
    }

    const bitmap = await createImageBitmap(blob);
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(bitmap, 0, 0);
    bitmap.close?.();

    // Transparency decides the target: PNG keeps the alpha channel, JPG is far
    // smaller for photographs, which is what most of these will be.
    if (hasTransparency(ctx, canvas)) {
      return { blob: await canvas.convertToBlob({ type: "image/png" }), extension: "png" };
    }

    return { blob: await canvas.convertToBlob({ type: "image/jpeg", quality: 0.92 }), extension: "jpg" };
  }

  return { blob: await convertBlob(blob, format), extension: format === "jpeg" ? "jpg" : format };
}

async function downloadAsJpgOrPng(image) {
  const { blob, extension } = await resolveDownloadBlob(image, "auto");
  await saveBlob(blob, image, extension);
}

// Multi-frame GIF, animated WEBP and APNG all report a frame count through
// ImageDecoder (Chrome 94+; this extension already requires 116+).
async function isAnimated(blob) {
  const mime = (blob.type || "").toLowerCase().split(";")[0];
  if (!mime || !ANIMATABLE_MIMES.has(mime)) return false;
  if (typeof ImageDecoder === "undefined") return false;

  let decoder;
  try {
    decoder = new ImageDecoder({ data: await blob.arrayBuffer(), type: mime });
    await decoder.tracks.ready;
    await decoder.completed;
    const track = decoder.tracks.selectedTrack;

    // track.animated reports what the *format* supports, so every GIF says
    // true. Frame count is what actually distinguishes a loop from a still.
    const frames = Number(track?.frameCount) || 0;
    if (frames > 0) return frames > 1;
    return Boolean(track?.animated);
  } catch {
    // Undecodable here means the canvas path would fail too; let it convert.
    return false;
  } finally {
    decoder?.close?.();
  }
}

const ANIMATABLE_MIMES = new Set(["image/gif", "image/webp", "image/apng", "image/png", "image/avif"]);

const MIME_EXTENSIONS = new Map([
  ["image/gif", "gif"],
  ["image/webp", "webp"],
  ["image/apng", "apng"],
  ["image/png", "png"],
  ["image/jpeg", "jpg"],
  ["image/avif", "avif"],
  ["video/mp4", "mp4"],
  ["video/webm", "webm"],
  ["video/quicktime", "mov"]
]);

function extensionForMime(mime) {
  return MIME_EXTENSIONS.get(mime) || "";
}

function hasTransparency(ctx, canvas) {
  let data;
  try {
    ({ data } = ctx.getImageData(0, 0, canvas.width, canvas.height));
  } catch {
    // Should not happen for a blob-backed bitmap, but never block a download.
    return false;
  }

  // Corners first: rounded-corner sprites often hide their only alpha there.
  const lastRow = (canvas.height - 1) * canvas.width * 4;
  const corners = [0, (canvas.width - 1) * 4, lastRow, data.length - 4];
  if (corners.some((offset) => data[offset + 3] < 255)) return true;

  // Then a strided sweep. Real transparent regions span many pixels, so
  // sampling every 16th is enough and keeps bulk downloads responsive.
  for (let index = 3; index < data.length; index += 4 * 16) {
    if (data[index] < 255) return true;
  }

  return false;
}

async function saveBlob(blob, image, extension) {
  const objectUrl = URL.createObjectURL(blob);

  try {
    await chrome.downloads.download({
      url: objectUrl,
      ...downloadOptions(buildDownloadPath(image, extension))
    });
  } finally {
    setTimeout(() => URL.revokeObjectURL(objectUrl), 30000);
  }
}

async function downloadConvertedImage(image, format) {
  const { blob, extension } = await resolveDownloadBlob(image, format);
  await saveBlob(blob, image, extension);
}

// --- ZIP writing -------------------------------------------------------------
// Manifest V3 forbids remote scripts and this project has no bundler, so the
// archive is written by hand. Entries are STOREd rather than deflated: JPEG,
// PNG and WEBP payloads are already compressed, so deflate would burn CPU on
// every file for roughly nothing.

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);

  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value >>> 0;
  }

  return table;
})();

function crc32(bytes) {
  let crc = 0xffffffff;
  for (let index = 0; index < bytes.length; index += 1) {
    crc = CRC_TABLE[(crc ^ bytes[index]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

// MS-DOS packed date/time, which is what the ZIP format stores.
function dosDateTime(date) {
  const year = Math.max(1980, date.getFullYear());
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1),
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate()
  };
}

function zipWriter() {
  const parts = [];
  const central = [];
  let offset = 0;

  const push = (bytes) => {
    parts.push(bytes);
    offset += bytes.byteLength;
  };

  return {
    add(name, bytes, date = new Date()) {
      const nameBytes = new TextEncoder().encode(name);
      const { time, date: dosDate } = dosDateTime(date);
      const crc = crc32(bytes);
      const localOffset = offset;

      const header = new DataView(new ArrayBuffer(30));
      header.setUint32(0, 0x04034b50, true); // local file header
      header.setUint16(4, 20, true); // version needed
      header.setUint16(6, 0x0800, true); // UTF-8 filename flag
      header.setUint16(8, 0, true); // STORE, no compression
      header.setUint16(10, time, true);
      header.setUint16(12, dosDate, true);
      header.setUint32(14, crc, true);
      header.setUint32(18, bytes.length, true);
      header.setUint32(22, bytes.length, true);
      header.setUint16(26, nameBytes.length, true);
      header.setUint16(28, 0, true); // no extra field

      push(new Uint8Array(header.buffer));
      push(nameBytes);
      push(bytes);

      const entry = new DataView(new ArrayBuffer(46));
      entry.setUint32(0, 0x02014b50, true); // central directory header
      entry.setUint16(4, 20, true); // version made by
      entry.setUint16(6, 20, true); // version needed
      entry.setUint16(8, 0x0800, true);
      entry.setUint16(10, 0, true);
      entry.setUint16(12, time, true);
      entry.setUint16(14, dosDate, true);
      entry.setUint32(16, crc, true);
      entry.setUint32(20, bytes.length, true);
      entry.setUint32(24, bytes.length, true);
      entry.setUint16(28, nameBytes.length, true);
      entry.setUint32(42, localOffset, true);

      central.push(new Uint8Array(entry.buffer), nameBytes);
    },

    finish() {
      const centralOffset = offset;
      central.forEach(push);
      const centralSize = offset - centralOffset;
      const count = central.length / 2;

      const end = new DataView(new ArrayBuffer(22));
      end.setUint32(0, 0x06054b50, true); // end of central directory
      end.setUint16(8, count, true);
      end.setUint16(10, count, true);
      end.setUint32(12, centralSize, true);
      end.setUint32(16, centralOffset, true);
      push(new Uint8Array(end.buffer));

      return new Blob(parts, { type: "application/zip" });
    },

    get bytesWritten() {
      return offset;
    }
  };
}

// The classic end-of-central-directory record caps entries at 65535 and offsets
// at 4 GB. ZIP64 lifts both but is a lot of format for a gallery grab, so the
// limits are enforced instead of silently writing a corrupt archive.
const ZIP_MAX_ENTRIES = 65535;
const ZIP_MAX_BYTES = 4 * 1024 * 1024 * 1024 - 1;

async function downloadVisibleAsZip() {
  const images = state.filtered;

  if (!images.length) return;
  if (!extensionApi) {
    toast("Load as an unpacked Chrome extension to download.");
    return;
  }
  if (images.length > ZIP_MAX_ENTRIES) {
    toast(`Too many images for one ZIP (${images.length}). Filter down to ${ZIP_MAX_ENTRIES} or fewer.`);
    return;
  }

  const format = els.downloadFormat.value;
  const writer = zipWriter();
  const used = new Set();
  let added = 0;
  let failed = 0;
  let truncated = false;

  els.downloadZipButton.disabled = true;
  toast(`Building ZIP from ${images.length} image${images.length === 1 ? "" : "s"}...`);

  for (const image of images) {
    try {
      const { blob, extension } = await resolveDownloadBlob(image, format);

      if (writer.bytesWritten + blob.size > ZIP_MAX_BYTES) {
        truncated = true;
        break;
      }

      writer.add(uniqueZipName(image, extension, used), new Uint8Array(await blob.arrayBuffer()));
      added += 1;

      if (added % 10 === 0) toast(`Building ZIP... ${added}/${images.length}`);
    } catch (error) {
      console.warn("ZIP entry failed", image.url, error);
      failed += 1;
    }
  }

  if (!added) {
    els.downloadZipButton.disabled = false;
    updateCounts();
    toast("Nothing could be fetched for the ZIP.");
    return;
  }

  const objectUrl = URL.createObjectURL(writer.finish());

  try {
    await chrome.downloads.download({
      url: objectUrl,
      ...downloadOptions(buildZipPath())
    });
  } finally {
    setTimeout(() => URL.revokeObjectURL(objectUrl), 60000);
    els.downloadZipButton.disabled = false;
    updateCounts();
  }

  const notes = [`${added} image${added === 1 ? "" : "s"} zipped`];
  if (failed) notes.push(`${failed} failed`);
  if (truncated) notes.push("stopped at the 4 GB ZIP limit");
  toast(`${notes.join(", ")}.`);
}

// An archive must not carry two members with the same path.
function uniqueZipName(image, extension, used) {
  const base = safeName(stripExtension(image.fileName) || "image");
  const ext = extension === "jpeg" ? "jpg" : extension || "image";
  let name = `${base}.${ext}`;
  let counter = 2;

  while (used.has(name.toLowerCase())) {
    name = `${base} (${counter}).${ext}`;
    counter += 1;
  }

  used.add(name.toLowerCase());
  return name;
}

function buildZipPath() {
  const host = safeName(getHostName(state.tab?.url || "") || "gallery");
  const stamp = new Date().toISOString().slice(0, 10);
  const folder = sanitizeFolder(els.downloadFolder?.value || "");
  const name = `${host}-images-${stamp}.zip`;
  return folder ? `${folder}/${name}` : name;
}

async function fetchImageBlob(url) {
  if (url.startsWith("data:")) {
    const response = await fetch(url);
    return response.blob();
  }

  const response = await fetch(url, { referrerPolicy: "no-referrer", cache: "force-cache" });
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

// Sites hand the browser a thumbnail; the download should be the full frame.
// Every rewrite is verified with a HEAD request before it is used, so an
// unrecognised URL shape can never turn into a broken download.
function buildFullResCandidates(url) {
  const candidates = [];

  try {
    const parsed = new URL(url);
    const host = parsed.hostname;
    const path = parsed.pathname;
    const withPath = (nextPath) => {
      if (!nextPath || nextPath === path) return;
      const next = new URL(parsed.href);
      next.pathname = nextPath;
      candidates.push(next.href);
    };

    if (/(^|\.)zillowstatic\.com$/i.test(host)) {
      // photos.zillowstatic.com/fp/<hash>-cc_ft_384.webp -> full uncropped frame
      const token = /-(?:cc_ft_\d+|p_[a-z]|uncropped_scaled_within_\d+_\d+)(\.[a-z0-9]+)$/i;
      withPath(path.replace(token, "-uncropped_scaled_within_1536_1152$1"));
      withPath(path.replace(token, "-cc_ft_1536$1"));
    } else if (/pinimg\.com$/i.test(host)) {
      withPath(path.replace(/^\/(?:\d{2,4}x\d{0,4})\//, "/originals/"));
    } else if (/(^|\.)rdcpix\.com$/i.test(host)) {
      // realtor.com sizes with a trailing -w###/-m### token; -o is the original.
      withPath(path.replace(/-[a-z]\d+(?:od)?(\.[a-z0-9]+)$/i, "-o$1"));
    } else if (/(^|\.)(?:cdn-redfin\.com|redfin\.com)$/i.test(host)) {
      withPath(path.replace(/\/gen(?:Mid|Small|Head)\./i, "/genDesktop."));
    } else if (/(^|\.)shopify(?:cdn)?\.com$|(^|\.)myshopify\.com$/i.test(host)) {
      withPath(path.replace(/_(?:\d{2,4}x\d{0,4}|\d{2,4}x)(\.[a-z0-9]+)$/i, "$1"));
    }

    // Generic: a size token baked into the filename, or width query params.
    withPath(
      path
        .replace(/[-_]\d{2,4}x\d{2,4}(\.[a-z0-9]{2,5})$/i, "$1")
        .replace(/[-_](?:thumb|thumbnail|small|medium|preview|scaled|resized)(\.[a-z0-9]{2,5})$/i, "$1")
    );

    const sizeParams = ["w", "h", "width", "height", "maxwidth", "maxheight", "size", "sz", "resize"];
    if (sizeParams.some((key) => parsed.searchParams.has(key))) {
      if (!/(^|\.)gstatic\.com$/i.test(host)) {
        const stripped = new URL(parsed.href);
        sizeParams.forEach((key) => stripped.searchParams.delete(key));
        candidates.push(stripped.href);
      }
    }
  } catch {
    return [];
  }

  return candidates.filter((candidate) => candidate !== url);
}

async function resolveFullResUrl(url, image) {
  if (image?.isVideo) return url;
  if (image?.originalUrl) return image.originalUrl;
  if (!els.fullRes?.checked || url.startsWith("data:") || url.startsWith("blob:")) return url;
  if (fullResCache.has(url)) return fullResCache.get(url);

  let resolved = url;

  for (const candidate of buildFullResCandidates(url)) {
    try {
      const response = await fetch(candidate, { method: "HEAD", referrerPolicy: "no-referrer" });
      if (response.ok && (response.headers.get("content-type") || "").startsWith("image/")) {
        resolved = candidate;
        break;
      }
    } catch {
      // Candidate is unreachable; fall through to the next one.
    }
  }

  fullResCache.set(url, resolved);
  return resolved;
}

// Chrome only lets an extension write inside the browser's download folder, so
// this is a subfolder path, never an absolute one. Blank saves to Downloads
// itself. "Ask where to save" opens the OS picker for a real destination.
function buildDownloadPath(image, extension) {
  const base = safeName(stripExtension(image.fileName) || "image");
  const ext = extension === "jpeg" ? "jpg" : extension || "image";
  const folder = sanitizeFolder(els.downloadFolder?.value || "");
  return folder ? `${folder}/${base}.${ext}` : `${base}.${ext}`;
}

function sanitizeFolder(value) {
  return value
    .split(/[\\/]+/)
    .map((segment) =>
      segment
        .replace(/[<>:"|?*\x00-\x1F]/g, "-")
        .replace(/\s+/g, " ")
        .trim()
        .replace(/\.+$/, "")
        .trim()
        .slice(0, 60)
    )
    .filter(Boolean)
    .slice(0, 4)
    .join("/");
}

function downloadOptions(filename) {
  return {
    filename,
    saveAs: Boolean(els.askWhereToSave?.checked),
    conflictAction: "uniquify"
  };
}

async function showPreview(image) {
  els.previewTitle.textContent = image.fileName;
  els.previewImage.referrerPolicy = "no-referrer";
  const initialSrc = image.url || image.thumbUrl;
  els.previewImage.src = initialSrc;
  els.previewImage.alt = image.alt || image.fileName;
  els.previewMeta.textContent = `${buildMetaLine(image)} · ${image.url}`;
  els.previewDialog.showModal();

  let previewFallbackTried = false;
  els.previewImage.onerror = () => {
    if (!previewFallbackTried && image.thumbUrl && els.previewImage.src !== image.thumbUrl) {
      previewFallbackTried = true;
      els.previewImage.src = image.thumbUrl;
    }
  };

  // Show the thumbnail immediately, then swap in the full frame once the
  // upgraded URL has been verified.
  const fullRes = await resolveFullResUrl(image.url, image);
  if (fullRes !== initialSrc && els.previewDialog.open && !previewFallbackTried) {
    els.previewImage.src = fullRes;
    els.previewMeta.textContent = `${buildMetaLine(image)} · ${fullRes}`;
  }
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
  return bestKnownSize(image);
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
  const token = ++state.enrichToken;
  const candidates = state.filtered.slice(0, 80).filter((image) => !image.sizeLabel && !image.enrichTried);

  for (let index = 0; index < candidates.length; index += 8) {
    if (token !== state.enrichToken) return;
    await Promise.allSettled(candidates.slice(index, index + 8).map(enrichOneImage));
  }

  if (token !== state.enrichToken) return;
  renderGallery();
}

async function enrichOneImage(image) {
  image.enrichTried = true;

  if (image.url.startsWith("data:")) {
    const [meta, data = ""] = image.url.split(",");
    image.type = mimeToType(meta.match(/data:([^;]+)/)?.[1]) || image.type;
    const bytes = Math.ceil((data.length * 3) / 4);
    image.sizeBytes = bytes;
    image.sizeLabel = formatBytes(bytes);
    return;
  }

  const target = await resolveFullResUrl(image.url, image);
  image.fullResUrl = target;
  image.fullResSize = urlSizeHint(target);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 2500);

  try {
    const response = await fetch(target, {
      method: "HEAD",
      referrerPolicy: "no-referrer",
      signal: controller.signal
    });

    const mimeType = response.headers.get("content-type");
    const length = Number(response.headers.get("content-length"));
    image.type = mimeToType(mimeType) || image.type;
    if (Number.isFinite(length) && length > 0) {
      image.sizeBytes = length;
      image.sizeLabel = formatBytes(length);
    }
  } catch {
    // Network/CORS failures leave sizeLabel empty; UI still shows pixel dimensions.
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
    type: getMediaType(image.url, image.source),
    isVideo: isVideoUrl(image.url, image.source),
    urlSizeHint: urlSizeHint(image.url),
    area: image.width * image.height,
    sizeLabel: "",
    sizeBytes: 0
  }));
  state.images = scoreImages(assignVariantGroups(state.images));
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

function getFileName(url, index, alt = "") {
  if (url.startsWith("data:")) {
    const ext = getImageType(url) || "jpg";
    if (alt) return `${safeName(alt)}.${ext}`;
    return `inline-image-${index + 1}.${ext}`;
  }

  try {
    const parsed = new URL(url);
    const last = decodeURIComponent(parsed.pathname.split("/").filter(Boolean).pop() || "");
    let clean = last.replace(/[?#].*$/, "");
    const ext = getImageType(url) || "jpg";

    const isGeneric = !clean || /^(?:images?|photos?|pics?|media|view|thumb(?:nail)?|fetch|get)$/i.test(clean) || !/\.[a-z0-9]{2,5}$/i.test(clean);

    if (isGeneric && alt) {
      return `${safeName(alt)}.${ext}`;
    }

    if (!/\.[a-z0-9]{2,5}$/i.test(clean)) {
      clean = `${clean || `image-${index + 1}`}.${ext}`;
    }

    return clean || `image-${index + 1}.${ext}`;
  } catch {
    return `image-${index + 1}.jpg`;
  }
}

function isVideoUrl(url, source) {
  if (source === "video") return true;

  try {
    const ext = new URL(url).pathname.match(/\.([a-z0-9]{2,5})$/i)?.[1]?.toLowerCase();
    return Boolean(ext && VIDEO_TYPES.has(ext));
  } catch {
    return false;
  }
}

function getMediaType(url, source) {
  if (isVideoUrl(url, source)) {
    try {
      const ext = new URL(url).pathname.match(/\.([a-z0-9]{2,5})$/i)?.[1]?.toLowerCase();
      return VIDEO_TYPES.get(ext) || "mp4";
    } catch {
      return "mp4";
    }
  }

  return getImageType(url);
}

function getImageType(url) {
  if (url.startsWith("data:")) {
    return mimeToType(url.match(/^data:([^;,]+)/)?.[1]) || "data";
  }

  try {
    const parsed = new URL(url);
    if (/(^|\.)gstatic\.com$/i.test(parsed.hostname)) {
      return "jpeg";
    }
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

