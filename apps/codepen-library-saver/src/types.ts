export type CodePenMeta = {
  author?: string;
  canonicalUrl: string;
  fetchedFrom?: string;
  slug: string;
  thumbnailUrl?: string;
  title: string;
  user: string;
};

export type SavedPen = CodePenMeta & {
  filename: string;
  folder?: string;
  html: string;
  id: string;
  lastAccessedAt?: string;
  lastDownloadId?: number;
  savedAt: string;
  sourceMode: "raw-files" | "debug-html" | "page-html" | "separated-source" | "ai-integrated";
  tags?: string[];
};

export type LibrarySettings = {
  cardSize: number;
  deepseekApiKey: string;
  downloadFolder: string;
  lockTextToThumbnail: boolean;
  settingsExpanded: boolean;
  sortBy: "savedAt" | "lastAccessedAt" | "tags" | "title";
  sortDirection: "asc" | "desc";
  tagFilter: string;
  textScale: number;
};

export type PenPageSource = {
  debugHtml: string;
  html: string;
  css: string;
  js: string;
};

export type RuntimeRequest =
  | { type: "COLLECT_CODEPEN_PAGE" }
  | { type: "FETCH_PEN_SOURCE"; user: string; slug: string }
  | { type: "SAVE_CURRENT_PEN" }
  | { type: "SAVE_OPEN_CODEPEN_TABS" }
  | { type: "REPAIR_SAVED_PENS"; pens: SavedPen[] };

export type RuntimeResponse =
  | { ok: true; pen: SavedPen }
  | { ok: true; pens: SavedPen[] }
  | { ok: true; meta: CodePenMeta }
  | { ok: true; source: PenPageSource }
  | { ok: false; error: string };
