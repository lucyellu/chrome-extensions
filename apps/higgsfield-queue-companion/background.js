"use strict";

const VIDEO_URL = "https://higgsfield.ai/ai/video";

chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});

chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
});

chrome.action.onClicked.addListener(async (tab) => {
  if (!tab?.id) {
    await chrome.tabs.create({ url: VIDEO_URL });
    return;
  }

  await chrome.sidePanel.setOptions({
    tabId: tab.id,
    path: "sidepanel.html",
    enabled: true
  });

  await chrome.sidePanel.open({ tabId: tab.id });
});
