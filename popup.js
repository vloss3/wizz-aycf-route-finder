console.log('popup.js loaded');

async function fetchDestinations(origin) {
  return new Promise((resolve, reject) => {
    chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
      const currentTab = tabs[0];
      if (currentTab.url.includes('multipass.wizzair.com')) {
        chrome.tabs.sendMessage(currentTab.id, {action: "getDestinations", origin: origin}, function(response) {if (response && response.destinations) {
            resolve(response.destinations);
          } else if (response && response.error) {
            reject(new Error(response.error));
          } else {
            reject(new Error("Failed to fetch destinations"));
          }
        });
      } else {
        chrome.tabs.create({ url: 'https://multipass.wizzair.com/w6/subscriptions/spa/private-page/wallets' });
        reject(new Error("Not on the Wizzair Multipass page. Opening the correct page for you. Please enter any random route and press Search."));
      }
    });
  });
}

function getDynamicUrl() {
  return new Promise((resolve, reject) => {
    chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
      const currentTab = tabs[0];
      chrome.tabs.sendMessage(currentTab.id, {action: "getDynamicUrl"}, function(response) {
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError);
        } else if (response && response.dynamicUrl) {
          resolve(response.dynamicUrl);
        } else if (response && response.error) {
          reject(new Error(response.error));
        } else {
          reject(new Error("Failed to get dynamic URL"));
        }
      });
    });
  });
}

async function checkRoute(origin, destination, date) {
  try {
    await new Promise(resolve => setTimeout(resolve, 200));

    const dynamicUrl = await getDynamicUrl();

    const data = {
      flightType: 'OW',
      origin: origin,
      destination: destination,
      departure: date,
      arrival: '',
      intervalSubtype: null
    };

    const [tab] = await chrome.tabs.query({active: true, currentWindow: true});
    
    const response = await new Promise((resolve) => {
      chrome.tabs.sendMessage(tab.id, {action: "getHeaders"}, resolve);
    });

    if (!response || !response.headers) {
      throw new Error("Failed to get headers from the page");
    }

    const headers = response.headers;

    headers['Content-Type'] = 'application/json';

    const fetchResponse = await fetch(dynamicUrl, {
      method: 'POST',
      headers: headers,
      body: JSON.stringify(data)
    });

    if (!fetchResponse.ok) {
      throw new Error(`HTTP error! status: ${fetchResponse.status}`);
    }

    const responseData = await fetchResponse.json();
    return responseData.flightsOutbound || [];
  } catch (error) {
    console.error('Error in checkRoute:', error);
    throw error;
  }
}

function cacheKey(origin, date) {
  return `${origin}-${date}`;
}

function setCachedResults(key, results) {
  const cacheData = {
    results: results,
    timestamp: Date.now()
  };
  localStorage.setItem(key, JSON.stringify(cacheData));
}

function getCachedResults(key) {
  const cachedData = localStorage.getItem(key);
  if (cachedData) {
    const { results, timestamp } = JSON.parse(cachedData);
    const thirtyMinutesInMs = 30 * 60 * 1000;
    if (Date.now() - timestamp < thirtyMinutesInMs) {
      return results;
    }
  }
  return null;
}

function clearCache(key) {
  localStorage.removeItem(key);
}

async function checkAllRoutes() {
  console.log('checkAllRoutes started');
  const originInput = document.getElementById('airport-input');
  const dateSelect = document.getElementById('date-select');
  const origin = originInput.value.toUpperCase();
  const selectedDate = dateSelect.value;

  if (!origin) {
    alert('Please enter a departure airport code.');
    return;
  }

  const cacheKey = `${origin}-${selectedDate}`;
  const cachedResults = getCachedResults(cacheKey);

  if (cachedResults) {
    console.log('Using cached results');
    displayResults({ [selectedDate]: cachedResults });
    const routeListElement = document.querySelector('.route-list');
    const cacheNotification = document.createElement('div');
    cacheNotification.textContent = 'Using cached results. Click the "Refresh Cache" button to fetch new data.';
    cacheNotification.style.backgroundColor = '#e6f7ff';
    cacheNotification.style.border = '1px solid #91d5ff';
    cacheNotification.style.borderRadius = '4px';
    cacheNotification.style.padding = '10px';
    cacheNotification.style.marginBottom = '15px';
    routeListElement.insertBefore(cacheNotification, routeListElement.firstChild);
    return;
  }

  const flightsByDate = {};

  const routeListElement = document.querySelector('.route-list');
  if (!routeListElement) {
    console.error('Error: .route-list element not found in the DOM');
    return;
  }

  try {
    const destinations = await fetchDestinations(origin);
    console.log('Fetched destinations:', destinations);

    const progressElement = document.createElement('div');
    progressElement.id = 'progress';
    progressElement.style.marginBottom = '10px';
    routeListElement.insertBefore(progressElement, routeListElement.firstChild);

    const results = [];
    let completedRoutes = 0;

    const updateProgress = () => {
      progressElement.textContent = `Checked ${completedRoutes} of ${destinations.length} routes...`;
    };

    const routePromises = destinations.map(async (destination) => {
      try {
        const flights = await checkRoute(origin, destination, selectedDate);
        if (flights && flights.length > 0) {
          flights.forEach(flight => {
            results.push({
              route: `${origin} (${flight.departureStationText}) to ${destination} (${flight.arrivalStationText})`,
              date: flight.departureDate,
              departure: `${flight.departure} (${flight.departureOffsetText})`,
              arrival: `${flight.arrival} (${flight.arrivalOffsetText})`,
              duration: flight.duration,
              flightCode: flight.flightCode
            });
          });
        }
      } catch (error) {
        console.error(`Error processing ${origin} to ${destination} on ${selectedDate}:`, error.message);
      } finally {
        completedRoutes++;
        updateProgress();
      }
    });

    await Promise.all(routePromises);

    progressElement.remove();

    if (results.length === 0) {
      routeListElement.innerHTML = `<p class="is-size-4 has-text-centered">No flights available for ${selectedDate}.</p>`;
    } else {
      results.filter(result => result !== null).forEach(flightInfo => {
        if (!flightsByDate[selectedDate]) {
          flightsByDate[selectedDate] = [];
        }
        flightsByDate[selectedDate].push(flightInfo);
      });

      setCachedResults(cacheKey, flightsByDate[selectedDate]);
      displayResults(flightsByDate);
    }
  } catch (error) {
    console.error("An error occurred:", error.message);
    routeListElement.innerHTML = `<p>Error: ${error.message}</p>`;
  }
}

function formatDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function displayResults(flightsByDate) {
  const resultsDiv = document.querySelector('.route-list');
  if (!resultsDiv) {
    console.error('Error: .route-list element not found in the DOM');
    return;
  }
  resultsDiv.innerHTML = '';

  resultsDiv.style.fontFamily = 'Arial, sans-serif';
  resultsDiv.style.maxWidth = '600px';
  resultsDiv.style.margin = '0 auto';

  for (const [date, flights] of Object.entries(flightsByDate)) {
    if (flights.length > 0) {
      const dateHeader = document.createElement('h3');
      
      const dateObj = new Date(date);
      const formattedDate = dateObj.toLocaleDateString('en-US', {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        year: 'numeric'
      });
      
      dateHeader.style.display = 'flex';
      dateHeader.style.justifyContent = 'space-between';
      dateHeader.style.alignItems = 'center';
      dateHeader.style.backgroundColor = '#f0f0f0';
      dateHeader.style.padding = '10px';
      dateHeader.style.borderRadius = '5px';

      const dateText = document.createElement('span');
      dateText.textContent = formattedDate;
      dateHeader.appendChild(dateText);

      const clearCacheButton = document.createElement('button');
      clearCacheButton.textContent = '♻️ Refresh Cache';
      clearCacheButton.style.padding = '5px 10px';

      clearCacheButton.style.fontSize = '12px';
      clearCacheButton.style.backgroundColor = '#f0f0f0';
      clearCacheButton.style.border = '1px solid #ccc';
      clearCacheButton.style.borderRadius = '3px';
      clearCacheButton.style.cursor = 'pointer';
      clearCacheButton.addEventListener('click', () => {
        const origin = document.getElementById('airport-input').value.toUpperCase();
        const cacheKey = `${origin}-${date}`;
        clearCache(cacheKey);
      });

      dateHeader.appendChild(clearCacheButton);
      resultsDiv.appendChild(dateHeader);

      const flightList = document.createElement('ul');
      flightList.style.listStyleType = 'none';
      flightList.style.padding = '0';

      flights.forEach(flight => {
        const flightItem = document.createElement('li');
        flightItem.style.marginBottom = '15px';
        flightItem.style.padding = '10px';
        flightItem.style.border = '1px solid #ddd';
        flightItem.style.borderRadius = '5px';

        const routeDiv = document.createElement('div');
        routeDiv.textContent = flight.route;
        routeDiv.style.fontWeight = 'bold';
        routeDiv.style.marginBottom = '5px';

        const flightCodeDiv = document.createElement('div');
        flightCodeDiv.textContent = flight.flightCode;
        flightCodeDiv.style.fontSize = '0.825rem';
        flightCodeDiv.style.color = '#1d1d1d';
        flightCodeDiv.style.marginBottom = '5px';

        const detailsDiv = document.createElement('div');
        detailsDiv.style.display = 'flex';
        detailsDiv.style.justifyContent = 'space-between';

        const departureDiv = document.createElement('div');
        departureDiv.textContent = `✈️ Departure: ${flight.departure}`;

        const arrivalDiv = document.createElement('div');
        arrivalDiv.textContent = `🛬 Arrival: ${flight.arrival}`;

        const durationDiv = document.createElement('div');
        durationDiv.textContent = `⏱️ Duration: ${flight.duration}`;

        detailsDiv.appendChild(departureDiv);
        detailsDiv.appendChild(arrivalDiv);
        detailsDiv.appendChild(durationDiv);

        flightItem.appendChild(routeDiv);
        flightItem.appendChild(flightCodeDiv);
        flightItem.appendChild(detailsDiv);
        flightList.appendChild(flightItem);
      });
      resultsDiv.appendChild(flightList);
    }
  }
}

document.addEventListener('DOMContentLoaded', () => {
  console.log('DOM content loaded');
  const checkFlightsButton = document.getElementById('search-flights');
  const routeListElement = document.querySelector('.route-list');
  const airportInput = document.getElementById('airport-input');
  
  const lastAirport = localStorage.getItem('lastAirport');
  if (lastAirport) {
    airportInput.value = lastAirport;
  }
  
  airportInput.addEventListener('input', () => {
    localStorage.setItem('lastAirport', airportInput.value.toUpperCase());
  });
  
  if (!routeListElement) {
    console.error('Error: .route-list element not found in the DOM');
  }
  
  if (checkFlightsButton) {
    console.log('Check Flights button found');
    checkFlightsButton.addEventListener('click', () => {
      console.log('Check Flights button clicked');
      checkAllRoutes().catch(error => {
        console.error('Error in checkAllRoutes:', error);
        if (routeListElement) {
          routeListElement.innerHTML = `<p>Error: ${error.message}</p>`;
        }
      });
    });
  } else {
    console.error('Check Flights button not found');
  }
});

document.addEventListener('DOMContentLoaded', function() {
  const dateSelect = document.getElementById('date-select');
  const today = new Date();

  for (let i = 0; i < 4; i++) {
    const date = new Date(today);
    date.setDate(today.getDate() + i);
    
    const option = document.createElement('option');
    option.value = date.toISOString().split('T')[0];
    option.textContent = date.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
    
    dateSelect.appendChild(option);
  }
});