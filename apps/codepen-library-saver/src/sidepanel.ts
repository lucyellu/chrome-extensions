import JSZip from "jszip";
import "./sidepanel.css";
import { getLibrary, getSettings, removePen, saveLibrary, saveSettings, updatePen, upsertPen, upsertPens } from "./storage";
import type { LibrarySettings, RuntimeRequest, RuntimeResponse, SavedPen } from "./types";

type ToastTone = "info" | "success" | "error";

let library: SavedPen[] = [];
let settings: LibrarySettings = {
  cardSize: 1,
  deepseekApiKey: "",
  downloadFolder: "CodePen Library",
  lockTextToThumbnail: false,
  settingsExpanded: false,
  sortBy: "savedAt",
  sortDirection: "desc",
  tagFilter: "",
  textScale: 0.68
};
let searchTerm = "";
let selectedIds = new Set<string>();
let statusText = "Ready to save the current Pen.";
let statusTone: ToastTone = "info";

const panelRoot = document.querySelector<HTMLElement>("#app");
if (!panelRoot) {
  throw new Error("Missing side panel root.");
}

const app = panelRoot;
void boot();

async function boot(): Promise<void> {
  [library, settings] = await Promise.all([getLibrary(), getSettings()]);
  if (!library.length) {
    const seeded = await loadBundledSeed();
    if (seeded.length) {
      library = await upsertPens(seeded);
      statusText = `Loaded ${seeded.length} saved Pen${seeded.length === 1 ? "" : "s"} from the local import seed.`;
      statusTone = "success";
    }
  }
  render();
}

function render(): void {
  selectedIds = new Set(Array.from(selectedIds).filter((id) => library.some((pen) => pen.id === id)));
  app.style.setProperty("--grid-columns", String(settings.cardSize));
  app.style.setProperty("--text-scale", String(settings.textScale));
  app.dataset.gridColumns = String(settings.cardSize);
  app.classList.toggle("controls-collapsed", !settings.settingsExpanded);
  app.classList.toggle("text-lock-tiles", settings.lockTextToThumbnail);
  const visiblePens = getVisiblePens();
  const selectedPens = getSelectedPens();
  const folderOptions = getFolders();
  const tagOptions = getTags();

  app.innerHTML = `
    <section class="quick-actions" aria-label="Quick library actions">
      <button class="thin-button primary-thin" id="save-current" type="button" title="Save the active CodePen as a standalone HTML file">
        <span aria-hidden="true">${icons.save}</span>
        Current
      </button>
      <button class="thin-button" id="save-tabs" type="button" title="Save every open CodePen Pen tab">
        <span aria-hidden="true">${icons.tabs}</span>
        All tabs
      </button>
      <button class="thin-button" id="find-latest-file" type="button" title="Find the newest downloaded HTML file in local File Explorer">
        <span aria-hidden="true">${icons.folder}</span>
        Find
      </button>
      <button class="thin-button" id="import-folder-quick" type="button" title="Import local HTML files from the CodePen Library folder">
        <span aria-hidden="true">${icons.upload}</span>
        Import
      </button>
      <button class="icon-button" id="open-library-folder" type="button" title="Open Chrome downloads folder" aria-label="Open Chrome downloads folder">${icons.folderOpen}</button>
      <button class="thin-button settings-toggle" id="toggle-settings" type="button" aria-expanded="${settings.settingsExpanded}" title="${settings.settingsExpanded ? "Collapse settings" : "Expand settings"}">
        <span aria-hidden="true">${settings.settingsExpanded ? icons.chevronUp : icons.chevronDown}</span>
        Settings
      </button>
    </section>

    <section class="settings-panel ${settings.settingsExpanded ? "" : "collapsed"}" aria-label="Library settings">
      <div class="settings-content">
        <div class="settings-bar" aria-label="Local folder settings">
          <label>
            <span>Downloads folder</span>
            <input id="folder-input" type="text" value="${escapeAttribute(settings.downloadFolder)}" spellcheck="false" />
          </label>
          <button class="icon-button" id="save-folder" type="button" title="Save folder name" aria-label="Save folder name">${icons.check}</button>
        </div>

        <div class="settings-bar" aria-label="DeepSeek API key">
          <label>
            <span>DeepSeek API key (smart fallback)</span>
            <input id="deepseek-key-input" type="password" value="${escapeAttribute(settings.deepseekApiKey)}" autocomplete="off" spellcheck="false" placeholder="sk-..." />
          </label>
          <button class="icon-button" id="save-deepseek-key" type="button" title="Save DeepSeek API key" aria-label="Save DeepSeek API key">${icons.check}</button>
        </div>

        <section class="batch-panel" aria-label="Library tools">
          <label>
            <span>Folder for open tabs</span>
            <input id="batch-folder-input" type="text" value="${escapeAttribute(defaultBatchFolder())}" spellcheck="false" />
          </label>
          <button class="secondary-button" id="save-tabs-settings" type="button" title="Save every open CodePen Pen tab">
            <span aria-hidden="true">${icons.tabs}</span>
            Open tabs
          </button>
          <button class="secondary-button" id="export-library" type="button" title="Export all saved HTML and metadata as a ZIP">
            <span aria-hidden="true">${icons.package}</span>
            Library ZIP
          </button>
          <button class="secondary-button" id="repair-library" type="button" title="Refetch and rewrite saved HTML files so they run directly">
            <span aria-hidden="true">${icons.refresh}</span>
            Repair saved
          </button>
          <button class="secondary-button" id="dedupe-library" type="button" title="Collapse duplicate saves of the same Pen, keeping the most recent">
            <span aria-hidden="true">${icons.trash}</span>
            Dedupe
          </button>
          <button class="secondary-button" id="import-library" type="button" title="Import a library ZIP">
            <span aria-hidden="true">${icons.upload}</span>
            Import
          </button>
          <button class="secondary-button" id="import-folder" type="button" title="Import a folder of saved HTML files">
            <span aria-hidden="true">${icons.folder}</span>
            HTML folder
          </button>
          <input id="import-file" type="file" accept=".zip,application/zip" hidden />
          <input id="import-folder-input" type="file" accept=".html,text/html" webkitdirectory multiple hidden />
        </section>
      </div>
    </section>

    <section class="search-row">
      <label class="search-box">
        <span aria-hidden="true">${icons.search}</span>
        <input id="search-input" type="search" value="${escapeAttribute(searchTerm)}" placeholder="Search title, folder, tag, author" />
      </label>
      <span class="counter">${visiblePens.length}/${library.length}</span>
    </section>

    <section class="view-controls" aria-label="Library view controls">
      <label>
        <span>Sort</span>
        <select id="sort-select">
          <option value="savedAt:desc" ${settings.sortBy === "savedAt" && settings.sortDirection === "desc" ? "selected" : ""}>Saved newest</option>
          <option value="savedAt:asc" ${settings.sortBy === "savedAt" && settings.sortDirection === "asc" ? "selected" : ""}>Saved oldest</option>
          <option value="lastAccessedAt:desc" ${settings.sortBy === "lastAccessedAt" && settings.sortDirection === "desc" ? "selected" : ""}>Accessed recent</option>
          <option value="lastAccessedAt:asc" ${settings.sortBy === "lastAccessedAt" && settings.sortDirection === "asc" ? "selected" : ""}>Accessed oldest</option>
          <option value="tags:asc" ${settings.sortBy === "tags" && settings.sortDirection === "asc" ? "selected" : ""}>Tags A-Z</option>
          <option value="tags:desc" ${settings.sortBy === "tags" && settings.sortDirection === "desc" ? "selected" : ""}>Tags Z-A</option>
          <option value="title:asc" ${settings.sortBy === "title" && settings.sortDirection === "asc" ? "selected" : ""}>Title A-Z</option>
        </select>
      </label>
      <label>
        <span>Tag</span>
        <select id="tag-filter">
          <option value="" ${settings.tagFilter ? "" : "selected"}>All tags</option>
          ${tagOptions.map((tag) => `<option value="${escapeAttribute(tag)}" ${settings.tagFilter === tag ? "selected" : ""}>#${escapeHtml(tag)}</option>`).join("")}
        </select>
      </label>
      <label class="size-control">
        <span>Columns</span>
        <input id="view-size" type="range" min="1" max="4" step="1" value="${settings.cardSize}" title="CodePens per row" />
      </label>
      <label class="size-control">
        <span>Text</span>
        <input id="text-size" type="range" min="0.4" max="1.8" step="0.05" value="${settings.textScale}" title="Text size" />
      </label>
      <label class="check-control" title="Scale Pen tile text from the thumbnail/tile width">
        <input id="lock-text-to-thumbnail" type="checkbox" ${settings.lockTextToThumbnail ? "checked" : ""} />
        <span>Lock text to tile</span>
      </label>
    </section>

    <section class="quick-filters" aria-label="Library folders and tags">
      ${folderOptions.map((folder) => `<button class="chip" data-folder-filter="${escapeAttribute(folder)}" type="button">${icons.folder}<span>${escapeHtml(folder)}</span></button>`).join("")}
      ${tagOptions.map((tag) => `<button class="chip tag-chip" data-tag-filter="${escapeAttribute(tag)}" type="button">#${escapeHtml(tag)}</button>`).join("")}
    </section>

    ${
      library.length
        ? `<section class="selection-bar" aria-label="Selection actions">
            <label class="select-all"><input id="select-visible" type="checkbox" ${visiblePens.length && visiblePens.every((pen) => selectedIds.has(pen.id)) ? "checked" : ""} /> Select visible</label>
            <span>${selectedPens.length} selected</span>
            <button class="secondary-button" data-batch="copy" type="button" ${selectedPens.length ? "" : "disabled"}>${icons.copy} Copy combined</button>
            <button class="secondary-button" data-batch="single" type="button" ${selectedPens.length ? "" : "disabled"}>${icons.download} Single HTML</button>
            <button class="secondary-button" data-batch="zip" type="button" ${selectedPens.length ? "" : "disabled"}>${icons.package} ZIP</button>
          </section>`
        : ""
    }

    <p class="status ${statusTone}" role="status">${escapeHtml(statusText)}</p>

    <section class="library-list" aria-label="Saved CodePens">
      ${
        visiblePens.length
          ? visiblePens.map(renderPenCard).join("")
          : `<article class="empty-state">
              <span aria-hidden="true">${icons.archive}</span>
              <h2>No saved pens yet</h2>
              <p>Open a CodePen, press Save, or save all open Pen tabs into one folder.</p>
            </article>`
      }
    </section>
  `;

  bindEvents();
}

function renderPenCard(pen: SavedPen): string {
  const savedDate = new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(pen.savedAt));
  const accessedDate = pen.lastAccessedAt
    ? new Intl.DateTimeFormat(undefined, {
        dateStyle: "medium",
        timeStyle: "short"
      }).format(new Date(pen.lastAccessedAt))
    : "Never";
  const tags = pen.tags || [];
  const thumbnail = pen.thumbnailUrl || generatedThumbnail(pen);

  return `
    <article class="pen-card ${selectedIds.has(pen.id) ? "selected" : ""}" data-id="${escapeAttribute(pen.id)}">
      <label class="card-check" title="Select this Pen">
        <input class="pen-select" type="checkbox" ${selectedIds.has(pen.id) ? "checked" : ""} />
      </label>
      <a class="thumb-link access-link" href="${escapeAttribute(pen.canonicalUrl)}" target="_blank" rel="noreferrer" title="Open original CodePen">
        <img src="${escapeAttribute(thumbnail)}" alt="" loading="lazy" data-fallback="${escapeAttribute(generatedThumbnail(pen))}" />
      </a>
      <div class="pen-body">
        <div class="pen-title-row">
          <h2>${escapeHtml(pen.title)}</h2>
          <a class="open-link access-link" href="${escapeAttribute(pen.canonicalUrl)}" target="_blank" rel="noreferrer" title="Open original CodePen" aria-label="Open original CodePen">${icons.external}</a>
        </div>
        <p class="meta">${escapeHtml(pen.author || pen.user)} · ${escapeHtml(pen.slug)}</p>
        <div class="badge-row">
          <span class="source-badge ${pen.sourceMode === "separated-source" ? "needs-refactor" : ""}">${escapeHtml(sourceModeLabel(pen.sourceMode))}</span>
          ${tags.map((tag) => `<button class="tag-button" data-filter="${escapeAttribute(tag)}" type="button">#${escapeHtml(tag)}</button>`).join("")}
        </div>
        <p class="file-name" title="${escapeAttribute(pen.filename)}">${escapeHtml(pen.filename)}</p>
        <div class="organize-row">
          <label>
            <span>Folder</span>
            <input class="meta-folder" type="text" value="${escapeAttribute(pen.folder || "")}" placeholder="Folder" />
          </label>
          <label>
            <span>Tags</span>
            <input class="meta-tags" type="text" value="${escapeAttribute(tags.join(", "))}" placeholder="tag, tag" />
          </label>
        </div>
        <p class="saved-date">Saved ${escapeHtml(savedDate)} · Accessed ${escapeHtml(accessedDate)}</p>
        <div class="button-row">
          <button class="secondary-button" data-action="save-meta" type="button" title="Save folder and tags">${icons.check} Organize</button>
          <button class="secondary-button" data-action="copy" type="button" title="Copy standalone HTML">${icons.copy} Copy</button>
          <button class="secondary-button" data-action="download" type="button" title="Download standalone HTML">${icons.download} HTML</button>
          <button class="icon-button danger" data-action="remove" type="button" title="Remove from library" aria-label="Remove from library">${icons.trash}</button>
          <button class="secondary-button find-local-button" data-action="find-local" type="button" title="Find existing HTML file in local File Explorer">${icons.folder} Find local</button>
        </div>
      </div>
    </article>
  `;
}

function bindEvents(): void {
  document.querySelector<HTMLButtonElement>("#toggle-settings")?.addEventListener("click", () => {
    void persistViewSettings({ settingsExpanded: !settings.settingsExpanded });
  });
  document.querySelector<HTMLButtonElement>("#save-current")?.addEventListener("click", () => void saveCurrentPen());
  document.querySelector<HTMLButtonElement>("#save-tabs")?.addEventListener("click", () => void saveOpenTabs());
  document.querySelector<HTMLButtonElement>("#save-tabs-settings")?.addEventListener("click", () => void saveOpenTabs());
  document.querySelector<HTMLButtonElement>("#find-latest-file")?.addEventListener("click", () => void findLatestFileLocation());
  document.querySelector<HTMLButtonElement>("#open-library-folder")?.addEventListener("click", () => openLibraryFolder());
  document.querySelector<HTMLButtonElement>("#import-folder-quick")?.addEventListener("click", () => document.querySelector<HTMLInputElement>("#import-folder-input")?.click());
  document.querySelector<HTMLButtonElement>("#save-folder")?.addEventListener("click", () => void persistFolder());
  document.querySelector<HTMLButtonElement>("#export-library")?.addEventListener("click", () => void exportLibraryZip());
  document.querySelector<HTMLButtonElement>("#repair-library")?.addEventListener("click", () => void repairLibrary());
  document.querySelector<HTMLButtonElement>("#dedupe-library")?.addEventListener("click", () => void dedupeLibrary());
  document.querySelector<HTMLButtonElement>("#import-library")?.addEventListener("click", () => document.querySelector<HTMLInputElement>("#import-file")?.click());
  document.querySelector<HTMLInputElement>("#import-file")?.addEventListener("change", (event) => void importLibraryZip(event));
  document.querySelector<HTMLButtonElement>("#import-folder")?.addEventListener("click", () => document.querySelector<HTMLInputElement>("#import-folder-input")?.click());
  document.querySelector<HTMLInputElement>("#import-folder-input")?.addEventListener("change", (event) => void importHtmlFolder(event));
  document.querySelector<HTMLInputElement>("#folder-input")?.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      void persistFolder();
    }
  });
  document.querySelector<HTMLButtonElement>("#save-deepseek-key")?.addEventListener("click", () => void persistDeepseekKey());
  document.querySelector<HTMLInputElement>("#deepseek-key-input")?.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      void persistDeepseekKey();
    }
  });
  document.querySelector<HTMLInputElement>("#search-input")?.addEventListener("input", (event) => {
    searchTerm = (event.currentTarget as HTMLInputElement).value;
    render();
  });
  document.querySelector<HTMLSelectElement>("#sort-select")?.addEventListener("change", (event) => {
    const [sortBy, sortDirection] = (event.currentTarget as HTMLSelectElement).value.split(":") as [
      LibrarySettings["sortBy"],
      LibrarySettings["sortDirection"]
    ];
    void persistViewSettings({ sortBy, sortDirection });
  });
  document.querySelector<HTMLSelectElement>("#tag-filter")?.addEventListener("change", (event) => {
    void persistViewSettings({ tagFilter: (event.currentTarget as HTMLSelectElement).value });
  });
  document.querySelector<HTMLInputElement>("#view-size")?.addEventListener("input", (event) => {
    const cardSize = clampGridColumns(Number((event.currentTarget as HTMLInputElement).value));
    settings = { ...settings, cardSize };
    app.style.setProperty("--grid-columns", String(cardSize));
    app.dataset.gridColumns = String(cardSize);
    void saveSettings(settings);
  });
  document.querySelector<HTMLInputElement>("#text-size")?.addEventListener("input", (event) => {
    const textScale = clampTextScale(Number((event.currentTarget as HTMLInputElement).value));
    settings = { ...settings, textScale };
    app.style.setProperty("--text-scale", String(textScale));
    void saveSettings(settings);
  });
  document.querySelector<HTMLInputElement>("#lock-text-to-thumbnail")?.addEventListener("change", (event) => {
    const lockTextToThumbnail = (event.currentTarget as HTMLInputElement).checked;
    void persistViewSettings({ lockTextToThumbnail });
  });
  document.querySelector<HTMLInputElement>("#select-visible")?.addEventListener("change", (event) => {
    const checked = (event.currentTarget as HTMLInputElement).checked;
    for (const pen of getVisiblePens()) {
      if (checked) {
        selectedIds.add(pen.id);
      } else {
        selectedIds.delete(pen.id);
      }
    }
    render();
  });

  for (const filter of Array.from(document.querySelectorAll<HTMLButtonElement>(".chip[data-folder-filter]"))) {
    filter.addEventListener("click", () => {
      searchTerm = filter.dataset.folderFilter || "";
      render();
    });
  }

  for (const filter of Array.from(document.querySelectorAll<HTMLButtonElement>(".chip[data-tag-filter]"))) {
    filter.addEventListener("click", () => {
      void persistViewSettings({ tagFilter: filter.dataset.tagFilter || "" });
    });
  }

  for (const filter of Array.from(document.querySelectorAll<HTMLButtonElement>(".tag-button[data-filter]"))) {
    filter.addEventListener("click", () => {
      void persistViewSettings({ tagFilter: filter.dataset.filter || "" });
    });
  }

  for (const button of Array.from(document.querySelectorAll<HTMLButtonElement>("button[data-batch]"))) {
    button.addEventListener("click", () => void handleBatchAction(button.dataset.batch || ""));
  }

  for (const card of Array.from(document.querySelectorAll<HTMLElement>(".pen-card"))) {
    card.addEventListener("change", (event) => handleCardChange(event));
    card.addEventListener("click", (event) => void handleCardClick(event));
  }

  for (const link of Array.from(document.querySelectorAll<HTMLAnchorElement>(".access-link"))) {
    link.addEventListener("click", () => {
      const id = link.closest<HTMLElement>(".pen-card")?.dataset.id;
      if (id) {
        void markPenAccessed(id);
      }
    });
  }

  for (const image of Array.from(document.querySelectorAll<HTMLImageElement>(".thumb-link img"))) {
    image.addEventListener("error", () => {
      const fallback = image.dataset.fallback;
      if (fallback && image.src !== fallback) {
        image.src = fallback;
      }
    });
  }
}

async function saveCurrentPen(): Promise<void> {
  const chromeApi = getChrome();
  if (!chromeApi?.runtime) {
    setStatus("Load this folder as a Chrome extension to save the active CodePen.", "error");
    return;
  }

  setStatus("Saving the active CodePen...", "info");
  chromeApi.runtime.sendMessage({ type: "SAVE_CURRENT_PEN" }, async (response) => {
    if (!response?.ok || !("pen" in response)) {
      setStatus(response?.ok === false ? response.error : "Could not reach the active CodePen tab.", "error");
      return;
    }

    library = await upsertPen(response.pen);
    const downloadedPen = await downloadPen(response.pen, false);
    library = await updatePen(downloadedPen);
    setStatus(`Saved ${response.pen.title}.`, "success");
  });
}

async function saveOpenTabs(): Promise<void> {
  const chromeApi = getChrome();
  if (!chromeApi?.runtime) {
    setStatus("Load this folder as a Chrome extension to save open CodePen tabs.", "error");
    return;
  }

  const batchFolder = sanitizeFolder(document.querySelector<HTMLInputElement>("#batch-folder-input")?.value || defaultBatchFolder());
  setStatus("Saving open CodePen tabs...", "info");
  chromeApi.runtime.sendMessage({ type: "SAVE_OPEN_CODEPEN_TABS" }, async (response) => {
    if (!response?.ok || !("pens" in response)) {
      setStatus(response?.ok === false ? response.error : "Could not save open CodePen tabs.", "error");
      return;
    }

    const organizedPens = response.pens.map((pen) => ({
      ...pen,
      folder: batchFolder,
      tags: pen.tags || []
    }));
    library = await upsertPens(organizedPens);
    const downloadedPens: SavedPen[] = [];
    for (const pen of organizedPens) {
      downloadedPens.push(await downloadPen(pen, false));
    }
    library = await upsertPens(downloadedPens);
    setStatus(`Saved ${organizedPens.length} open CodePen tab${organizedPens.length === 1 ? "" : "s"} into ${batchFolder}.`, "success");
  });
}

async function repairLibrary(): Promise<void> {
  const chromeApi = getChrome();
  if (!library.length) {
    setStatus("There are no saved Pens to repair yet.", "error");
    return;
  }

  if (!chromeApi?.runtime) {
    setStatus("Load this folder as a Chrome extension to repair saved Pens.", "error");
    return;
  }

  setStatus(`Repairing ${library.length} saved Pen${library.length === 1 ? "" : "s"}...`, "info");
  chromeApi.runtime.sendMessage({ type: "REPAIR_SAVED_PENS", pens: library }, async (response) => {
    if (!response?.ok || !("pens" in response)) {
      setStatus(response?.ok === false ? response.error : "Could not repair saved Pens.", "error");
      return;
    }

    library = await upsertPens(response.pens);
    const repairedDownloads: SavedPen[] = [];
    for (const pen of response.pens) {
      repairedDownloads.push(await downloadPen(pen, false, true));
    }
    library = await upsertPens(repairedDownloads);
    setStatus(`Repaired and overwrote ${response.pens.length} saved HTML file${response.pens.length === 1 ? "" : "s"}.`, "success");
  });
}

async function dedupeLibrary(): Promise<void> {
  if (!library.length) {
    setStatus("There are no saved Pens to dedupe yet.", "error");
    return;
  }

  const groups = new Map<string, SavedPen[]>();
  for (const pen of library) {
    const key = pen.id || `${pen.user}/${pen.slug}`;
    const existing = groups.get(key);
    if (existing) {
      existing.push(pen);
    } else {
      groups.set(key, [pen]);
    }
  }

  const duplicateCount = library.length - groups.size;
  if (!duplicateCount) {
    setStatus("No duplicates found.", "info");
    return;
  }

  if (!window.confirm(`Remove ${duplicateCount} duplicate save${duplicateCount === 1 ? "" : "s"}? The most recently saved copy of each Pen is kept; folder and tags from older copies are merged in.`)) {
    return;
  }

  const merged: SavedPen[] = [];
  for (const copies of groups.values()) {
    merged.push(mergeDuplicates(copies));
  }
  merged.sort((a, b) => (Date.parse(b.savedAt || "") || 0) - (Date.parse(a.savedAt || "") || 0));

  await saveLibrary(merged);
  library = merged;
  selectedIds = new Set(Array.from(selectedIds).filter((id) => library.some((pen) => pen.id === id)));
  setStatus(`Removed ${duplicateCount} duplicate save${duplicateCount === 1 ? "" : "s"}. ${library.length} Pen${library.length === 1 ? "" : "s"} remain.`, "success");
}

function mergeDuplicates(copies: SavedPen[]): SavedPen {
  const sorted = [...copies].sort((a, b) => (Date.parse(b.savedAt || "") || 0) - (Date.parse(a.savedAt || "") || 0));
  const keeper = sorted[0];
  const tagSet = new Set<string>();
  let folder = keeper.folder || "";
  let lastDownloadId = keeper.lastDownloadId;
  let lastAccessedAt = keeper.lastAccessedAt || "";
  for (const copy of sorted) {
    for (const tag of copy.tags || []) {
      tagSet.add(tag);
    }
    if (!folder && copy.folder) folder = copy.folder;
    if (!lastDownloadId && copy.lastDownloadId) lastDownloadId = copy.lastDownloadId;
    if (Date.parse(copy.lastAccessedAt || "") > Date.parse(lastAccessedAt || "")) {
      lastAccessedAt = copy.lastAccessedAt || lastAccessedAt;
    }
  }
  return {
    ...keeper,
    folder,
    lastDownloadId,
    lastAccessedAt,
    tags: Array.from(tagSet)
  };
}

function handleCardChange(event: Event): void {
  const target = event.target as HTMLElement;
  if (!target.classList.contains("pen-select")) {
    return;
  }

  const card = target.closest<HTMLElement>(".pen-card");
  const id = card?.dataset.id;
  if (!id) {
    return;
  }

  if ((target as HTMLInputElement).checked) {
    selectedIds.add(id);
  } else {
    selectedIds.delete(id);
  }
  render();
}

async function handleCardClick(event: MouseEvent): Promise<void> {
  const target = event.target as HTMLElement;
  const button = target.closest<HTMLButtonElement>("button[data-action]");
  if (!button) {
    return;
  }

  const card = button.closest<HTMLElement>(".pen-card");
  const pen = library.find((item) => item.id === card?.dataset.id);
  if (!pen || !card) {
    return;
  }

  const action = button.dataset.action;
  if (action === "save-meta") {
    const updated = readCardMetadata(card, pen);
    library = await updatePen(updated);
    setStatus(`Updated ${pen.title}.`, "success");
  }

  if (action === "copy") {
    if (await copyText(pen.html)) {
      setStatus(`Copied ${pen.filename}.`, "success", false);
    } else {
      setStatus("Clipboard access was blocked by the browser.", "error", false);
    }
  }

  if (action === "download") {
    const downloadedPen = await downloadPen(pen, true);
    library = await updatePen(downloadedPen);
    setStatus(`Downloaded ${pen.filename}.`, "success");
  }

  if (action === "find-local") {
    await findLocalFileForPen(pen);
  }

  if (action === "remove") {
    library = await removePen(pen.id);
    selectedIds.delete(pen.id);
    setStatus(`Removed ${pen.title}.`, "info");
  }
}

async function handleBatchAction(action: string): Promise<void> {
  const pens = getSelectedPens();
  if (!pens.length) {
    setStatus("Select one or more saved Pens first.", "error");
    return;
  }

  if (action === "copy") {
    if (await copyText(composeCombinedHtml(pens))) {
      setStatus(`Copied ${pens.length} Pen${pens.length === 1 ? "" : "s"} with separators.`, "success", false);
    } else {
      setStatus("Clipboard access was blocked by the browser.", "error", false);
    }
  }

  if (action === "single") {
    await downloadText(composeCombinedHtml(pens), "selected-codepens.html", "text/html;charset=utf-8", true);
    setStatus(`Exported ${pens.length} Pen${pens.length === 1 ? "" : "s"} as one HTML file.`, "success");
  }

  if (action === "zip") {
    await exportPensZip(pens, "selected-codepens.zip");
    setStatus(`Exported ${pens.length} selected Pen${pens.length === 1 ? "" : "s"} as a ZIP.`, "success");
  }
}

async function persistDeepseekKey(): Promise<void> {
  const input = document.querySelector<HTMLInputElement>("#deepseek-key-input");
  const deepseekApiKey = (input?.value || "").trim();
  settings = { ...settings, deepseekApiKey };
  await saveSettings(settings);
  setStatus(
    deepseekApiKey
      ? "DeepSeek API key saved. Smart fallback enabled."
      : "DeepSeek API key cleared. Snippet fallback only.",
    "success"
  );
}

async function persistFolder(): Promise<void> {
  const input = document.querySelector<HTMLInputElement>("#folder-input");
  const downloadFolder = sanitizeFolder(input?.value || "CodePen Library");
  settings = { ...settings, downloadFolder };
  await saveSettings(settings);
  setStatus(`Downloads will go to ${downloadFolder}.`, "success");
}

function openLibraryFolder(): void {
  const downloads = getChrome()?.downloads;
  if (!downloads?.showDefaultFolder) {
    setStatus("Chrome can open the downloads folder after the extension is loaded.", "error");
    return;
  }

  downloads.showDefaultFolder();
  setStatus(`Opened Chrome downloads. Your library folder is ${settings.downloadFolder}.`, "info", false);
}

async function findLatestFileLocation(): Promise<void> {
  const downloads = getChrome()?.downloads;
  if (!downloads?.show || !downloads.search) {
    setStatus("Load this folder as a Chrome extension to find files in File Explorer.", "error", false);
    return;
  }

  const latestPens = [...library].sort((a, b) => (Date.parse(b.savedAt) || 0) - (Date.parse(a.savedAt) || 0));
  for (const pen of latestPens) {
    const found = await findLocalDownloadItem(pen);
    if (found) {
      await showDownloadedFile(pen, found.id);
      return;
    }
  }

  setStatus(`No matching HTML files were found in Downloads/${sanitizeFolder(settings.downloadFolder) || "CodePen Library"}.`, "error", false);
}

async function findLocalFileForPen(pen: SavedPen): Promise<void> {
  const downloads = getChrome()?.downloads;
  if (!downloads?.show || !downloads.search) {
    setStatus("Load this folder as a Chrome extension to find files in File Explorer.", "error", false);
    return;
  }

  const found = await findLocalDownloadItem(pen);
  if (found) {
    await showDownloadedFile(pen, found.id);
    return;
  }

  if (pen.lastDownloadId) {
    await showDownloadedFile(pen, pen.lastDownloadId);
    return;
  }

  setStatus(`Could not find ${pen.filename} in Downloads/${sanitizeFolder(settings.downloadFolder) || "CodePen Library"}.`, "error", false);
}

async function showDownloadedFile(pen: SavedPen, downloadId: number): Promise<void> {
  const downloads = getChrome()?.downloads;
  if (!downloads?.show) {
    setStatus("Load this folder as a Chrome extension to find files in File Explorer.", "error", false);
    return;
  }

  const shown = downloads.show(downloadId);
  if (shown === false) {
    setStatus(`Could not find ${pen.filename}. Download it again, then try Find.`, "error", false);
    return;
  }

  if (pen.lastDownloadId !== downloadId) {
    const updated = { ...pen, lastDownloadId: downloadId };
    library = await updatePen(updated);
  }

  setStatus(`Opened ${pen.filename} in File Explorer.`, "success", false);
}

async function findLocalDownloadItem(pen: SavedPen): Promise<ChromeDownloadItem | null> {
  const downloads = getChrome()?.downloads;
  const searchDownloads = downloads?.search;
  if (!searchDownloads) {
    return null;
  }

  const items = await new Promise<ChromeDownloadItem[]>((resolve) => {
    searchDownloads(
      {
        limit: 100,
        orderBy: ["-startTime"],
        query: [pen.filename],
        state: "complete"
      },
      resolve
    );
  });

  const expectedSuffix = expectedDownloadSuffix(pen);
  const localFolder = normalizeDownloadPath(sanitizeFolder(settings.downloadFolder) || "CodePen Library");
  const normalizedFilename = normalizeDownloadPath(pen.filename);
  const filenameStem = normalizedFilename.replace(/\.html?$/i, "");

  const candidates = items
    .filter((item) => item.id && item.filename && item.exists !== false)
    .map((item) => ({ item, path: normalizeDownloadPath(item.filename || "") }))
    .filter(({ path }) => path.includes(`/${localFolder}/`) && path.endsWith(".html"));

  return (
    candidates.find(({ path }) => path.endsWith(expectedSuffix))?.item ||
    candidates.find(({ path }) => path.endsWith(`/${normalizedFilename}`))?.item ||
    candidates.find(({ path }) => path.split("/").pop()?.startsWith(filenameStem))?.item ||
    null
  );
}

async function persistViewSettings(patch: Partial<LibrarySettings>): Promise<void> {
  settings = { ...settings, ...patch };
  await saveSettings(settings);
  render();
}

async function exportLibraryZip(): Promise<void> {
  if (!library.length) {
    setStatus("There are no saved Pens to export yet.", "error");
    return;
  }

  await exportPensZip(library, "codepen-library.zip", true);
  setStatus(`Exported the full library with ${library.length} Pen${library.length === 1 ? "" : "s"}.`, "success");
}

async function exportPensZip(pens: SavedPen[], filename: string, includeRestorableLibrary = false): Promise<void> {
  const zip = new JSZip();
  const htmlRoot = zip.folder("html");
  if (!htmlRoot) {
    throw new Error("Could not create ZIP folder.");
  }

  for (const pen of pens) {
    htmlRoot.file(zipPathForPen(pen), pen.html);
  }

  const metadata = pens.map(({ html, ...rest }) => rest);
  zip.file("metadata.json", JSON.stringify(metadata, null, 2));
  if (includeRestorableLibrary) {
    zip.file("library.json", JSON.stringify(pens, null, 2));
  }
  zip.file("README.txt", "Import this ZIP from CodePen Library Saver to restore saved Pens, folders, tags, metadata, and HTML.\n");

  const blob = await zip.generateAsync({ type: "blob" });
  await downloadBlob(blob, filename, true);
}

async function importLibraryZip(event: Event): Promise<void> {
  const input = event.currentTarget as HTMLInputElement;
  const file = input.files?.[0];
  input.value = "";
  if (!file) {
    return;
  }

  try {
    const zip = await JSZip.loadAsync(file);
    const libraryFile = zip.file("library.json");
    if (!libraryFile) {
      throw new Error("This ZIP does not include library.json.");
    }

    const imported = JSON.parse(await libraryFile.async("string")) as SavedPen[];
    if (!Array.isArray(imported)) {
      throw new Error("library.json is not a saved Pen list.");
    }

    library = await upsertPens(imported);
    await saveLibrary(library);
    setStatus(`Imported ${imported.length} Pen${imported.length === 1 ? "" : "s"} from ZIP.`, "success");
  } catch (error) {
    setStatus(error instanceof Error ? error.message : "Could not import this ZIP.", "error");
  }
}

async function importHtmlFolder(event: Event): Promise<void> {
  const input = event.currentTarget as HTMLInputElement;
  const allHtmlFiles = Array.from(input.files || []).filter((file) => file.name.toLowerCase().endsWith(".html"));
  const files = allHtmlFiles.filter((file) => !isDuplicateArchiveFile(file));
  const skippedDuplicates = allHtmlFiles.length - files.length;
  input.value = "";
  if (!files.length) {
    if (skippedDuplicates) {
      setStatus(`Skipped ${skippedDuplicates} file${skippedDuplicates === 1 ? "" : "s"} from _duplicates.`, "info");
    }
    return;
  }

  const candidates: HtmlImportCandidate[] = [];
  for (const file of files) {
    const html = await file.text();
    const sourceKey = importedSourceKey(file, html);
    candidates.push({
      file,
      html,
      sourceKey,
      quality: importedSourceQuality(html)
    });
  }

  const bestQualityBySource = new Map<string, number>();
  for (const candidate of candidates) {
    if (!candidate.sourceKey) {
      continue;
    }

    bestQualityBySource.set(
      candidate.sourceKey,
      Math.max(bestQualityBySource.get(candidate.sourceKey) || 0, candidate.quality)
    );
  }

  const importable = candidates.filter((candidate) => {
    if (!candidate.sourceKey) {
      return true;
    }

    return candidate.quality > 0 || (bestQualityBySource.get(candidate.sourceKey) || 0) <= 0;
  });
  const skippedEmptyPlaceholders = candidates.length - importable.length;
  const imported = importable.map(({ file, html }) => penFromHtmlFile(file, html));

  library = await upsertPens(imported);
  await saveLibrary(library);
  setStatus(
    `Imported ${imported.length} HTML file${imported.length === 1 ? "" : "s"} from folder${
      skippedDuplicates ? ` and skipped ${skippedDuplicates} duplicate archive file${skippedDuplicates === 1 ? "" : "s"}` : ""
    }${skippedEmptyPlaceholders ? ` and skipped ${skippedEmptyPlaceholders} empty placeholder file${skippedEmptyPlaceholders === 1 ? "" : "s"}` : ""}.`,
    "success"
  );
}

async function loadBundledSeed(): Promise<SavedPen[]> {
  try {
    const response = await fetch("./imports/codepen-library-seed.json", { cache: "no-store" });
    if (!response.ok) {
      return [];
    }

    const seed = (await response.json()) as SavedPen[];
    return Array.isArray(seed) ? seed : [];
  } catch {
    return [];
  }
}

function penFromHtmlFile(file: File, html: string): SavedPen {
  const document = new DOMParser().parseFromString(html, "text/html");
  const source = document.querySelector<HTMLMetaElement>('meta[name="codepen:source"]')?.content || "";
  const importedSourceMode = document.querySelector<HTMLMetaElement>('meta[name="codepen:source-mode"]')?.content || "";
  const parsed = source ? parseCodePenSource(source) : null;
  const title = decodeText(document.querySelector("title")?.textContent || stripHtmlExtension(file.name));
  const relativePath = importedRelativePath(file);
  const folder = sanitizeFolder(relativePath.split("/").slice(1, -1).join("/"));
  const sourceMode: SavedPen["sourceMode"] =
    importedSourceMode === "uncombined"
      ? "separated-source"
      : html.includes("Pen Not Found or Not Available as a Resource")
        ? "page-html"
        : "raw-files";

  const pen: SavedPen = {
    author: parsed?.user || "",
    canonicalUrl: parsed?.canonicalUrl || "",
    filename: file.name,
    folder,
    html: normalizeImportedHtml(title, source, html),
    id: parsed ? `${parsed.user}/${parsed.slug}` : `local/${relativePath.replace(/\\/g, "/")}`,
    savedAt: new Date(file.lastModified || Date.now()).toISOString(),
    slug: parsed?.slug || stripHtmlExtension(file.name),
    sourceMode,
    tags: sourceMode === "separated-source" ? ["uncombined", "needs-refactor"] : [],
    thumbnailUrl: parsed ? `https://codepen.io/${parsed.user}/pen/${parsed.slug}/image/small.png` : "",
    title,
    user: parsed?.user || "local"
  };
  return {
    ...pen,
    thumbnailUrl: pen.thumbnailUrl || generatedThumbnail(pen)
  };
}

function isDuplicateArchiveFile(file: File): boolean {
  return importedRelativePath(file)
    .split("/")
    .some((part) => part.toLowerCase() === "_duplicates");
}

function importedRelativePath(file: File): string {
  return (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name;
}

type HtmlImportCandidate = {
  file: File;
  html: string;
  quality: number;
  sourceKey: string;
};

function importedSourceKey(file: File, html: string): string {
  const document = new DOMParser().parseFromString(html, "text/html");
  const source = document.querySelector<HTMLMetaElement>('meta[name="codepen:source"]')?.content.trim() || "";
  if (source) {
    const parsed = parseCodePenSource(source);
    return parsed ? `${parsed.user}/${parsed.slug}`.toLowerCase() : source.toLowerCase();
  }

  return `local/${importedRelativePath(file).replace(/\s+\(\d+\)(?=\.html?$)/i, "").toLowerCase()}`;
}

function importedSourceQuality(html: string): number {
  const lower = html.toLowerCase();
  const snippetMarkers = [
    ["codepen html box start", "html box was empty or could not be fetched"],
    ["codepen css box start", "css box was empty or could not be fetched"],
    ["codepen js box start", "js box was empty or could not be fetched"]
  ] as const;

  if (snippetMarkers.some(([marker]) => lower.includes(marker))) {
    return snippetMarkers.filter(([marker, placeholder]) => lower.includes(marker) && !lower.includes(placeholder)).length;
  }

  if (
    lower.includes("fetch blocked notice") ||
    lower.includes("pen not found or not available as a resource") ||
    lower.includes("this local file could not be reconstructed")
  ) {
    return 0;
  }

  return html.trim().length ? 1 : 0;
}

function normalizeImportedHtml(title: string, source: string, html: string): string {
  if (!isUnavailableImportedHtml(html)) {
    return html;
  }

  const liveUrl = source ? livePreviewUrl(source) : "";
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)}</title>
  <meta name="generator" content="CodePen Library Saver">
  ${source ? `<meta name="codepen:source" content="${escapeAttribute(source)}">` : ""}
  <style>
    html,
    body {
      width: 100%;
      height: 100%;
      margin: 0;
    }
    body {
      display: grid;
      grid-template-rows: auto 1fr;
      color: #16181d;
      font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      line-height: 1.5;
    }
    header {
      padding: 12px 14px;
      border-bottom: 1px solid #d8dde6;
      background: #fff;
    }
    h1 {
      margin: 0 0 4px;
      font-size: 16px;
    }
    p {
      margin: 0;
      color: #4d5563;
      font-size: 13px;
    }
    a { color: #175cff; }
    iframe {
      width: 100%;
      height: 100%;
      border: 0;
      background: #fff;
    }
  </style>
</head>
<body>
  <header>
    <h1>${escapeHtml(title)}</h1>
    <p>The original source was not present in this local file.${source ? ` Showing a live CodePen preview. <a href="${escapeAttribute(source)}">Open original</a>.` : ""}</p>
  </header>
  ${
    liveUrl
      ? `<iframe title="${escapeAttribute(title)} live CodePen preview" src="${escapeAttribute(liveUrl)}" allow="accelerometer; camera; encrypted-media; geolocation; gyroscope; microphone; midi; clipboard-read; clipboard-write; web-share"></iframe>`
      : `<main style="padding: 32px"><p>No CodePen source URL was found, so this file cannot be reconstructed automatically.</p></main>`
  }
</body>
</html>`;
}

function isUnavailableImportedHtml(html: string): boolean {
  const lower = html.toLowerCase();
  return (
    html.includes("Pen Not Found or Not Available as a Resource") ||
    html.includes("This local file could not be reconstructed") ||
    (
      lower.includes("fetch blocked notice") &&
      lower.includes("html box was empty or could not be fetched") &&
      lower.includes("css box was empty or could not be fetched") &&
      lower.includes("js box was empty or could not be fetched")
    )
  );
}

function livePreviewUrl(source: string): string {
  const parsed = parseCodePenSource(source);
  return parsed ? `https://codepen.io/${parsed.user}/embed/${parsed.slug}?default-tab=result&theme-id=light` : source;
}

function parseCodePenSource(source: string): { canonicalUrl: string; slug: string; user: string } | null {
  try {
    const url = new URL(source);
    const match = url.pathname.match(/^\/([^/]+)\/(?:pen|full|debug|details)\/([A-Za-z0-9_-]+)/);
    if (!match) {
      return null;
    }

    const [, user, slug] = match;
    return {
      canonicalUrl: `https://codepen.io/${user}/pen/${slug}`,
      slug,
      user
    };
  } catch {
    return null;
  }
}

async function downloadPen(pen: SavedPen, saveAs: boolean, overwrite = false): Promise<SavedPen> {
  const blob = new Blob([pen.html], { type: "text/html;charset=utf-8" });
  const folderParts = [sanitizeFolder(settings.downloadFolder), sanitizeFolder(pen.folder || "")].filter(Boolean);
  const filename = `${folderParts.join("/")}/${pen.filename}`;
  const downloadId = await downloadBlob(blob, filename, saveAs, overwrite);

  return {
    ...pen,
    lastDownloadId: downloadId || pen.lastDownloadId
  };
}

async function downloadText(content: string, filename: string, type: string, saveAs: boolean): Promise<void> {
  await downloadBlob(new Blob([content], { type }), `${sanitizeFolder(settings.downloadFolder)}/${filename}`, saveAs);
}

async function downloadBlob(blob: Blob, filename: string, saveAs: boolean, overwrite = false): Promise<number | undefined> {
  const url = URL.createObjectURL(blob);
  const chromeApi = getChrome();

  try {
    const downloads = chromeApi?.downloads;
    if (!downloads) {
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = filename.split("/").pop() || filename;
      anchor.click();
      return undefined;
    }

    return await new Promise<number | undefined>((resolve) => {
      downloads.download({ filename, saveAs, url, conflictAction: overwrite ? "overwrite" : "uniquify" }, resolve);
    });
  } finally {
    window.setTimeout(() => URL.revokeObjectURL(url), 500);
  }
}

function composeCombinedHtml(pens: SavedPen[]): string {
  return pens
    .map((pen, index) => {
      const start = [
        "",
        `<!-- CODEPEN ${index + 1} START -->`,
        `<!-- Title: ${escapeComment(pen.title)} -->`,
        `<!-- Original: ${escapeComment(pen.canonicalUrl)} -->`,
        `<!-- Folder: ${escapeComment(pen.folder || "")} -->`,
        `<!-- Tags: ${escapeComment((pen.tags || []).join(", "))} -->`,
        ""
      ].join("\n");
      const end = `\n<!-- CODEPEN ${index + 1} END -->\n`;
      return `${start}${pen.html}${end}`;
    })
    .join("\n");
}

function readCardMetadata(card: HTMLElement, pen: SavedPen): SavedPen {
  const folder = sanitizeFolder(card.querySelector<HTMLInputElement>(".meta-folder")?.value || "");
  const tags = parseTags(card.querySelector<HTMLInputElement>(".meta-tags")?.value || "");
  return {
    ...pen,
    folder,
    tags
  };
}

async function markPenAccessed(id: string): Promise<void> {
  const pen = library.find((item) => item.id === id);
  if (!pen) {
    return;
  }

  const updated = {
    ...pen,
    lastAccessedAt: new Date().toISOString()
  };
  library = library.map((item) => (item.id === id ? updated : item));
  await updatePen(updated);
}

function getVisiblePens(): SavedPen[] {
  const term = searchTerm.toLowerCase();
  const tagFilter = settings.tagFilter.toLowerCase();
  return library
    .filter((pen) => {
      const haystack = [
        pen.title,
        pen.author,
        pen.slug,
        pen.filename,
        pen.folder,
        pen.sourceMode,
        ...(pen.tags || [])
      ].join(" ").toLowerCase();
      const matchesSearch = haystack.includes(term);
      const matchesTag = !tagFilter || (pen.tags || []).some((tag) => tag.toLowerCase() === tagFilter);
      return matchesSearch && matchesTag;
    })
    .sort(comparePens);
}

function getSelectedPens(): SavedPen[] {
  return library.filter((pen) => selectedIds.has(pen.id));
}

function getFolders(): string[] {
  return Array.from(new Set(library.map((pen) => pen.folder || "").filter(Boolean))).sort();
}

function getTags(): string[] {
  return Array.from(new Set(library.flatMap((pen) => pen.tags || []))).sort();
}

function comparePens(a: SavedPen, b: SavedPen): number {
  const direction = settings.sortDirection === "asc" ? 1 : -1;
  const valueA = sortValue(a);
  const valueB = sortValue(b);

  if (valueA < valueB) {
    return -1 * direction;
  }

  if (valueA > valueB) {
    return 1 * direction;
  }

  return a.title.localeCompare(b.title);
}

function sortValue(pen: SavedPen): string | number {
  if (settings.sortBy === "savedAt") {
    return Date.parse(pen.savedAt || "") || 0;
  }

  if (settings.sortBy === "lastAccessedAt") {
    return Date.parse(pen.lastAccessedAt || pen.savedAt || "") || 0;
  }

  if (settings.sortBy === "tags") {
    return (pen.tags || []).join(" ").toLowerCase() || "zzzz";
  }

  return pen.title.toLowerCase();
}

function sourceModeLabel(sourceMode: SavedPen["sourceMode"]): string {
  if (sourceMode === "separated-source") {
    return "Uncombined source";
  }

  if (sourceMode === "debug-html") {
    return "Standalone";
  }

  if (sourceMode === "page-html") {
    return "Fallback page";
  }

  return "Raw files";
}

function defaultBatchFolder(): string {
  return `Open CodePens ${new Date().toISOString().slice(0, 10)}`;
}

function zipPathForPen(pen: SavedPen): string {
  return `${sanitizeFolder(pen.folder || "Unsorted")}/${pen.filename}`;
}

function expectedDownloadSuffix(pen: SavedPen): string {
  const parts = [sanitizeFolder(settings.downloadFolder) || "CodePen Library", sanitizeFolder(pen.folder || ""), pen.filename].filter(Boolean);
  return `/${normalizeDownloadPath(parts.join("/"))}`;
}

function parseTags(value: string): string[] {
  return Array.from(
    new Set(
      value
        .split(",")
        .map((tag) => tag.trim().replace(/^#/, ""))
        .filter(Boolean)
    )
  );
}

async function copyText(value: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    const textarea = document.createElement("textarea");
    textarea.value = value;
    textarea.style.position = "fixed";
    textarea.style.left = "-9999px";
    document.body.append(textarea);
    textarea.focus();
    textarea.select();
    try {
      return document.execCommand("copy");
    } catch {
      return false;
    } finally {
      textarea.remove();
    }
  }
}

type ChromeDownloadItem = {
  exists?: boolean;
  filename?: string;
  id: number;
  startTime?: string;
  state?: "complete" | "in_progress" | "interrupted";
};

type ChromeDownloadSearchQuery = {
  limit?: number;
  orderBy?: string[];
  query?: string[];
  state?: "complete" | "in_progress" | "interrupted";
};

type ChromeSidePanelApi = {
  downloads?: {
    download(
      options: { conflictAction?: "uniquify" | "overwrite" | "prompt"; filename: string; saveAs?: boolean; url: string },
      callback?: (downloadId?: number) => void
    ): void;
    search?(query: ChromeDownloadSearchQuery, callback: (items: ChromeDownloadItem[]) => void): void;
    show?(downloadId: number): boolean | void;
    showDefaultFolder?(): void;
  };
  runtime?: {
    sendMessage(message: RuntimeRequest, callback: (response: RuntimeResponse) => void): void;
  };
};

function getChrome(): ChromeSidePanelApi | undefined {
  return (globalThis as { chrome?: ChromeSidePanelApi }).chrome;
}

function setStatus(message: string, tone: ToastTone, rerender = true): void {
  statusText = message;
  statusTone = tone;
  if (rerender) {
    render();
    return;
  }

  const status = document.querySelector<HTMLElement>(".status");
  if (status) {
    status.textContent = message;
    status.className = `status ${tone}`;
  }
}

function sanitizeFolder(value: string): string {
  return value
    .replace(/\\/g, "/")
    .split("/")
    .map((part) => part.replace(/[<>:"|?*]+/g, "").trim())
    .filter(Boolean)
    .join("/");
}

function normalizeDownloadPath(value: string): string {
  return value.replace(/\\/g, "/").replace(/\/+/g, "/").toLowerCase();
}

function clampGridColumns(value: number): number {
  if (!Number.isFinite(value)) {
    return 1;
  }

  return Math.min(4, Math.max(1, Math.round(value)));
}

function clampTextScale(value: number): number {
  if (!Number.isFinite(value)) {
    return 0.68;
  }

  return Math.min(1.8, Math.max(0.4, Number(value.toFixed(2))));
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escapeAttribute(value: string): string {
  return escapeHtml(value).replace(/'/g, "&#39;");
}

function escapeComment(value: string): string {
  return value.replace(/--/g, "- -");
}

function stripHtmlExtension(filename: string): string {
  return filename.replace(/\.html?$/i, "");
}

function decodeText(value: string): string {
  const textarea = document.createElement("textarea");
  textarea.innerHTML = value;
  return textarea.value;
}

function generatedThumbnail(pen: Pick<SavedPen, "folder" | "sourceMode" | "tags" | "title" | "user">): string {
  const palette = paletteFor(pen.title);
  const title = truncateSvgText(pen.title || "Untitled Pen", 24);
  const user = truncateSvgText(pen.user || "local", 18);
  const folder = truncateSvgText(pen.folder || pen.sourceMode || "saved html", 20);
  const tags = truncateSvgText((pen.tags || []).slice(0, 2).map((tag) => `#${tag}`).join(" ") || "standalone", 22);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="220" viewBox="0 0 320 220">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${palette[0]}"/>
      <stop offset="1" stop-color="${palette[1]}"/>
    </linearGradient>
    <filter id="blur"><feGaussianBlur stdDeviation="18"/></filter>
  </defs>
  <rect width="320" height="220" fill="url(#bg)"/>
  <circle cx="250" cy="38" r="70" fill="${palette[2]}" opacity=".55" filter="url(#blur)"/>
  <circle cx="58" cy="188" r="84" fill="#ffffff" opacity=".18" filter="url(#blur)"/>
  <rect x="22" y="24" width="276" height="172" rx="12" fill="rgba(255,255,255,.78)" stroke="rgba(255,255,255,.72)"/>
  <text x="42" y="64" fill="#111827" font-family="Inter, Segoe UI, Arial, sans-serif" font-size="24" font-weight="750">${escapeSvg(title)}</text>
  <text x="42" y="94" fill="#334155" font-family="Inter, Segoe UI, Arial, sans-serif" font-size="15" font-weight="650">${escapeSvg(user)}</text>
  <rect x="42" y="120" width="118" height="26" rx="7" fill="${palette[3]}" opacity=".95"/>
  <text x="54" y="138" fill="#ffffff" font-family="Inter, Segoe UI, Arial, sans-serif" font-size="12" font-weight="700">${escapeSvg(folder)}</text>
  <text x="42" y="172" fill="#475569" font-family="Inter, Segoe UI, Arial, sans-serif" font-size="13" font-weight="700">${escapeSvg(tags)}</text>
</svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function paletteFor(value: string): [string, string, string, string] {
  const palettes: Array<[string, string, string, string]> = [
    ["#dbeafe", "#fde68a", "#fb7185", "#2563eb"],
    ["#dcfce7", "#bfdbfe", "#a78bfa", "#16a34a"],
    ["#fae8ff", "#cffafe", "#f59e0b", "#9333ea"],
    ["#fee2e2", "#e0e7ff", "#22c55e", "#dc2626"],
    ["#f5f5f4", "#bae6fd", "#f472b6", "#0f766e"]
  ];
  let hash = 0;
  for (const char of value) {
    hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  }
  return palettes[hash % palettes.length];
}

function truncateSvgText(value: string, maxLength: number): string {
  const codePoints = Array.from(stripLoneSurrogates(value));
  return codePoints.length > maxLength ? `${codePoints.slice(0, maxLength - 1).join("")}…` : codePoints.join("");
}

function stripLoneSurrogates(value: string): string {
  return value.replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, "�");
}

function escapeSvg(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const icons = {
  archive: icon("M21 8v13H3V8 M1 3h22v5H1z M10 12h4"),
  check: icon("M20 6 9 17l-5-5"),
  chevronDown: icon("M6 9l6 6 6-6"),
  chevronUp: icon("M18 15l-6-6-6 6"),
  copy: icon("M8 8h10v12H8z M6 16H4V4h12v2"),
  download: icon("M12 3v12 M7 10l5 5 5-5 M5 21h14"),
  external: icon("M14 3h7v7 M10 14 21 3 M21 14v7H3V3h7"),
  folder: icon("M3 6h6l2 2h10v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"),
  folderOpen: icon("M3 7h5l2 2h11l-2 10H4L2 9a2 2 0 0 1 2-2z M3 7V5a2 2 0 0 1 2-2h4l2 2h4a2 2 0 0 1 2 2v2"),
  package: icon("M21 8 12 3 3 8l9 5 9-5z M3 8v8l9 5 9-5V8 M12 13v8"),
  refresh: icon("M4 4v6h6 M20 20v-6h-6 M5 15a7 7 0 0 0 12 3 M19 9A7 7 0 0 0 7 6"),
  save: icon("M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z M17 21v-8H7v8 M7 3v5h8"),
  search: icon("M21 21l-4.3-4.3 M11 18a7 7 0 1 1 0-14 7 7 0 0 1 0 14z"),
  tabs: icon("M10 4h10v12H10z M4 8h10v12H4z"),
  trash: icon("M3 6h18 M8 6V4h8v2 M6 6l1 15h10l1-15"),
  upload: icon("M12 21V9 M7 14l5-5 5 5 M5 3h14")
};

function icon(path: string): string {
  return `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${path}" /></svg>`;
}
