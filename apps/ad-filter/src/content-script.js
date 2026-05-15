const SELECTORS = [
  "ins.adsbygoogle",
  ".adsbygoogle",
  "[data-ad-client]",
  "[data-ad-slot]",
  "[data-google-query-id]",
  "[id^='google_ads']",
  "[id^='div-gpt-ad']",
  "[class*='ad-container']",
  "[class*='ad_banner']",
  "[class*='ad-slot']",
  "[class*='sponsored']",
  "[aria-label='Ads']",
  "[aria-label='Sponsored']"
];

const seen = new WeakSet();
const hiddenClass = "smart-ad-filter-hidden";

installStyle();
scan();

const observer = new MutationObserver(() => {
  window.requestIdleCallback ? window.requestIdleCallback(scan) : window.setTimeout(scan, 150);
});

observer.observe(document.documentElement, {
  childList: true,
  subtree: true
});

function scan() {
  for (const selector of SELECTORS) {
    for (const element of document.querySelectorAll(selector)) {
      hideAndLog(element, selector);
    }
  }

  scanSponsoredText();
}

function scanSponsoredText() {
  const candidates = document.querySelectorAll("a, span, div");

  for (const candidate of candidates) {
    if (seen.has(candidate)) {
      continue;
    }

    const text = candidate.textContent?.trim();
    if (!text || !/^(ad|ads|sponsored|promoted)$/i.test(text)) {
      continue;
    }

    const container = candidate.closest("article, li, div, section") || candidate;
    if (container && container !== document.body) {
      hideAndLog(container, "sponsored-label");
    }
  }
}

function hideAndLog(element, selector) {
  if (seen.has(element) || element.closest(`.${hiddenClass}`)) {
    return;
  }

  seen.add(element);

  const link = element.matches("a") ? element : element.querySelector("a[href]");
  const image = element.matches("img") ? element : element.querySelector("img[src], img[srcset], source[srcset]");
  const adUrl = link?.href || "";
  const text = element.innerText?.replace(/\s+/g, " ").trim().slice(0, 220) || "";
  const imageUrl = getImageUrl(image);

  element.classList.add(hiddenClass);

  chrome.runtime.sendMessage({
    type: "LOG_AD_EVENT",
    payload: {
      source: "cosmetic",
      adUrl,
      pageUrl: location.href,
      pageTitle: document.title,
      resourceType: "dom",
      status: "unseen",
      tags: [selector],
      notes: text,
      snapshot: {
        capturedAt: new Date().toISOString(),
        selector,
        text,
        html: sanitizeHtml(element),
        linkUrl: adUrl,
        imageUrl
      }
    }
  });
}

function installStyle() {
  const style = document.createElement("style");
  style.textContent = `
    .${hiddenClass} {
      display: none !important;
      visibility: hidden !important;
    }
  `;
  document.documentElement.appendChild(style);
}

function getImageUrl(image) {
  if (!image) {
    return "";
  }

  if (image.currentSrc) {
    return image.currentSrc;
  }

  if (image.src) {
    return image.src;
  }

  const srcset = image.getAttribute("srcset") || "";
  return srcset.split(",")[0]?.trim().split(/\s+/)[0] || "";
}

function sanitizeHtml(element) {
  const clone = element.cloneNode(true);

  for (const node of clone.querySelectorAll("script, style, iframe, object, embed")) {
    node.remove();
  }

  for (const node of clone.querySelectorAll("*")) {
    for (const attribute of [...node.attributes]) {
      if (/^on/i.test(attribute.name)) {
        node.removeAttribute(attribute.name);
      }
    }
  }

  return clone.outerHTML.replace(/\s+/g, " ").trim().slice(0, 4000);
}
