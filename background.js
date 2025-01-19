chrome.action.onClicked.addListener(async (tab) => {
  // Check if side panel API is available.
  const hasSidePanel = 'sidePanel' in chrome;
  
  const openAsPopup = () => {
    chrome.windows.create({
      url: 'popup.html',
      type: 'popup',
      width: 400,
      height: 600
    });
  };

  if (tab.url.includes('multipass.wizzair.com')) {
    if (hasSidePanel) {
      await chrome.sidePanel.open({ windowId: tab.windowId });
      await chrome.sidePanel.setOptions({
        enabled: true,
        path: 'popup.html'
      });
    } else {
      openAsPopup();
    }
  } else {
    chrome.tabs.create({
      url: "https://multipass.wizzair.com/w6/subscriptions/spa/private-page/wallets"
    }, async (newTab) => {
      if (hasSidePanel) {
        await chrome.sidePanel.open({ windowId: newTab.windowId });
        await chrome.sidePanel.setOptions({
          enabled: true,
          path: 'popup.html'
        });
      } else {
        openAsPopup();
      }
    });
  }
});
