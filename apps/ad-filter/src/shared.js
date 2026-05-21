export function downloadText(text, filename, type) {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);

  chrome.downloads.download({
    url,
    filename,
    saveAs: true
  }, () => {
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
}

export function safeUrlLabel(value) {
  if (!value) {
    return "No URL captured";
  }

  try {
    const url = new URL(value);
    return `${url.hostname}${url.pathname}`.slice(0, 96);
  } catch {
    return value.slice(0, 96);
  }
}

