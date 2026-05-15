import { buildMarkdownExport, getAdEvents, getStats } from "./db.js";
import { downloadText } from "./shared.js";

const ids = {
  total: document.querySelector("#totalCount"),
  unseen: document.querySelector("#unseenCount"),
  yes: document.querySelector("#yesCount"),
  no: document.querySelector("#noCount")
};

renderStats();

document.querySelector("#exportMarkdown").addEventListener("click", async () => {
  const events = await getAdEvents();
  downloadText(buildMarkdownExport(events), markdownName(), "text/markdown");
});

async function renderStats() {
  const stats = await getStats();
  ids.total.textContent = stats.total;
  ids.unseen.textContent = stats.unseen;
  ids.yes.textContent = stats.yes;
  ids.no.textContent = stats.no;
}

function markdownName() {
  return `smart-ad-filter-${new Date().toISOString().slice(0, 10)}.md`;
}
