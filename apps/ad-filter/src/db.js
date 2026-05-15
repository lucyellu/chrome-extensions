const DB_NAME = "smart-ad-filter";
const DB_VERSION = 1;
const STORE_EVENTS = "adEvents";
const STORE_SETTINGS = "settings";

let dbPromise;

export function openDatabase() {
  if (dbPromise) {
    return dbPromise;
  }

  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;

      if (!db.objectStoreNames.contains(STORE_EVENTS)) {
        const events = db.createObjectStore(STORE_EVENTS, { keyPath: "id" });
        events.createIndex("createdAt", "createdAt");
        events.createIndex("decision", "decision");
        events.createIndex("status", "status");
        events.createIndex("adDomain", "adDomain");
      }

      if (!db.objectStoreNames.contains(STORE_SETTINGS)) {
        db.createObjectStore(STORE_SETTINGS, { keyPath: "key" });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

  return dbPromise;
}

function transaction(storeName, mode = "readonly") {
  return openDatabase().then((db) => db.transaction(storeName, mode).objectStore(storeName));
}

function requestToPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function getHostname(value) {
  try {
    return new URL(value).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

function normalizeEvent(event) {
  const now = new Date().toISOString();
  const adUrl = event.adUrl || event.url || "";
  const pageUrl = event.pageUrl || "";

  return {
    id: event.id || crypto.randomUUID(),
    createdAt: event.createdAt || now,
    updatedAt: now,
    source: event.source || "unknown",
    adUrl,
    adDomain: event.adDomain || getHostname(adUrl),
    pageUrl,
    pageDomain: event.pageDomain || getHostname(pageUrl),
    pageTitle: event.pageTitle || "",
    resourceType: event.resourceType || "",
    ruleId: event.ruleId || null,
    rulesetId: event.rulesetId || "",
    decision: event.decision || null,
    status: event.status || "unseen",
    tags: Array.isArray(event.tags) ? event.tags : [],
    notes: event.notes || "",
    snapshot: normalizeSnapshot(event.snapshot),
    recommendedBy: event.recommendedBy || null,
    recommendationMeta: event.recommendationMeta || null
  };
}

function normalizeSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== "object") {
    return null;
  }

  return {
    capturedAt: snapshot.capturedAt || new Date().toISOString(),
    selector: String(snapshot.selector || "").slice(0, 120),
    text: String(snapshot.text || "").slice(0, 1000),
    html: String(snapshot.html || "").slice(0, 4000),
    linkUrl: String(snapshot.linkUrl || "").slice(0, 1000),
    imageUrl: String(snapshot.imageUrl || "").slice(0, 1000)
  };
}

export async function addAdEvent(event) {
  const store = await transaction(STORE_EVENTS, "readwrite");
  const normalized = normalizeEvent(event);
  await requestToPromise(store.put(normalized));
  return normalized;
}

export async function getAdEvents() {
  const store = await transaction(STORE_EVENTS);
  const request = store.index("createdAt").getAll();
  const events = await requestToPromise(request);
  return events.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function getAdEvent(id) {
  const store = await transaction(STORE_EVENTS);
  return requestToPromise(store.get(id));
}

export async function updateAdEvent(id, patch) {
  const existing = await getAdEvent(id);

  if (!existing) {
    return null;
  }

  const updated = {
    ...existing,
    ...patch,
    updatedAt: new Date().toISOString()
  };

  const store = await transaction(STORE_EVENTS, "readwrite");
  await requestToPromise(store.put(updated));
  return updated;
}

export async function getStats() {
  const events = await getAdEvents();
  const stats = {
    total: events.length,
    yes: 0,
    no: 0,
    unseen: 0,
    rescinded: 0
  };

  for (const event of events) {
    if (event.decision === "yes") {
      stats.yes += 1;
    } else if (event.decision === "no") {
      stats.no += 1;
    } else {
      stats.unseen += 1;
    }

    if (event.status === "rescinded") {
      stats.rescinded += 1;
    }
  }

  return stats;
}

export async function getSetting(key, fallbackValue) {
  const store = await transaction(STORE_SETTINGS);
  const item = await requestToPromise(store.get(key));
  return item ? item.value : fallbackValue;
}

export async function setSetting(key, value) {
  const store = await transaction(STORE_SETTINGS, "readwrite");
  await requestToPromise(store.put({ key, value }));
  return value;
}

export function formatDate(value) {
  if (!value) {
    return "";
  }

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(value));
}

export function buildMarkdownExport(events) {
  const date = new Date().toISOString().slice(0, 10);
  const groups = {
    yes: events.filter((event) => event.decision === "yes"),
    no: events.filter((event) => event.decision === "no"),
    unreviewed: events.filter((event) => !event.decision)
  };

  const lines = [`# Ad Log - ${date}`, ""];

  appendGroup(lines, "Yes", groups.yes);
  appendGroup(lines, "No", groups.no);
  appendGroup(lines, "Unreviewed", groups.unreviewed);

  return lines.join("\n");
}

function appendGroup(lines, title, events) {
  lines.push(`## ${title}`, "");

  if (events.length === 0) {
    lines.push("_None yet._", "");
    return;
  }

  for (const event of events) {
    const label = event.adDomain || event.adUrl || "Unknown ad";
    lines.push(`- ${label}`);
    lines.push(`  - Seen on: ${event.pageDomain || "unknown page"}`);
    lines.push(`  - Ad: ${event.adUrl || "unknown URL"}`);
    lines.push(`  - Status: ${event.status}`);
    lines.push(`  - Source: ${event.source}`);
    if (event.recommendationMeta?.suggestedDecision) {
      lines.push(`  - Smart suggestion: ${event.recommendationMeta.suggestedDecision}`);
      lines.push(`  - Suggested by: ${event.recommendedBy || "unknown model"}`);
      if (event.recommendationMeta.reason) {
        lines.push(`  - Suggestion reason: ${event.recommendationMeta.reason}`);
      }
    }
    if (event.notes) {
      lines.push(`  - Notes: ${event.notes}`);
    }
    if (event.snapshot?.text && event.snapshot.text !== event.notes) {
      lines.push(`  - Snapshot text: ${event.snapshot.text}`);
    }
    if (event.snapshot?.imageUrl) {
      lines.push(`  - Snapshot image: ${event.snapshot.imageUrl}`);
    }
  }

  lines.push("");
}
