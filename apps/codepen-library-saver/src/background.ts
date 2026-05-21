import { enrichCodePen, parseCodePenUrl } from "./codepen";
import { getSettings } from "./storage";
import type { CodePenMeta, PenPageSource, RuntimeRequest, RuntimeResponse } from "./types";

async function enrichOptions(): Promise<{ deepseekApiKey: string }> {
  try {
    const settings = await getSettings();
    return { deepseekApiKey: settings.deepseekApiKey || "" };
  } catch {
    return { deepseekApiKey: "" };
  }
}

declare const chrome: {
  action: {
    onClicked: {
      addListener(callback: (tab: { id?: number; url?: string; title?: string; windowId?: number }) => void): void;
    };
  };
  runtime: {
    onInstalled: {
      addListener(callback: () => void): void;
    };
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
  sidePanel?: {
    open(options: { tabId?: number; windowId?: number }): Promise<void>;
    setPanelBehavior(options: { openPanelOnActionClick: boolean }): Promise<void>;
  };
  tabs: {
    query(
      queryInfo:
        | { active: boolean; currentWindow: boolean }
        | { url: string[] },
      callback: (tabs: Array<{ id?: number; url?: string; title?: string; windowId?: number }>) => void
    ): void;
    sendMessage(
      tabId: number,
      message: RuntimeRequest,
      callback: (response?: RuntimeResponse) => void
    ): void;
    update(
      tabId: number,
      updateProperties: { active?: boolean },
      callback?: (tab?: { id?: number }) => void
    ): void;
  };
  windows?: {
    update(
      windowId: number,
      updateInfo: { focused?: boolean },
      callback?: () => void
    ): void;
  };
};

chrome.runtime.onInstalled.addListener(() => {
  void chrome.sidePanel?.setPanelBehavior({ openPanelOnActionClick: true });
});

chrome.action.onClicked.addListener((tab) => {
  if (!chrome.sidePanel) {
    return;
  }

  if (tab.id) {
    void chrome.sidePanel.open({ tabId: tab.id });
    return;
  }

  if (tab.windowId) {
    void chrome.sidePanel.open({ windowId: tab.windowId });
  }
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === "SAVE_CURRENT_PEN") {
    void saveCurrentPen()
      .then((pen) => sendResponse({ ok: true, pen }))
      .catch((error: unknown) =>
        sendResponse({
          ok: false,
          error: error instanceof Error ? error.message : "Could not save this CodePen."
        })
      );

    return true;
  }

  if (message.type === "SAVE_OPEN_CODEPEN_TABS") {
    void saveOpenCodePenTabs()
      .then((pens) => sendResponse({ ok: true, pens }))
      .catch((error: unknown) =>
        sendResponse({
          ok: false,
          error: error instanceof Error ? error.message : "Could not save open CodePen tabs."
        })
      );

    return true;
  }

  if (message.type === "REPAIR_SAVED_PENS") {
    void repairSavedPens(message.pens)
      .then((pens) => sendResponse({ ok: true, pens }))
      .catch((error: unknown) =>
        sendResponse({
          ok: false,
          error: error instanceof Error ? error.message : "Could not repair saved CodePens."
        })
      );

    return true;
  }

    return false;
});

async function saveCurrentPen() {
  const tab = await getActiveTab();
  if (!tab?.url || !tab.id) {
    throw new Error("Open a CodePen tab first, then try saving again.");
  }

  const parsed = parseCodePenUrl(tab.url);
  if (!parsed) {
    throw new Error("This tab does not look like a CodePen Pen URL.");
  }

  const pageMeta = await collectFromContentScript(tab.id);
  const meta: CodePenMeta = {
    ...parsed,
    author: pageMeta?.author,
    canonicalUrl: pageMeta?.canonicalUrl || parsed.canonicalUrl,
    thumbnailUrl: pageMeta?.thumbnailUrl,
    title: pageMeta?.title || tab.title || "Untitled Pen"
  };

  const prefetched = await fetchSourceFromContentScript(tab.id, parsed.user, parsed.slug);

  return enrichCodePen(meta, { ...(await enrichOptions()), prefetched });
}

async function saveOpenCodePenTabs() {
  const tabs = await getOpenCodePenTabs();
  type Candidate = {
    id?: number;
    url?: string;
    title?: string;
    windowId?: number;
    parsed: NonNullable<ReturnType<typeof parseCodePenUrl>>;
  };
  const candidates = new Map<string, Candidate>();

  for (const tab of tabs) {
    if (!tab.url) {
      continue;
    }

    const parsed = parseCodePenUrl(tab.url);
    if (parsed) {
      candidates.set(`${parsed.user}/${parsed.slug}`, { ...tab, parsed });
    }
  }

  if (!candidates.size) {
    throw new Error("No open CodePen Pen tabs were found.");
  }

  const startingActive = await getActiveTab();
  const pens: Awaited<ReturnType<typeof enrichCodePen>>[] = [];
  const options = await enrichOptions();
  for (const tab of candidates.values()) {
    if (tab.id) {
      await activateTab(tab.id, tab.windowId);
      await delay(350);
    }

    const pageMeta = tab.id ? await collectFromContentScript(tab.id) : null;
    const meta: CodePenMeta = {
      ...tab.parsed,
      author: pageMeta?.author,
      canonicalUrl: pageMeta?.canonicalUrl || tab.parsed.canonicalUrl,
      thumbnailUrl: pageMeta?.thumbnailUrl,
      title: pageMeta?.title || tab.title || "Untitled Pen"
    };

    const prefetched = tab.id
      ? await fetchSourceFromContentScript(tab.id, tab.parsed.user, tab.parsed.slug)
      : null;

    pens.push(await enrichCodePen(meta, { ...options, prefetched }));
  }

  if (startingActive?.id) {
    await activateTab(startingActive.id);
  }

  return pens;
}

async function repairSavedPens(pens: Array<Awaited<ReturnType<typeof enrichCodePen>>>) {
  if (!pens.length) {
    throw new Error("There are no saved Pens to repair.");
  }

  const repaired = [];
  const options = await enrichOptions();
  for (const pen of pens) {
    const fresh = await enrichCodePen(pen, options);
    repaired.push({
      ...fresh,
      folder: pen.folder || fresh.folder,
      lastDownloadId: pen.lastDownloadId,
      savedAt: pen.savedAt,
      tags: pen.tags?.length ? pen.tags : fresh.tags
    });
  }

  return repaired;
}

async function getActiveTab(): Promise<{ id?: number; url?: string; title?: string } | undefined> {
  return new Promise((resolve) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => resolve(tabs[0]));
  });
}

async function getOpenCodePenTabs(): Promise<Array<{ id?: number; url?: string; title?: string }>> {
  return new Promise((resolve) => {
    chrome.tabs.query({ url: ["https://codepen.io/*/pen/*", "https://codepen.io/*/full/*", "https://codepen.io/*/debug/*"] }, resolve);
  });
}

async function collectFromContentScript(tabId: number): Promise<CodePenMeta | null> {
  return new Promise((resolve) => {
    chrome.tabs.sendMessage(tabId, { type: "COLLECT_CODEPEN_PAGE" }, (response?: RuntimeResponse) => {
      if (response?.ok && "meta" in response) {
        resolve(response.meta);
        return;
      }

      resolve(null);
    });
  });
}

async function fetchSourceFromContentScript(
  tabId: number,
  user: string,
  slug: string
): Promise<PenPageSource | null> {
  return new Promise((resolve) => {
    chrome.tabs.sendMessage(
      tabId,
      { type: "FETCH_PEN_SOURCE", user, slug },
      (response?: RuntimeResponse) => {
        if (response?.ok && "source" in response) {
          resolve(response.source);
          return;
        }

        resolve(null);
      }
    );
  });
}

async function activateTab(tabId: number, windowId?: number): Promise<void> {
  return new Promise((resolve) => {
    chrome.tabs.update(tabId, { active: true }, () => {
      if (typeof windowId === "number" && chrome.windows) {
        chrome.windows.update(windowId, { focused: true }, () => resolve());
        return;
      }
      resolve();
    });
  });
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
