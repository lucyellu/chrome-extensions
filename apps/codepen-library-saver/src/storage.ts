import type { LibrarySettings, SavedPen } from "./types";

type ChromeStorageApi = {
  storage: {
    local: {
      get(keys: string[], callback: (items: Record<string, unknown>) => void): void;
      set(items: Record<string, unknown>, callback?: () => void): void;
    };
  };
};

const libraryKey = "codepenLibrary";
const settingsKey = "codepenLibrarySettings";

export async function getLibrary(): Promise<SavedPen[]> {
  const data = await getStorage([libraryKey]);
  return Array.isArray(data[libraryKey]) ? normalizeLibrary(data[libraryKey] as SavedPen[]) : [];
}

export async function saveLibrary(pens: SavedPen[]): Promise<void> {
  await setStorage({ [libraryKey]: pens });
}

export async function upsertPen(pen: SavedPen): Promise<SavedPen[]> {
  const library = await getLibrary();
  const matchKey = libraryKeyFor(pen);
  const existing = library.find((item) => libraryKeyFor(item) === matchKey);
  const merged = existing
    ? {
        ...existing,
        ...pen,
        folder: pen.folder ?? existing.folder,
        tags: pen.tags ?? existing.tags
      }
    : pen;
  const withoutCurrent = library.filter((item) => libraryKeyFor(item) !== matchKey);
  const next = [normalizePen(merged), ...withoutCurrent];
  await saveLibrary(next);
  return next;
}

export async function upsertPens(pens: SavedPen[]): Promise<SavedPen[]> {
  let library = await getLibrary();
  for (const pen of pens) {
    const matchKey = libraryKeyFor(pen);
    const existing = library.find((item) => libraryKeyFor(item) === matchKey);
    const merged = normalizePen(
      existing
        ? {
            ...existing,
            ...pen,
            folder: pen.folder ?? existing.folder,
            tags: pen.tags ?? existing.tags
          }
        : pen
    );
    library = [merged, ...library.filter((item) => libraryKeyFor(item) !== matchKey)];
  }

  await saveLibrary(library);
  return library;
}

export async function removePen(id: string): Promise<SavedPen[]> {
  const library = await getLibrary();
  const next = library.filter((item) => item.id !== id);
  await saveLibrary(next);
  return next;
}

export async function updatePen(pen: SavedPen): Promise<SavedPen[]> {
  const library = await getLibrary();
  const next = library.map((item) => (item.id === pen.id ? normalizePen(pen) : item));
  await saveLibrary(next);
  return next;
}

export async function getSettings(): Promise<LibrarySettings> {
  const data = await getStorage([settingsKey]);
  const settings = data[settingsKey] as Partial<LibrarySettings> | undefined;
  return {
    cardSize: clampGridColumns(settings?.cardSize),
    deepseekApiKey: typeof settings?.deepseekApiKey === "string" ? settings.deepseekApiKey : "",
    downloadFolder: settings?.downloadFolder || "CodePen Library",
    lockTextToThumbnail: settings?.lockTextToThumbnail ?? false,
    settingsExpanded: settings?.settingsExpanded ?? false,
    sortBy: settings?.sortBy || "savedAt",
    sortDirection: settings?.sortDirection || "desc",
    tagFilter: settings?.tagFilter || "",
    textScale: clampTextScale(settings?.textScale)
  };
}

export async function saveSettings(settings: LibrarySettings): Promise<void> {
  await setStorage({ [settingsKey]: settings });
}

function getStorage(keys: string[]): Promise<Record<string, unknown>> {
  const chromeApi = getChrome();
  if (!chromeApi) {
    return Promise.resolve(
      Object.fromEntries(keys.map((key) => [key, readLocalStorage(key)]))
    );
  }

  return new Promise((resolve) => chromeApi.storage.local.get(keys, resolve));
}

function setStorage(items: Record<string, unknown>): Promise<void> {
  const chromeApi = getChrome();
  if (!chromeApi) {
    for (const [key, value] of Object.entries(items)) {
      window.localStorage.setItem(key, JSON.stringify(value));
    }

    return Promise.resolve();
  }

  return new Promise((resolve) => chromeApi.storage.local.set(items, resolve));
}

function getChrome(): ChromeStorageApi | undefined {
  const chromeApi = (globalThis as { chrome?: Partial<ChromeStorageApi> }).chrome;
  return chromeApi?.storage?.local ? (chromeApi as ChromeStorageApi) : undefined;
}

function readLocalStorage(key: string): unknown {
  const value = window.localStorage.getItem(key);
  if (!value) {
    return undefined;
  }

  try {
    return JSON.parse(value) as unknown;
  } catch {
    return undefined;
  }
}

function normalizeLibrary(pens: SavedPen[]): SavedPen[] {
  return pens.map(normalizePen);
}

function normalizePen(pen: SavedPen): SavedPen {
  return {
    ...pen,
    folder: pen.folder || "",
    lastAccessedAt: pen.lastAccessedAt || "",
    thumbnailUrl: pen.thumbnailUrl || "",
    tags: Array.isArray(pen.tags) ? pen.tags : []
  };
}

function libraryKeyFor(pen: SavedPen): string {
  return `${pen.id}|${pen.folder || ""}|${pen.filename}`;
}

function clampGridColumns(value: unknown): number {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return 1;
  }

  if (value > 12) {
    return 1;
  }

  return Math.min(4, Math.max(1, Math.round(value)));
}

function clampTextScale(value: unknown): number {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return 0.68;
  }

  return Math.min(1.8, Math.max(0.4, Number(value.toFixed(2))));
}
