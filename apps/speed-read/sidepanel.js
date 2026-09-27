const REGISTERS = [
  { id: 'eli5', label: 'ELI5' },
  { id: 'pitch', label: 'Elevator pitch' },
  { id: 'abstract', label: 'Postdoc abstract' },
];

const runBtn = document.getElementById('run');
const errorEl = document.getElementById('error');
const emptyEl = document.getElementById('empty');
const listEl = document.getElementById('list');

runBtn.addEventListener('click', () => {
  runBtn.disabled = true;
  errorEl.style.display = 'none';
  chrome.runtime.sendMessage({ type: 'sr-run-active' }, (res) => {
    runBtn.disabled = false;
    if (!res?.ok) showError(res?.error || 'Could not reach the current tab.');
  });
});

function showError(message) {
  errorEl.textContent = message;
  errorEl.style.display = 'block';
}

function render(history) {
  const entries = Array.isArray(history) ? history : [];
  emptyEl.style.display = entries.length ? 'none' : 'block';
  listEl.replaceChildren(
    ...entries.map((entry, i) => renderEntry(entry, i === 0))
  );
}

function renderEntry(entry, open) {
  const details = document.createElement('details');
  details.open = open;

  const summary = document.createElement('summary');
  const title = document.createElement('span');
  title.className = 'title';
  title.textContent = entry.title || entry.url || 'Untitled';
  const time = document.createElement('span');
  time.className = 'time';
  time.textContent = new Date(entry.ts).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  });
  summary.append(title, time);
  details.appendChild(summary);

  const body = document.createElement('div');
  body.className = 'body';
  for (const reg of REGISTERS) {
    const row = document.createElement('div');
    row.className = 'row';
    const chip = document.createElement('span');
    chip.className = `chip chip-${reg.id}`;
    chip.textContent = reg.label;
    const line = document.createElement('p');
    line.className = 'line';
    line.textContent = entry.results?.[reg.id] || '—';
    row.append(chip, line);
    body.appendChild(row);
  }

  const meta = document.createElement('div');
  meta.className = 'meta';
  const link = document.createElement('a');
  link.href = entry.url || '#';
  link.target = '_blank';
  link.textContent = entry.kind || 'page';
  meta.append(
    link,
    document.createTextNode(
      ` · ${entry.engine === 'prompt' ? 'Gemini Nano' : 'Summarizer fallback'}`
    )
  );
  body.appendChild(meta);
  details.appendChild(body);
  return details;
}

chrome.storage.session.get('history').then((data) => render(data.history));

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'session' && changes.history) render(changes.history.newValue);
});
