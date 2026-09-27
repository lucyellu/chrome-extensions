import { engineStatus, downloadModel, summarizeAll, REGISTER_DEFS } from './ai.js';

const promptStatusEl = document.getElementById('prompt-status');
const summarizerStatusEl = document.getElementById('summarizer-status');
const downloadBtn = document.getElementById('download');
const refreshBtn = document.getElementById('refresh');
const progressEl = document.getElementById('progress');
const engineMsgEl = document.getElementById('engine-msg');
const testInput = document.getElementById('test-input');
const testRun = document.getElementById('test-run');
const testMsg = document.getElementById('test-msg');
const testResult = document.getElementById('test-result');

function setPill(el, status) {
  el.textContent = status;
  el.className = 'pill pill-' + String(status).split(':')[0].trim();
}

async function refresh() {
  setPill(promptStatusEl, 'checking…');
  setPill(summarizerStatusEl, 'checking…');
  const status = await engineStatus();
  setPill(promptStatusEl, status.prompt);
  setPill(summarizerStatusEl, status.summarizer);
  downloadBtn.hidden = status.prompt !== 'downloadable';
  if (status.prompt === 'available') {
    engineMsgEl.textContent = 'Ready — Gemini Nano is downloaded and available.';
  } else if (status.prompt === 'downloading') {
    engineMsgEl.textContent = 'Chrome is downloading the model in the background. Check back in a bit.';
  } else if (status.prompt === 'downloadable') {
    engineMsgEl.textContent = 'The model needs a one-time download before first use.';
  } else if (status.prompt === 'unsupported') {
    engineMsgEl.textContent =
      'This Chrome does not expose the Prompt API. Make sure you are on Chrome 138+ ' +
      'and meet the hardware requirements below.';
  } else {
    engineMsgEl.textContent = '';
  }
}

downloadBtn.addEventListener('click', async () => {
  downloadBtn.disabled = true;
  progressEl.hidden = false;
  try {
    await downloadModel((loaded) => {
      progressEl.value = loaded;
    });
    engineMsgEl.textContent = 'Model downloaded — you are ready to go.';
  } catch (e) {
    engineMsgEl.textContent = 'Download failed: ' + e.message;
  } finally {
    downloadBtn.disabled = false;
    progressEl.hidden = true;
    refresh();
  }
});

refreshBtn.addEventListener('click', refresh);

testRun.addEventListener('click', async () => {
  const text = testInput.value.trim();
  if (text.length < 80) {
    testMsg.textContent = 'Paste at least a paragraph or two.';
    return;
  }
  testRun.disabled = true;
  testMsg.textContent = 'Summarizing…';
  testResult.replaceChildren();
  try {
    const { engine, results } = await summarizeAll(text, { kind: 'pasted text' });
    testMsg.textContent =
      engine === 'prompt' ? 'Done · Gemini Nano' : 'Done · Summarizer fallback';
    for (const reg of REGISTER_DEFS) {
      const chip = document.createElement('span');
      chip.className = `chip chip-${reg.id}`;
      chip.textContent = reg.label;
      const line = document.createElement('p');
      line.className = 'line';
      line.textContent = results[reg.id];
      testResult.append(chip, line);
    }
  } catch (e) {
    testMsg.textContent = '';
    const err = document.createElement('p');
    err.className = 'err';
    err.textContent = e.message;
    testResult.replaceChildren(err);
  } finally {
    testRun.disabled = false;
  }
});

refresh();
