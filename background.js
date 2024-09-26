let headers = null;

function getDynamicUrl() {
  return new Promise((resolve, reject) => {
    chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
      const currentTab = tabs[0];
      if (currentTab.url.includes('multipass.wizzair.com')) {
        const urlParts = currentTab.url.split('/');
        const uuid = urlParts[urlParts.length - 1];
        resolve(`https://multipass.wizzair.com/w6/subscriptions/json/availability/${uuid}`);
      } else {
        reject(new Error("Not on the Wizzair Multipass page"));
      }
    });
  });
}

chrome.webRequest.onBeforeSendHeaders.addListener(
  function(details) {
    if (details.url === getDynamicUrl()) {
      headers = details.requestHeaders;
    }
  },
  {urls: ["<all_urls>"]},
  ["requestHeaders"]
);

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "getHeaders") {
    if (headers) {
      sendResponse({ headers: headers });
    } else {
      sendResponse({ headers: {
        'Content-Type': 'application/json',
      }});
    }
  }
  return true;
});