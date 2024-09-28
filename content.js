chrome.runtime.onMessage.addListener(function(request, sender, sendResponse) {
  if (request.action === "getDestinations") {
    const origin = request.origin;
    
    // Find the input fields.
    const firstInputField = document.querySelector('input[aria-owns="autocomplete-result-list-1"]');
    const secondInputField = document.querySelector('input[aria-owns="autocomplete-result-list-2"]');

    const firstList = document.querySelector('ul#autocomplete-result-list-1');
    const secondList = document.querySelector('ul#autocomplete-result-list-2');

    // Clear both input fields.
    [firstInputField, secondInputField].forEach((inputField, index) => {
      if (inputField) {
        const clearButton = inputField.parentElement.querySelector('button.CvoClose');
        if (clearButton) {
          clearButton.click();
        } else {
          console.error(`Clear button not found for input field ${index + 1}`);
        }
      } else {
        console.error(`Input field ${index + 1} not found`);
      }
    });

    if (firstInputField && secondInputField) {
      firstInputField.focus();
      firstInputField.value = origin;
      firstInputField.dispatchEvent(new Event('input', { bubbles: true }));

      setTimeout(() => {
        firstInputField.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
        setTimeout(() => {
          firstInputField.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
          

          setTimeout(() => {
            secondInputField.focus();
            secondInputField.click();
            secondInputField.dispatchEvent(new Event('input', { bubbles: true }));

            setTimeout(() => {
              if (secondList) {
                const destinations = Array.from(secondList.querySelectorAll('li'))
                  .map(li => {
                    const text = li.textContent.trim();
                    const match = text.match(/\(([A-Z]{3})\)/);
                    return match ? match[1] : text;
                  });
                sendResponse({ destinations: destinations });
              } else {
                sendResponse({ error: 'Destination list not found' });
              }
            }, 500);
          }, 500);
        }, 100);
      }, 500);
    } else {
      sendResponse({ error: 'Input fields not found' });
    }

    return true;
  }
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "getDynamicUrl") {
    setTimeout(() => {
      const pageContent = document.head.innerHTML;
      const match = pageContent.match(/"searchFlight":"https:\/\/multipass\.wizzair\.com[^"]+\/([^"]+)"/);
      if (match && match[1]) {
        const uuid = match[1];
        const dynamicUrl = `https://multipass.wizzair.com/w6/subscriptions/json/availability/${uuid}`;
        sendResponse({dynamicUrl: dynamicUrl});
      } else {
        console.log('Dynamic ID not found in page content');
        sendResponse({error: "Dynamic ID not found"});
      }
    }, 1000);
    return true;
  }
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "getHeaders") {
    const headers = {};
    performance.getEntriesByType("resource").forEach(entry => {
      if (entry.name.includes("multipass.wizzair.com")) {
        entry.serverTiming.forEach(timing => {
          if (timing.name.startsWith("request_header_")) {
            const headerName = timing.name.replace("request_header_", "");
            headers[headerName] = timing.description;
          }
        });
      }
    });
    sendResponse({headers: headers});
  }
});
