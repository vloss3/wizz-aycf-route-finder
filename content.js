chrome.runtime.onMessage.addListener(function(request, sender, sendResponse) {
  if (request.action === "getDestinations") {
    setTimeout(() => {
      const routePattern = /"routes":\[(.*?)\].*?"isOneWayFlightsOnly"/gms;
      const bodyPattern = /window\.CVO\.routes\s*=\s*(\[.*?\]);/s;
      const pageContent = document.head.innerHTML;
      const bodyContent = document.body.innerHTML;
      
      let routesJson;
      let headMatch = pageContent.match(routePattern);
      let bodyMatch = bodyContent.match(bodyPattern);

      if (headMatch && headMatch[0]) {
        routesJson = `{"routes":${headMatch[0].split('"routes":')[1].split(',"isOneWayFlightsOnly"')[0]}}`;
      } else if (bodyMatch && bodyMatch[1]) {
        routesJson = `{"routes":${bodyMatch[1]}}`;
      }

      if (routesJson) {
        try {
          const routesData = JSON.parse(routesJson);

          const originAirport = request.origin;
          const routesFromOrigin = routesData.routes.find(route => route.departureStation.id === originAirport);

          if (routesFromOrigin && routesFromOrigin.arrivalStations) {
            const destinationIds = routesFromOrigin.arrivalStations.map(station => station.id);
            console.log(`Routes from ${originAirport}:`, destinationIds);
            sendResponse({ success: true, destinations: destinationIds });
          } else {
            console.log(`No routes found from ${originAirport}`);
            sendResponse({ success: false, error: `No routes found from ${originAirport}` });
          }
        } catch (error) {
          console.error("Error parsing routes data:", error);
          sendResponse({ success: false, error: "Failed to parse routes data" });
        }
      } else {
        sendResponse({ success: false, error: "No routes data found" });
      }
    }, 1000);
    return true;
  }
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "getDynamicUrl") {
    setTimeout(() => {
      const pageContent = document.head.innerHTML;
      const bodyContent = document.body.innerHTML;
      
      const headMatch = pageContent.match(/"searchFlight":"https:\/\/multipass\.wizzair\.com[^"]+\/([^"]+)"/);
      const bodyMatch = bodyContent.match(/window\.CVO\.flightSearchUrlJson\s*=\s*"(https:\/\/multipass\.wizzair\.com[^"]+)"/);

      if (headMatch && headMatch[1]) {
        const uuid = headMatch[1];
        const dynamicUrl = `https://multipass.wizzair.com/w6/subscriptions/json/availability/${uuid}`;
        sendResponse({dynamicUrl: dynamicUrl});
      } else if (bodyMatch && bodyMatch[1]) {
        const dynamicUrl = bodyMatch[1];
        sendResponse({dynamicUrl: dynamicUrl});
      } else {
        console.log('Dynamic URL not found in page content');
        sendResponse({error: "Dynamic URL not found"});
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
