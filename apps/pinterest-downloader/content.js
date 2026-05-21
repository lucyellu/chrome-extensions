const BTN_CLASS = "__pin-dl-btn";
const HOST_CLASS = "__pin-dl-host";
const ICON_DOWNLOAD = `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12"/><path d="M7 10l5 5 5-5"/><path d="M5 21h14"/></svg>`;
const ICON_SPINNER = `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"><circle cx="12" cy="12" r="9" stroke-opacity=".25"/><path d="M21 12a9 9 0 0 0-9-9"><animateTransform attributeName="transform" type="rotate" from="0 12 12" to="360 12 12" dur="0.9s" repeatCount="indefinite"/></path></svg>`;
const ICON_CHECK = `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>`;
const ICON_ERROR = `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v6"/><path d="M12 16.5v.5"/></svg>`;

document.addEventListener("mouseover", onHover, { passive: true });

function onHover(event) {
  const target = event.target;
  if (!(target instanceof Element)) return;
  const video = target.closest("video");
  const img = target.closest('img[src*="pinimg.com"], img[srcset*="pinimg.com"]');
  const media = video || img;
  if (!media) return;

  const host = findHost(media);
  if (!host || host.querySelector(`.${BTN_CLASS}`)) return;

  host.classList.add(HOST_CLASS);
  host.appendChild(buildButton(media));
}

function findHost(media) {
  const known = media.closest(
    '[data-test-id="pinrep-image"], [data-test-id="pin"], [data-test-id="pinWrapper"], [data-test-id="storyPinPage"], [data-test-id="visual-content-container"]'
  );
  if (known) return known;
  let node = media.parentElement;
  for (let i = 0; node && i < 4; i++, node = node.parentElement) {
    if (node.offsetWidth >= 120 && node.offsetHeight >= 120) return node;
  }
  return media.parentElement;
}

function buildButton(media) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = BTN_CLASS;
  btn.title = "Download best version";
  btn.setAttribute("aria-label", "Download best version");
  btn.innerHTML = ICON_DOWNLOAD;
  btn.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    handleDownload(btn, media);
  });
  btn.addEventListener("mousedown", (event) => event.stopPropagation());
  btn.addEventListener("pointerdown", (event) => event.stopPropagation());
  return btn;
}

async function handleDownload(btn, media) {
  if (btn.dataset.busy === "1") return;
  btn.dataset.busy = "1";
  setState(btn, "working", ICON_SPINNER, "Downloading…");

  try {
    const job = media.tagName === "VIDEO" ? buildVideoJob(media) : buildImageJob(media);
    if (!job) throw new Error("Could not determine a download URL for this pin.");

    const response = await chrome.runtime.sendMessage({ type: "DOWNLOAD_PIN", ...job });
    if (!response || !response.ok) {
      throw new Error((response && response.error) || "Download failed.");
    }

    setState(btn, "success", ICON_CHECK, "Saved");
    window.setTimeout(() => resetButton(btn), 1500);
  } catch (err) {
    setState(btn, "error", ICON_ERROR, err && err.message ? err.message : String(err));
    window.setTimeout(() => resetButton(btn), 2800);
  }
}

function setState(btn, state, icon, title) {
  btn.classList.remove("working", "success", "error");
  btn.classList.add(state);
  btn.innerHTML = icon;
  btn.title = title;
}

function resetButton(btn) {
  btn.dataset.busy = "";
  btn.classList.remove("working", "success", "error");
  btn.innerHTML = ICON_DOWNLOAD;
  btn.title = "Download best version";
}

function buildImageJob(img) {
  const candidates = imageCandidates(img);
  if (!candidates.length) return null;
  const filename = filenameFor(candidates[0], "jpg");
  return { kind: "image", candidates, filename };
}

function imageCandidates(img) {
  const collected = new Set();
  if (img.srcset) {
    for (const part of img.srcset.split(",")) {
      const url = part.trim().split(/\s+/)[0];
      if (url) collected.add(url);
    }
  }
  if (img.currentSrc) collected.add(img.currentSrc);
  if (img.src) collected.add(img.src);

  const sized = Array.from(collected)
    .filter((url) => /pinimg\.com/.test(url))
    .map((url) => ({ url, size: extractSize(url) }))
    .sort((a, b) => b.size - a.size);

  if (!sized.length) return [];

  const top = sized[0].url;
  const originals = top.replace(/\/\d+x\d*\//, "/originals/");
  const candidates = [];
  const seen = new Set();
  const push = (url) => {
    if (url && !seen.has(url)) {
      seen.add(url);
      candidates.push(url);
    }
  };

  push(originals);
  const base = originals.replace(/\.(jpe?g|png|gif|webp)$/i, "");
  if (base !== originals) {
    for (const ext of ["png", "jpg", "gif", "webp"]) push(`${base}.${ext}`);
  }
  for (const { url } of sized) push(url);
  return candidates;
}

function extractSize(url) {
  const m = url.match(/\/(\d+)x\d*\//);
  return m ? parseInt(m[1], 10) : 0;
}

function buildVideoJob(video) {
  const url = pickVideoUrl(video);
  if (!url) return null;
  if (url.startsWith("blob:")) {
    throw new Error("This video is streamed (HLS) — no direct file to download.");
  }
  return { kind: "video", candidates: [url], filename: filenameFor(url, "mp4") };
}

function pickVideoUrl(video) {
  if (video.currentSrc && !video.currentSrc.startsWith("blob:")) return video.currentSrc;
  if (video.src && !video.src.startsWith("blob:")) return video.src;
  const sources = video.querySelectorAll("source[src]");
  let best = "";
  let bestRes = -1;
  for (const source of sources) {
    const src = source.getAttribute("src") || "";
    if (!src || src.startsWith("blob:")) continue;
    const res = parseInt((source.getAttribute("data-res") || source.getAttribute("res") || "0"), 10) || 0;
    if (res > bestRes) {
      bestRes = res;
      best = src;
    }
  }
  if (best) return best;
  return video.currentSrc || video.src || "";
}

function filenameFor(url, fallbackExt) {
  let name = "";
  try {
    const parsed = new URL(url, location.href);
    name = parsed.pathname.split("/").pop() || "";
  } catch {
    name = url.split("?")[0].split("/").pop() || "";
  }
  if (!name || !/\.[a-z0-9]{2,5}$/i.test(name)) {
    name = `pinterest-${Date.now()}.${fallbackExt}`;
  }
  return `Pinterest/${sanitize(name)}`;
}

function sanitize(name) {
  return name.replace(/[<>:"|?*\\/]+/g, "_").trim() || `pinterest-${Date.now()}`;
}
