import { integrateWithDeepSeek } from "./deepseek";
import type { CodePenMeta, PenPageSource, SavedPen } from "./types";

const rawExtensions = ["html", "css", "js"] as const;

export type EnrichOptions = {
  deepseekApiKey?: string;
  prefetched?: PenPageSource | null;
};

export function parseCodePenUrl(url: string): Pick<CodePenMeta, "user" | "slug" | "canonicalUrl"> | null {
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

export async function enrichCodePen(meta: CodePenMeta, options: EnrichOptions = {}): Promise<SavedPen> {
  const oembed = await fetchOembed(meta.canonicalUrl);
  const enrichedMeta: CodePenMeta = {
    ...meta,
    author: meta.author || oembed?.author_name || meta.user,
    thumbnailUrl:
      meta.thumbnailUrl ||
      oembed?.thumbnail_url ||
      `https://codepen.io/${meta.user}/pen/${meta.slug}/image/small.png`,
    title: tidyTitle(meta.title || oembed?.title || "Untitled Pen", oembed?.author_name)
  };

  const prefetchedDebug = sanitizeFetched(options.prefetched?.debugHtml);
  const debugHtml = prefetchedDebug || (await fetchDebugHtml(enrichedMeta));
  let sourceMode: SavedPen["sourceMode"] = "debug-html";
  let html = debugHtml ? normalizeDebugHtml(enrichedMeta, debugHtml) : "";

  if (!html) {
    const raw = await collectRawSource(enrichedMeta, options.prefetched);
    const apiKey = options.deepseekApiKey?.trim() || "";

    const aiHtml = raw.hasAnyCode && apiKey
      ? await integrateWithDeepSeek({
          meta: enrichedMeta,
          html: raw.html,
          css: raw.css,
          js: raw.js,
          apiKey
        })
      : null;

    if (aiHtml) {
      sourceMode = "ai-integrated";
      html = annotateStandaloneHtml(enrichedMeta, ensureDoctype(aiHtml));
    } else if (raw.hasAnyCode) {
      sourceMode = "raw-files";
      html = composeStandaloneHtml(enrichedMeta, raw.html, raw.css, raw.js);
    } else {
      sourceMode = "page-html";
      html = composeLivePreviewHtml(enrichedMeta);
    }
  }

  const filename = createFilename(enrichedMeta);
  const savedAt = new Date().toISOString();

  return {
    ...enrichedMeta,
    filename,
    html,
    id: `${enrichedMeta.user}/${enrichedMeta.slug}`,
    savedAt,
    sourceMode,
    tags: sourceMode === "ai-integrated" ? ["ai-integrated"] : []
  };
}

type RawSource = Record<(typeof rawExtensions)[number], string> & { hasAnyCode: boolean };

async function collectRawSource(meta: CodePenMeta, prefetched?: PenPageSource | null): Promise<RawSource> {
  const fromPage: RawSource = {
    html: sanitizeFetched(prefetched?.html),
    css: sanitizeFetched(prefetched?.css),
    js: sanitizeFetched(prefetched?.js),
    hasAnyCode: false
  };
  fromPage.hasAnyCode = rawExtensions.some((extension) => fromPage[extension].trim().length > 0);
  if (fromPage.hasAnyCode) {
    return fromPage;
  }

  return fetchRawFiles(meta);
}

function sanitizeFetched(value: string | undefined | null): string {
  if (!value) {
    return "";
  }
  if (looksLikeUnavailableResponse(value)) {
    return "";
  }
  return value;
}

async function fetchRawFiles(meta: CodePenMeta): Promise<RawSource> {
  const entries = await Promise.all(
    rawExtensions.map(async (extension) => {
      const url = `${meta.canonicalUrl}.${extension}`;
      try {
        const response = await fetch(url, { credentials: "include" });
        if (!response.ok) {
          return [extension, ""] as const;
        }

        const text = await response.text();
        if (looksLikeUnavailableResponse(text)) {
          return [extension, ""] as const;
        }

        return [extension, text] as const;
      } catch {
        return [extension, ""] as const;
      }
    })
  );

  const files = Object.fromEntries(entries) as Record<(typeof rawExtensions)[number], string>;
  return {
    ...files,
    hasAnyCode: rawExtensions.some((extension) => files[extension].trim().length > 0)
  };
}

async function fetchDebugHtml(meta: CodePenMeta): Promise<string | null> {
  const debugUrls = [
    `https://codepen.io/${meta.user}/debug/${meta.slug}`,
    `https://cdpn.io/${meta.user}/debug/${meta.slug}`
  ];

  for (const url of debugUrls) {
    try {
      const response = await fetch(url, { credentials: "include" });
      if (!response.ok) {
        continue;
      }

      const html = await response.text();
      if (html.trim() && !looksLikeUnavailableResponse(html)) {
        return html;
      }
    } catch {
      continue;
    }
  }

  return null;
}

async function fetchOembed(url: string): Promise<Record<string, string> | null> {
  try {
    const endpoint = `https://codepen.io/api/oembed?format=json&url=${encodeURIComponent(url)}`;
    const response = await fetch(endpoint, { credentials: "include" });
    if (!response.ok) {
      return null;
    }

    return (await response.json()) as Record<string, string>;
  } catch {
    return null;
  }
}

function composeStandaloneHtml(meta: CodePenMeta, bodyHtml: string, css: string, js: string): string {
  const scriptType = looksLikeModuleScript(js) ? ` type="module"` : "";
  const styleBlock = css.trim()
    ? `<style>\n${css.trim()}\n</style>`
    : "";
  const scriptBlock = js.trim()
    ? `<script${scriptType}>\n${escapeClosingScript(js.trim())}\n</script>`
    : "";

  if (/<html[\s>]/i.test(bodyHtml)) {
    return annotateStandaloneHtml(meta, injectIntoDocument(bodyHtml, styleBlock, scriptBlock));
  }

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(meta.title)}</title>
  <meta name="generator" content="CodePen Library Saver">
  <meta name="codepen:source" content="${escapeHtml(meta.canonicalUrl)}">
  <style>
    html, body {
      min-height: 100%;
    }
  </style>
${indent(styleBlock)}
</head>
<body>
${bodyHtml.trim()}
${scriptBlock}
</body>
</html>`;
}

function composeSeparatedSourceHtml(
  meta: CodePenMeta,
  bodyHtml: string,
  css: string,
  js: string,
  fetchBlocked = false
): string {
  const scriptType = looksLikeModuleScript(js) ? ` type="module"` : "";
  const htmlSource = bodyHtml.trim() || "<!-- HTML box was empty or could not be fetched. -->";
  const cssSource = css.trim() || "/* CSS box was empty or could not be fetched. */";
  const jsSource = js.trim() || "// JS box was empty or could not be fetched.";
  const safeUrl = escapeHtml(meta.canonicalUrl);
  const blockedBanner = fetchBlocked
    ? `
  <!-- ===== FETCH BLOCKED NOTICE ===== -->
  <section style="margin:0 0 20px;padding:14px 16px;border-radius:8px;background:#fff3cd;border:1px solid #ffe69c;color:#664d03;font:14px/1.5 system-ui,sans-serif;">
    <strong>CodePen blocked an automated fetch for this Pen.</strong><br>
    The HTML, CSS, and JS sections below are empty placeholders. Open the
    <a href="${safeUrl}" target="_blank" rel="noopener" style="color:#664d03;text-decoration:underline;">original Pen</a>
    and paste each editor's source into the matching section.
  </section>`
    : "";

  return `<!doctype html>
<!--
  Saved from ${safeUrl} with CodePen Library Saver.
  Source mode: uncombined (3 snippets pieced together).
  This file preserves the CodePen HTML, CSS, and JS boxes as separate sections
  so they can be manually refactored later.
  Original Pen: ${safeUrl}
-->
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(meta.title)}</title>
  <meta name="generator" content="CodePen Library Saver">
  <meta name="codepen:source" content="${safeUrl}">
  <meta name="codepen:source-mode" content="uncombined">
  <!-- ===== CODEPEN CSS BOX START ===== -->
  <style>
${cssSource}
  </style>
  <!-- ===== CODEPEN CSS BOX END ===== -->
</head>
<body>${blockedBanner}
  <!-- ===== CODEPEN HTML BOX START ===== -->
${htmlSource}
  <!-- ===== CODEPEN HTML BOX END ===== -->

  <!-- ===== CODEPEN JS BOX START ===== -->
  <script${scriptType}>
${escapeClosingScript(jsSource)}
  </script>
  <!-- ===== CODEPEN JS BOX END ===== -->

  <!-- ===== ORIGINAL CODEPEN LINK ===== -->
  <footer style="position:fixed;bottom:8px;right:8px;font:12px/1.4 system-ui,sans-serif;background:rgba(0,0,0,0.65);color:#fff;padding:6px 10px;border-radius:6px;z-index:2147483647;pointer-events:auto;">
    Source: <a href="${safeUrl}" target="_blank" rel="noopener" style="color:#9bd1ff;">${safeUrl}</a>
  </footer>
</body>
</html>`;
}

function composeLivePreviewHtml(meta: CodePenMeta): string {
  const safeTitle = escapeHtml(meta.title);
  const safeUrl = escapeHtml(meta.canonicalUrl);
  const previewUrl = escapeHtml(`https://codepen.io/${meta.user}/embed/${meta.slug}?default-tab=result&theme-id=light`);

  return `<!doctype html>
<!-- Saved from ${safeUrl} with CodePen Library Saver. Source fetch was blocked, so this file opens the live CodePen preview. -->
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${safeTitle}</title>
  <meta name="generator" content="CodePen Library Saver">
  <meta name="codepen:source" content="${safeUrl}">
  <meta name="codepen:source-mode" content="live-preview">
  <style>
    html,
    body {
      width: 100%;
      height: 100%;
      margin: 0;
      background: #ffffff;
    }

    iframe {
      display: block;
      width: 100%;
      height: 100%;
      border: 0;
    }
  </style>
</head>
<body>
  <iframe title="${safeTitle} live CodePen preview" src="${previewUrl}" allow="accelerometer; camera; encrypted-media; geolocation; gyroscope; microphone; midi; clipboard-read; clipboard-write; web-share"></iframe>
</body>
</html>`;
}

function ensureDoctype(html: string): string {
  return /^\s*<!doctype/i.test(html) ? html.trim() : `<!doctype html>\n${html.trim()}`;
}

function normalizeDebugHtml(meta: CodePenMeta, html: string): string {
  let output = html.trim();
  if (!output || looksLikeUnavailableResponse(output)) {
    return "";
  }

  if (!/^<!doctype/i.test(output)) {
    output = `<!doctype html>\n${output}`;
  }

  output = /<meta\s+name=["']codepen:source["']/i.test(output)
    ? output
    : output.replace(/<head([^>]*)>/i, `<head$1>\n  <meta name="generator" content="CodePen Library Saver">\n  <meta name="codepen:source" content="${escapeHtml(meta.canonicalUrl)}">`);

  return annotateStandaloneHtml(meta, output);
}

function injectIntoDocument(html: string, styleBlock: string, scriptBlock: string): string {
  let output = html;

  if (styleBlock) {
    output = /<\/head>/i.test(output)
      ? output.replace(/<\/head>/i, `${styleBlock}\n</head>`)
      : `${styleBlock}\n${output}`;
  }

  if (scriptBlock) {
    output = /<\/body>/i.test(output)
      ? output.replace(/<\/body>/i, `${scriptBlock}\n</body>`)
      : `${output}\n${scriptBlock}`;
  }

  return output;
}

function annotateStandaloneHtml(meta: CodePenMeta, html: string): string {
  const note = `<!-- Saved from ${meta.canonicalUrl} with CodePen Library Saver. -->`;
  return html.trim().startsWith("<!doctype") ? html.replace(/(\r?\n)/, `$1${note}$1`) : `${note}\n${html}`;
}

function createFilename(meta: CodePenMeta): string {
  const base = `${meta.title}-${meta.author || meta.user}-${meta.slug}`
    .toLowerCase()
    .replace(/&amp;/g, "and")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 90);

  return `${base || `codepen-${meta.slug}`}.html`;
}

function tidyTitle(title: string, author?: string): string {
  const cleaned = title.replace(/\s+-\s+A Pen by .+$/i, "").trim();
  if (cleaned) {
    return cleaned;
  }

  return author ? `Pen by ${author}` : "Untitled Pen";
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escapeClosingScript(value: string): string {
  return value.replace(/<\/script/gi, "<\\/script");
}

function looksLikeUnavailableResponse(value: string): boolean {
  const normalized = value.trim().slice(0, 500).toLowerCase();
  return (
    (normalized.includes("login") && normalized.includes("codepen") && normalized.includes("<html")) ||
    normalized.includes("pen not found or not available as a resource") ||
    normalized.includes("this pen is not available") ||
    normalized.includes("just a moment") ||
    normalized.includes("enable javascript and cookies to continue") ||
    normalized.includes("challenge-platform") ||
    normalized.includes("cf_chl_") ||
    normalized.includes("attention required! | cloudflare")
  );
}

function looksLikeModuleScript(value: string): boolean {
  return /^\s*import\s/m.test(value) || /^\s*export\s/m.test(value) || /\bimport\s*\(/.test(value);
}

function indent(value: string): string {
  return value
    .split("\n")
    .map((line) => (line ? `  ${line}` : line))
    .join("\n");
}
