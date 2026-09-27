// Shared on-device AI module. Runs in whichever context has the built-in AI
// APIs exposed: the service worker, the offscreen document, or extension pages.

export const REGISTER_DEFS = [
  {
    id: 'eli5',
    label: 'ELI5',
    hint: 'one sentence a curious 10-year-old would fully understand — zero jargon, everyday analogies allowed',
  },
  {
    id: 'pitch',
    label: 'Elevator pitch',
    hint: 'one punchy sentence for a busy executive: what this is and why it matters, no fluff',
  },
  {
    id: 'abstract',
    label: 'Postdoc abstract',
    hint: 'one dense, technically precise sentence in the style of an academic abstract, correct domain terminology',
  },
];

const SYSTEM_PROMPT =
  'You compress written content into single-sentence summaries in distinct registers. ' +
  'Stay strictly faithful to the source text: never invent facts, never editorialize. ' +
  'Each summary must be exactly one sentence.';

const RESULT_SCHEMA = {
  type: 'object',
  properties: {
    eli5: { type: 'string' },
    pitch: { type: 'string' },
    abstract: { type: 'string' },
  },
  required: ['eli5', 'pitch', 'abstract'],
  additionalProperties: false,
};

// Gemini Nano's usable context is small; one-liners only need the head of
// long articles anyway.
const MAX_CHARS = 12000;

function hasPromptAPI() {
  return typeof LanguageModel !== 'undefined';
}

function hasSummarizer() {
  return typeof Summarizer !== 'undefined';
}

export function apisExposedHere() {
  return hasPromptAPI() || hasSummarizer();
}

export async function engineStatus() {
  const status = { prompt: 'unsupported', summarizer: 'unsupported' };
  if (hasPromptAPI()) {
    try { status.prompt = await LanguageModel.availability(); } catch (e) { status.prompt = 'error: ' + e.message; }
  }
  if (hasSummarizer()) {
    try { status.summarizer = await Summarizer.availability(); } catch (e) { status.summarizer = 'error: ' + e.message; }
  }
  return status;
}

// Creating a session while availability is 'downloadable' kicks off the model
// download; progress events stream through the monitor.
export async function downloadModel(onProgress) {
  if (!hasPromptAPI()) throw new Error('The Prompt API is not supported in this Chrome.');
  const session = await LanguageModel.create({
    monitor(m) {
      m.addEventListener('downloadprogress', (e) => onProgress?.(e.loaded));
    },
  });
  session.destroy();
}

function clip(text) {
  const t = text.trim();
  return t.length > MAX_CHARS ? t.slice(0, MAX_CHARS) + ' …' : t;
}

export async function summarizeAll(text, meta = {}) {
  const clipped = clip(text);
  if (hasPromptAPI() && (await LanguageModel.availability()) === 'available') {
    return { engine: 'prompt', results: await promptSummaries(clipped, meta) };
  }
  if (hasSummarizer() && (await Summarizer.availability()) === 'available') {
    return { engine: 'summarizer', results: await summarizerSummaries(clipped) };
  }
  throw new Error(
    'No on-device model is ready. Open the Speed Read options page to check requirements and download the model.'
  );
}

export async function expand(registerId, text) {
  const def = REGISTER_DEFS.find((r) => r.id === registerId);
  if (!def) throw new Error('Unknown register: ' + registerId);
  const clipped = clip(text);

  if (hasPromptAPI() && (await LanguageModel.availability()) === 'available') {
    const session = await LanguageModel.create({
      initialPrompts: [{ role: 'system', content: SYSTEM_PROMPT }],
    });
    try {
      return await session.prompt(
        `Summarize the following text as a short paragraph (3-4 sentences) in this register: ${def.hint}.\n\nTEXT:\n${clipped}`
      );
    } finally {
      session.destroy();
    }
  }
  if (hasSummarizer() && (await Summarizer.availability()) === 'available') {
    const s = await Summarizer.create({ type: 'tldr', length: 'medium', format: 'plain-text' });
    try {
      return await s.summarize(clipped);
    } finally {
      s.destroy();
    }
  }
  throw new Error('No on-device model is ready.');
}

async function promptSummaries(text, meta) {
  const session = await LanguageModel.create({
    initialPrompts: [{ role: 'system', content: SYSTEM_PROMPT }],
  });
  try {
    const registerLines = REGISTER_DEFS.map((r) => `- "${r.id}": ${r.hint}`).join('\n');
    const kind = meta.kind || 'text';
    const title = meta.title ? `TITLE: ${meta.title}\n` : '';
    const prompt =
      `Summarize the following ${kind} once per register:\n${registerLines}\n\n` +
      `${title}TEXT:\n${text}`;

    let raw;
    try {
      raw = await session.prompt(prompt, { responseConstraint: RESULT_SCHEMA });
    } catch {
      // Older builds without responseConstraint support — ask nicely instead.
      raw = await session.prompt(
        prompt + '\n\nRespond with ONLY a JSON object with string keys "eli5", "pitch", "abstract".'
      );
    }
    return parseResults(raw);
  } finally {
    session.destroy();
  }
}

function parseResults(raw) {
  let obj = null;
  try {
    obj = JSON.parse(raw);
  } catch {
    const match = String(raw).match(/\{[\s\S]*\}/);
    if (match) {
      try { obj = JSON.parse(match[0]); } catch { /* fall through */ }
    }
  }
  if (!obj || typeof obj !== 'object') {
    throw new Error('Model returned an unparseable response. Try again.');
  }
  const results = {};
  for (const def of REGISTER_DEFS) {
    const v = obj[def.id];
    if (typeof v !== 'string' || !v.trim()) throw new Error(`Model response missing "${def.id}".`);
    results[def.id] = v.trim();
  }
  return results;
}

// Degraded mode: the Summarizer API only has fixed summary types, so the
// registers map approximately. The UI labels this engine as a fallback.
async function summarizerSummaries(text) {
  const summarize = async (type, length) => {
    const s = await Summarizer.create({ type, length, format: 'plain-text' });
    try {
      return (await s.summarize(text)).trim();
    } finally {
      s.destroy();
    }
  };
  return {
    eli5: await summarize('teaser', 'short'),
    pitch: await summarize('tldr', 'short'),
    abstract: await summarize('headline', 'short'),
  };
}
