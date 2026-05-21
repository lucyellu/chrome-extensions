chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message && message.type === "DOWNLOAD_PIN") {
    handleDownload(message)
      .then(sendResponse)
      .catch((err) => sendResponse({ ok: false, error: err && err.message ? err.message : String(err) }));
    return true;
  }
  return false;
});

async function handleDownload({ candidates, filename }) {
  if (!Array.isArray(candidates) || !candidates.length) {
    return { ok: false, error: "No candidate URLs provided." };
  }

  const errors = [];
  for (const url of candidates) {
    const probe = await probeUrl(url);
    if (!probe.ok) {
      errors.push(`${shortUrl(url)} → ${probe.error}`);
      continue;
    }

    try {
      const downloadId = await startDownload(url, finalFilename(filename, probe.contentType, url));
      return { ok: true, downloadId, url };
    } catch (err) {
      errors.push(`${shortUrl(url)} → ${err.message || err}`);
    }
  }

  return { ok: false, error: errors[errors.length - 1] || "No candidate URL was downloadable." };
}

async function probeUrl(url) {
  try {
    const headResponse = await fetch(url, { method: "HEAD", credentials: "omit" });
    if (headResponse.ok) {
      return { ok: true, contentType: headResponse.headers.get("Content-Type") || "" };
    }
    if (headResponse.status === 405 || headResponse.status === 403) {
      const rangeResponse = await fetch(url, {
        method: "GET",
        credentials: "omit",
        headers: { Range: "bytes=0-0" }
      });
      if (rangeResponse.ok || rangeResponse.status === 206) {
        return { ok: true, contentType: rangeResponse.headers.get("Content-Type") || "" };
      }
      return { ok: false, error: `HTTP ${rangeResponse.status}` };
    }
    return { ok: false, error: `HTTP ${headResponse.status}` };
  } catch (err) {
    return { ok: false, error: err.message || "fetch failed" };
  }
}

function startDownload(url, filename) {
  return new Promise((resolve, reject) => {
    chrome.downloads.download({ url, filename, conflictAction: "uniquify" }, (id) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve(id);
    });
  });
}

function finalFilename(filename, contentType, url) {
  const expected = extensionFromContentType(contentType) || extensionFromUrl(url);
  if (!expected) return filename;
  if (filename.toLowerCase().endsWith(`.${expected}`)) return filename;
  return filename.replace(/\.[a-z0-9]{2,5}$/i, "") + `.${expected}`;
}

function extensionFromContentType(contentType) {
  if (!contentType) return "";
  const ct = contentType.split(";")[0].trim().toLowerCase();
  const map = {
    "image/jpeg": "jpg",
    "image/jpg": "jpg",
    "image/png": "png",
    "image/gif": "gif",
    "image/webp": "webp",
    "image/avif": "avif",
    "video/mp4": "mp4",
    "video/quicktime": "mov",
    "video/webm": "webm"
  };
  return map[ct] || "";
}

function extensionFromUrl(url) {
  try {
    const parsed = new URL(url);
    const m = parsed.pathname.match(/\.([a-z0-9]{2,5})$/i);
    return m ? m[1].toLowerCase() : "";
  } catch {
    return "";
  }
}

function shortUrl(url) {
  if (url.length <= 80) return url;
  return `${url.slice(0, 60)}…${url.slice(-15)}`;
}
