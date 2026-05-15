import {
  buildMarkdownExport,
  formatDate,
  getAdEvents,
  getStats,
  updateAdEvent
} from "./db.js";
import { getAiSettings, runSmartFilter, saveAiSettings } from "./ai.js";
import { downloadText, safeUrlLabel } from "./shared.js";

const list = document.querySelector("#eventList");
const template = document.querySelector("#eventTemplate");
const filterButtons = [...document.querySelectorAll("[data-filter]")];
const runSmartFilterButton = document.querySelector("#runSmartFilter");
const smartStatus = document.querySelector("#smartStatus");
const aiSettingsForm = document.querySelector("#aiSettingsForm");
const counts = {
  total: document.querySelector("#totalCount"),
  unseen: document.querySelector("#unseenCount"),
  yes: document.querySelector("#yesCount"),
  no: document.querySelector("#noCount")
};

let events = [];
let activeFilter = "all";
let aiSettings = await getAiSettings();

renderAiSettings();

document.querySelector("#exportMarkdown").addEventListener("click", () => {
  downloadText(buildMarkdownExport(events), exportName("md"), "text/markdown");
});

document.querySelector("#exportJson").addEventListener("click", () => {
  downloadText(JSON.stringify(events, null, 2), exportName("json"), "application/json");
});

for (const button of filterButtons) {
  button.addEventListener("click", () => {
    activeFilter = button.dataset.filter;
    filterButtons.forEach((item) => item.classList.toggle("active", item === button));
    renderList();
  });
}

aiSettingsForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  aiSettings = await saveAiSettings({
    providerName: aiSettingsForm.providerName.value,
    baseUrl: aiSettingsForm.baseUrl.value,
    model: aiSettingsForm.model.value,
    apiKey: aiSettingsForm.apiKey.value,
    maxBatchSize: 20
  });
  renderAiSettings();
  setSmartStatus("Smart filter settings saved.");
});

runSmartFilterButton.addEventListener("click", async () => {
  const unreviewed = events.filter((event) => !event.decision);

  if (unreviewed.length === 0) {
    setSmartStatus("No unreviewed saved ads to filter yet.");
    return;
  }

  runSmartFilterButton.disabled = true;
  setSmartStatus(`Reviewing ${Math.min(unreviewed.length, aiSettings.maxBatchSize)} saved ads with ${aiSettings.providerName}...`);

  try {
    const applied = await runSmartFilter(unreviewed, aiSettings);
    setSmartStatus(`Smart filter added ${applied.length} suggestions. Your yes/no decisions are unchanged.`);
    await refresh();
  } catch (error) {
    setSmartStatus(error.message || "Smart filter failed.");
  } finally {
    runSmartFilterButton.disabled = false;
  }
});

await refresh();

async function refresh() {
  events = await getAdEvents();
  await renderStats();
  renderList();
}

async function renderStats() {
  const stats = await getStats();
  counts.total.textContent = stats.total;
  counts.unseen.textContent = stats.unseen;
  counts.yes.textContent = stats.yes;
  counts.no.textContent = stats.no;
}

function renderList() {
  const filtered = filterEvents(events);
  list.replaceChildren();

  if (filtered.length === 0) {
    const empty = document.createElement("p");
    empty.className = "empty";
    empty.textContent = "No ads in this view yet.";
    list.append(empty);
    return;
  }

  for (const event of filtered) {
    list.append(renderEvent(event));
  }
}

function renderEvent(event) {
  const node = template.content.firstElementChild.cloneNode(true);
  const title = node.querySelector("h2");
  const status = node.querySelector(".status");
  const meta = node.querySelector(".meta");
  const url = node.querySelector(".url");
  const notes = node.querySelector(".notes");
  const suggestion = node.querySelector(".suggestion");
  const snapshot = node.querySelector(".snapshot");
  const snapshotImage = snapshot.querySelector("img");
  const snapshotCaption = snapshot.querySelector("figcaption");
  const yesButton = node.querySelector(".yes-button");
  const noButton = node.querySelector(".no-button");
  const rescindButton = node.querySelector(".rescind-button");

  title.textContent = event.adDomain || "Ad candidate";
  status.textContent = event.decision ? event.decision.toUpperCase() : "UNREVIEWED";
  status.dataset.decision = event.decision || "unreviewed";
  meta.textContent = `${event.source} on ${event.pageDomain || "unknown page"} - ${formatDate(event.createdAt)}`;
  url.textContent = safeUrlLabel(event.adUrl);
  notes.textContent = event.notes || "";
  suggestion.textContent = formatSuggestion(event);
  suggestion.hidden = !event.recommendationMeta?.suggestedDecision;
  renderSnapshot(event, snapshot, snapshotImage, snapshotCaption);

  yesButton.disabled = event.decision === "yes";
  noButton.disabled = event.decision === "no";
  rescindButton.hidden = event.decision !== "yes";

  yesButton.addEventListener("click", () => decide(event.id, "yes"));
  noButton.addEventListener("click", () => decide(event.id, "no"));
  rescindButton.addEventListener("click", () => rescind(event.id));

  return node;
}

async function decide(id, decision) {
  await updateAdEvent(id, {
    decision,
    status: "seen",
    decidedAt: new Date().toISOString()
  });
  await refresh();
}

async function rescind(id) {
  await updateAdEvent(id, {
    decision: "no",
    status: "rescinded",
    rescindedAt: new Date().toISOString()
  });
  await refresh();
}

function filterEvents(items) {
  if (activeFilter === "yes") {
    return items.filter((event) => event.decision === "yes");
  }

  if (activeFilter === "no") {
    return items.filter((event) => event.decision === "no");
  }

  if (activeFilter === "unreviewed") {
    return items.filter((event) => !event.decision);
  }

  if (activeFilter === "smart-yes") {
    return items.filter((event) => event.recommendationMeta?.suggestedDecision === "yes");
  }

  return items;
}

function exportName(extension) {
  return `smart-ad-filter-${new Date().toISOString().slice(0, 10)}.${extension}`;
}

function renderAiSettings() {
  aiSettingsForm.providerName.value = aiSettings.providerName;
  aiSettingsForm.baseUrl.value = aiSettings.baseUrl;
  aiSettingsForm.model.value = aiSettings.model;
  aiSettingsForm.apiKey.value = aiSettings.apiKey;
}

function setSmartStatus(message) {
  smartStatus.textContent = message;
}

function formatSuggestion(event) {
  const meta = event.recommendationMeta;

  if (!meta?.suggestedDecision) {
    return "";
  }

  const confidence = typeof meta.confidence === "number" ? `, ${Math.round(meta.confidence * 100)}%` : "";
  const reason = meta.reason ? ` - ${meta.reason}` : "";
  return `Smart suggestion: ${meta.suggestedDecision.toUpperCase()} via ${event.recommendedBy || meta.model}${confidence}${reason}`;
}

function renderSnapshot(event, snapshot, image, caption) {
  const data = event.snapshot;

  if (!data?.imageUrl && !data?.text) {
    snapshot.hidden = true;
    return;
  }

  snapshot.hidden = false;
  image.hidden = !data.imageUrl;
  image.src = data.imageUrl || "";
  image.alt = data.text ? `Ad snapshot: ${data.text.slice(0, 80)}` : "Ad snapshot";
  caption.textContent = data.text || "Image snapshot captured from the page.";
}
