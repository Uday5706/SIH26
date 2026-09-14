// Opens the side panel when the toolbar icon is clicked.
chrome.action.onClicked.addListener(async (tab) => {
  await chrome.sidePanel.open({ tabId: tab.id });
});

// Let any tab enable the side panel behavior on load.
chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel
    .setPanelBehavior({ openPanelOnActionClick: true })
    .catch(() => {});
});

// Relay:
// content script -> side panel
// side panel -> active tab content script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message) return;

  if (message.target === "content" && sender.tab === undefined) {
    chrome.tabs.query(
      { active: true, currentWindow: true },
      (tabs) => {
        const tabId = tabs[0]?.id;
        if (tabId != null) {
          chrome.tabs.sendMessage(tabId, message).catch(() => {});
        }
      }
    );
    return false;
  }

  if (message.target === "panel") {
    chrome.runtime.sendMessage(message).catch(() => {});
    return false;
  }

  return false;
});
