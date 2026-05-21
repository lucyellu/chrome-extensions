import type { CodePenMeta } from "./types";

type DeepSeekInput = {
  meta: CodePenMeta;
  html: string;
  css: string;
  js: string;
  apiKey: string;
};

const endpoint = "https://api.deepseek.com/v1/chat/completions";
const model = "deepseek-chat";
const timeoutMs = 60_000;

export async function integrateWithDeepSeek({ meta, html, css, js, apiKey }: DeepSeekInput): Promise<string | null> {
  if (!apiKey.trim()) {
    return null;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey.trim()}`
      },
      body: JSON.stringify({
        model,
        temperature: 0.2,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: buildUserPrompt(meta, html, css, js) }
        ]
      }),
      signal: controller.signal
    });

    if (!response.ok) {
      return null;
    }

    const payload = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };

    const raw = payload?.choices?.[0]?.message?.content ?? "";
    const cleaned = stripFences(raw);
    if (!cleaned || !/<html[\s>]/i.test(cleaned)) {
      return null;
    }

    return cleaned;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

const systemPrompt = `You are a senior front-end engineer. Your job is to take three CodePen editor boxes (HTML, CSS, JS) and emit a single self-contained HTML document that renders the same result as the original Pen when opened directly from disk.

Rules:
- Output a complete <!doctype html> document. No prose, no markdown fences, no commentary.
- Inline the CSS in a <style> block in <head>.
- Inline the JS in a <script> block just before </body>. Use type="module" only if the JS uses ES module syntax.
- If the JS or HTML clearly depends on libraries (React, Vue, Three.js, GSAP, p5, jQuery, lodash, Babel, TypeScript, etc.), add the matching CDN <script> or <link> tags to <head>. Prefer unpkg or cdnjs. If JSX/TSX is present, include @babel/standalone and mark the user script with type="text/babel".
- If the HTML editor content is a fragment (no <html>/<body>), wrap it inside <body>. If it is a full document, keep its structure and inject styles/scripts into the right slots.
- Do not invent application logic that was not present in the source. Preserve identifiers, class names, and structure.
- Escape any literal "</script>" inside JS so it does not break parsing.
- Add <meta name="generator" content="CodePen Library Saver"> and <meta name="codepen:source" content="<canonical url>"> in <head>.

Return ONLY the HTML document.`;

function buildUserPrompt(meta: CodePenMeta, html: string, css: string, js: string): string {
  return `Source URL: ${meta.canonicalUrl}
Title: ${meta.title}
Author: ${meta.author || meta.user}

=== HTML EDITOR ===
${html || "(empty)"}

=== CSS EDITOR ===
${css || "(empty)"}

=== JS EDITOR ===
${js || "(empty)"}

Produce one runnable standalone HTML file as described.`;
}

function stripFences(content: string): string {
  let output = content.trim();
  const fenceMatch = output.match(/^```(?:html|HTML)?\s*([\s\S]*?)```$/);
  if (fenceMatch) {
    output = fenceMatch[1].trim();
  }
  return output;
}
