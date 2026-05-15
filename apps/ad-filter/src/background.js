import { addAdEvent, getStats, setSetting } from "./db.js";

const REVIEW_ALARM = "smart-ad-filter-review";
const REVIEW_URL = chrome.runtime.getURL("src/review.html");

chrome.runtime.onInstalled.addListener(async () => {
  await setSetting("reportFrequency", "weekly");
  await ensureReviewAlarm();
  await updateBadge();
});

chrome.runtime.onStartup.addListener(() => {
  ensureReviewAlarm();
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || message.type !== "LOG_AD_EVENT") {
    return false;
  }

  const tab = sender.tab || {};
  addAdEvent({
    ...message.payload,
    pageUrl: message.payload.pageUrl || tab.url || "",
    pageTitle: message.payload.pageTitle || tab.title || "",
    tabId: tab.id
  })
    .then(async (event) => {
      await updateBadge();
      sendResponse({ ok: true, event });
    })
    .catch((error) => {
      sendResponse({ ok: false, error: String(error) });
    });

  return true;
});

if (chrome.declarativeNetRequest.onRuleMatchedDebug) {
  chrome.declarativeNetRequest.onRuleMatchedDebug.addListener(async (info) => {
    const tab = info.request.tabId >= 0 ? await safeGetTab(info.request.tabId) : null;

    await addAdEvent({
      source: "network-rule",
      adUrl: info.request.url,
      pageUrl: tab?.url || info.request.initiator || "",
      pageTitle: tab?.title || "",
      resourceType: info.request.type,
      ruleId: info.rule.ruleId,
      rulesetId: info.rule.rulesetId,
      status: "unseen"
    });

    await updateBadge();
  });
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === REVIEW_ALARM) {
    showReviewNotification();
  }
});

chrome.notifications.onClicked.addListener((notificationId) => {
  if (notificationId === REVIEW_ALARM) {
    chrome.tabs.create({ url: REVIEW_URL });
  }
});

async function ensureReviewAlarm() {
  const existing = await chrome.alarms.get(REVIEW_ALARM);

  if (!existing) {
    await chrome.alarms.create(REVIEW_ALARM, {
      delayInMinutes: 7 * 24 * 60,
      periodInMinutes: 7 * 24 * 60
    });
  }
}

async function showReviewNotification() {
  const stats = await getStats();
  const message = `${stats.total} ads logged. ${stats.unseen} are waiting for yes/no review.`;

  await chrome.notifications.create(REVIEW_ALARM, {
    type: "basic",
    iconUrl: "icons/icon128.png",
    title: "Smart Ad Filter weekly review",
    message
  });
}

async function updateBadge() {
  const stats = await getStats();
  const text = stats.unseen > 0 ? String(Math.min(stats.unseen, 999)) : "";
  await chrome.action.setBadgeText({ text });
  await chrome.action.setBadgeBackgroundColor({ color: "#2f8f6f" });
}

async function safeGetTab(tabId) {
  try {
    return await chrome.tabs.get(tabId);
  } catch {
    return null;
  }
}
