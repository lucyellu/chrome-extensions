import type { CodePenMeta, PenPageSource, RuntimeRequest, RuntimeResponse } from "./types";

declare const chrome: {
  runtime: {
    onMessage: {
      addListener(
        callback: (
          message: RuntimeRequest,
          sender: unknown,
          sendResponse: (response: RuntimeResponse) => void
        ) => boolean | void
      ): void;
    };
  };
};

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === "COLLECT_CODEPEN_PAGE") {
    const meta = collectMeta();
    if (!meta) {
      sendResponse({ ok: false, error: "This page is not a CodePen Pen." });
      return false;
    }

    sendResponse({ ok: true, meta });
    return false;
  }

  if (message.type === "FETCH_PEN_SOURCE") {
    void fetchPenSource(message.user, message.slug).then((source) => {
      sendResponse({ ok: true, source });
    });
    return true;
  }

  return false;
});

async function fetchPenSource(user: string, slug: string): Promise<PenPageSource> {
  const base = `https://codepen.io/${user}/pen/${slug}`;
  const debugUrl = `https://codepen.io/${user}/debug/${slug}`;

  const [debugHtml, html, css, js] = await Promise.all([
    safeFetch(debugUrl),
    safeFetch(`${base}.html`),
    safeFetch(`${base}.css`),
    safeFetch(`${base}.js`)
  ]);

  return {
    debugHtml: debugHtml || "",
    html: html || "",
    css: css || "",
    js: js || ""
  };
}

async function safeFetch(url: string): Promise<string> {
  try {
    const response = await fetch(url, { credentials: "include" });
    if (!response.ok) {
      return "";
    }
    return await response.text();
  } catch {
    return "";
  }
}

function collectMeta(): CodePenMeta | null {
  const canonicalUrl =
    getLink("canonical") ||
    getMeta("og:url") ||
    window.location.href;
  const parsed = parseCodePenUrl(canonicalUrl) || parseCodePenUrl(window.location.href);

  if (!parsed) {
    return null;
  }

  return {
    ...parsed,
    author: readAuthor(),
    canonicalUrl: parsed.canonicalUrl,
    thumbnailUrl:
      getMeta("og:image") ||
      `https://codepen.io/${parsed.user}/pen/${parsed.slug}/image/small.png`,
    title:
      getMeta("og:title") ||
      document.querySelector<HTMLHeadingElement>("h1")?.innerText.trim() ||
      document.title.replace(/\s+-\s+CodePen$/i, "").trim() ||
      "Untitled Pen"
  };
}

function parseCodePenUrl(url: string): Pick<CodePenMeta, "user" | "slug" | "canonicalUrl"> | null {
  const normalizedUrl = new URL(url);
  const path = normalizedUrl.pathname.replace(/\/+$/, "");

  const directMatch = path.match(
    /^\/([^/]+)\/(?:pen|full|debug|details)\/([A-Za-z0-9_-]+)(?:\/.*)?$/
  );

  if (directMatch) {
    const [, user, slug] = directMatch;
    return {
      user,
      slug,
      canonicalUrl: `https://codepen.io/${user}/pen/${slug}`
    };
  }

  const embedMatch = path.match(
    /^\/([^/]+)\/embed\/(?:preview|result|pen)?\/?([A-Za-z0-9_-]+)(?:\/.*)?$/
  );

  if (embedMatch) {
    const [, user, slug] = embedMatch;
    return {
      user,
      slug,
      canonicalUrl: `https://codepen.io/${user}/pen/${slug}`
    };
  }

  return null;
}

function getMeta(property: string): string {
  const selector = `meta[property="${property}"], meta[name="${property}"]`;
  return document.querySelector<HTMLMetaElement>(selector)?.content.trim() || "";
}

function getLink(rel: string): string {
  return document.querySelector<HTMLLinkElement>(`link[rel="${rel}"]`)?.href || "";
}

function readAuthor(): string {
  const authorMeta = getMeta("author") || getMeta("twitter:creator");
  if (authorMeta) {
    return authorMeta.replace(/^@/, "");
  }

  const penByline = document.querySelector<HTMLElement>("[rel='author'], .pen-owner-link, .by-line a");
  return penByline?.innerText.trim() || "";
}
