// Injected on demand. Extracts readable text (selection > tweet thread >
// Readability > raw fallback) and renders the overlay card in a shadow root.

(() => {
  if (window.__speedRead) {
    // Already injected on this page; background will message the existing copy.
    return;
  }

  const state = { text: null, meta: null, expanded: {} };
  window.__speedRead = state;

  const REGISTERS = [
    { id: 'eli5', label: 'ELI5' },
    { id: 'pitch', label: 'Elevator pitch' },
    { id: 'abstract', label: 'Postdoc abstract' },
  ];

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg?.type === 'sr-summarize') start(msg.selectionText);
    else if (msg?.type === 'sr-result') renderResults(msg.engine, msg.results);
    else if (msg?.type === 'sr-error') renderError(msg.message);
  });

  // ---------- Extraction ----------

  function start(selectionText) {
    const sel = (selectionText || String(window.getSelection() || '')).trim();
    const extracted = sel.length > 80
      ? { kind: 'selection', title: document.title, text: sel }
      : extract();

    if (!extracted || !extracted.text || extracted.text.trim().length < 80) {
      showCard();
      renderError('Could not find enough readable text on this page. Try selecting the text you want summarized.');
      return;
    }

    state.text = extracted.text;
    state.meta = extracted;
    state.expanded = {};
    showCard();
    renderLoading(extracted);
    chrome.runtime.sendMessage({
      type: 'sr-extracted',
      kind: extracted.kind,
      title: extracted.title,
      text: extracted.text,
      url: location.href,
    });
  }

  function extract() {
    if (/(^|\.)(x|twitter)\.com$/.test(location.hostname)) {
      const thread = extractTweetThread();
      if (thread) return thread;
    }
    try {
      if (typeof Readability !== 'undefined') {
        const article = new Readability(document.cloneNode(true)).parse();
        if (article && article.textContent && article.textContent.trim().length > 200) {
          return { kind: 'article', title: article.title || document.title, text: article.textContent };
        }
      }
    } catch {
      // Readability throws on some exotic DOMs; fall through.
    }
    return { kind: 'page', title: document.title, text: fallbackExtract() };
  }

  function extractTweetThread() {
    const tweets = [...document.querySelectorAll('article[data-testid="tweet"]')];
    if (!tweets.length) return null;
    const handleOf = (t) => {
      const link = t.querySelector('[data-testid="User-Name"] a[href^="/"]');
      return link ? link.getAttribute('href').slice(1).split('/')[0].toLowerCase() : '';
    };
    const author = handleOf(tweets[0]);
    if (!author) return null;
    const texts = tweets
      .filter((t) => handleOf(t) === author)
      .map((t) => t.querySelector('[data-testid="tweetText"]')?.innerText?.trim())
      .filter(Boolean);
    if (!texts.length) return null;
    return { kind: 'tweet thread', title: `@${author} on X`, text: texts.join('\n\n') };
  }

  function fallbackExtract() {
    const root =
      document.querySelector('main') ||
      document.querySelector('article') ||
      document.body;
    return (root?.innerText || '').replace(/\n{3,}/g, '\n\n').trim();
  }

  // ---------- Overlay UI ----------

  let host = null;
  let card = null;

  const CSS = `
    :host { all: initial; }
    .sr-card {
      width: 400px; max-width: calc(100vw - 48px);
      max-height: calc(100vh - 48px); overflow-y: auto;
      background: #16161f; color: #e8e8f0;
      border: 1px solid #2c2c3d; border-radius: 14px;
      box-shadow: 0 12px 40px rgba(0,0,0,.55);
      font: 13px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif;
      padding: 14px 16px;
    }
    .sr-head { display: flex; align-items: center; gap: 8px; margin-bottom: 10px; }
    .sr-dot { width: 10px; height: 10px; border-radius: 3px; background: #6c5ce7; flex: none; }
    .sr-title {
      font-weight: 600; font-size: 13px; flex: 1; min-width: 0;
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }
    .sr-close {
      flex: none; background: none; border: 0; color: #8b8ba3; cursor: pointer;
      font-size: 16px; line-height: 1; padding: 2px 4px; border-radius: 6px;
    }
    .sr-close:hover { color: #fff; background: #2c2c3d; }
    .sr-row {
      border: 1px solid #2c2c3d; border-radius: 10px;
      padding: 10px 12px; margin-bottom: 8px; cursor: pointer;
    }
    .sr-row:hover { border-color: #44445c; }
    .sr-chip {
      display: inline-block; font-size: 10px; font-weight: 700;
      letter-spacing: .06em; text-transform: uppercase;
      padding: 2px 7px; border-radius: 99px; margin-bottom: 6px;
    }
    .sr-chip-eli5 { background: #103c2c; color: #4ade80; }
    .sr-chip-pitch { background: #3d2e10; color: #fbbf24; }
    .sr-chip-abstract { background: #2a2050; color: #a78bfa; }
    .sr-line { margin: 0; }
    .sr-more {
      margin: 8px 0 0; padding-top: 8px; border-top: 1px dashed #2c2c3d;
      color: #b9b9cc; display: none;
    }
    .sr-more.sr-open { display: block; }
    .sr-foot { font-size: 11px; color: #8b8ba3; margin-top: 4px; display: flex; gap: 8px; }
    .sr-spin {
      width: 18px; height: 18px; border-radius: 50%;
      border: 2px solid #2c2c3d; border-top-color: #6c5ce7;
      animation: sr-rot .8s linear infinite; margin: 0 auto;
    }
    @keyframes sr-rot { to { transform: rotate(360deg); } }
    .sr-loading { text-align: center; padding: 18px 0 14px; color: #8b8ba3; }
    .sr-error { color: #ff7675; padding: 6px 0; }
    .sr-hint { font-size: 11px; color: #8b8ba3; margin-top: 2px; }
  `;

  function showCard() {
    if (host && document.documentElement.contains(host)) return;
    host = document.createElement('div');
    host.style.cssText =
      'position:fixed;top:16px;right:16px;z-index:2147483647;';
    const shadow = host.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = CSS;
    shadow.appendChild(style);
    card = document.createElement('div');
    card.className = 'sr-card';
    shadow.appendChild(card);
    document.documentElement.appendChild(host);
    document.addEventListener('keydown', onKeydown, true);
  }

  function closeCard() {
    document.removeEventListener('keydown', onKeydown, true);
    host?.remove();
    host = null;
    card = null;
  }

  function onKeydown(e) {
    if (e.key === 'Escape') {
      e.stopPropagation();
      closeCard();
    }
  }

  function header(titleText) {
    const head = document.createElement('div');
    head.className = 'sr-head';
    const dot = document.createElement('div');
    dot.className = 'sr-dot';
    const title = document.createElement('div');
    title.className = 'sr-title';
    title.textContent = titleText;
    const close = document.createElement('button');
    close.className = 'sr-close';
    close.textContent = '✕';
    close.addEventListener('click', closeCard);
    head.append(dot, title, close);
    return head;
  }

  function renderLoading(meta) {
    if (!card) return;
    card.replaceChildren(header(meta.title || 'Speed Read'));
    const box = document.createElement('div');
    box.className = 'sr-loading';
    const spin = document.createElement('div');
    spin.className = 'sr-spin';
    const label = document.createElement('div');
    label.style.marginTop = '8px';
    label.textContent = `Summarizing ${meta.kind} (${Intl.NumberFormat().format(meta.text.length)} chars)…`;
    box.append(spin, label);
    card.appendChild(box);
  }

  function renderError(message) {
    if (!card) return;
    card.replaceChildren(header(document.title || 'Speed Read'));
    const err = document.createElement('div');
    err.className = 'sr-error';
    err.textContent = message;
    card.appendChild(err);
  }

  function renderResults(engine, results) {
    if (!card) return;
    card.replaceChildren(header(state.meta?.title || 'Speed Read'));

    for (const reg of REGISTERS) {
      const row = document.createElement('div');
      row.className = 'sr-row';

      const chip = document.createElement('span');
      chip.className = `sr-chip sr-chip-${reg.id}`;
      chip.textContent = reg.label;

      const line = document.createElement('p');
      line.className = 'sr-line';
      line.textContent = results[reg.id] || '—';

      const more = document.createElement('p');
      more.className = 'sr-more';

      row.append(chip, line, more);
      row.addEventListener('click', () => toggleExpand(reg.id, more));
      card.appendChild(row);
    }

    const foot = document.createElement('div');
    foot.className = 'sr-foot';
    const engineLabel = document.createElement('span');
    engineLabel.textContent =
      engine === 'prompt' ? 'Gemini Nano · on-device' : 'Summarizer fallback · on-device';
    const hint = document.createElement('span');
    hint.textContent = 'click a summary to expand · Esc to close';
    foot.append(engineLabel, hint);
    card.appendChild(foot);
  }

  function toggleExpand(registerId, moreEl) {
    if (moreEl.classList.contains('sr-open')) {
      moreEl.classList.remove('sr-open');
      return;
    }
    if (state.expanded[registerId]) {
      moreEl.textContent = state.expanded[registerId];
      moreEl.classList.add('sr-open');
      return;
    }
    moreEl.textContent = 'Expanding…';
    moreEl.classList.add('sr-open');
    chrome.runtime.sendMessage(
      { type: 'sr-expand', register: registerId, text: state.text },
      (res) => {
        if (res?.ok) {
          state.expanded[registerId] = res.value;
          moreEl.textContent = res.value;
        } else {
          moreEl.textContent = 'Could not expand: ' + (res?.error || 'no response');
        }
      }
    );
  }
})();
