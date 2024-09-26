console.log('popup.js loaded');

async function fetchDestinations(origin) {
  return new Promise((resolve, reject) => {
    chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
      const currentTab = tabs[0];
      if (currentTab.url.includes('multipass.wizzair.com')) {
        chrome.tabs.sendMessage(currentTab.id, {action: "getDestinations", origin: origin}, function(response) {
          if (chrome.runtime.lastError) {
            reject(chrome.runtime.lastError);
          } else if (response && response.destinations) {
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

async function checkRoute(origin, destination, date) {
  const dynamicUrl = await getDynamicUrl();
  
  const headers = await new Promise((resolve) => {
    chrome.runtime.sendMessage({action: "getHeaders"}, (response) => {
      resolve(response.headers);
    });
  });

  const data = {
    flightType: 'OW',
    origin: origin,
    destination: destination,
    departure: date,
    arrival: '',
    intervalSubtype: null
  };

  const response = await fetch(dynamicUrl, {
    method: 'POST',
    headers: headers,
    body: JSON.stringify(data)
  });
  return response.json();
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

    const results = await Promise.all(destinations.map(async (destination, index) => {
      try {
        progressElement.textContent = `Checking ${destinations.length} routes, please wait...`;

        const result = await checkRoute(origin, destination, selectedDate);
        if (result && result.flightsOutbound && result.flightsOutbound.length > 0) {
          const flight = result.flightsOutbound[0];
          return {
            route: `${origin} (${flight.departureStationText}) to ${destination} (${flight.arrivalStationText})`,
            date: flight.departureDate,
            departure: `${flight.departure} (${flight.departureOffsetText})`,
            arrival: `${flight.arrival} (${flight.arrivalOffsetText})`,
            duration: flight.duration
          };
        }
        return null;
      } catch (error) {
        console.error(`Error processing ${origin} to ${destination} on ${selectedDate}:`, error.message);
        return null;
      }
    }));

    progressElement.remove();

    results.filter(result => result !== null).forEach(flightInfo => {
      if (!flightsByDate[selectedDate]) {
        flightsByDate[selectedDate] = [];
      }
      flightsByDate[selectedDate].push(flightInfo);
    });

    displayResults(flightsByDate);
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
      
      dateHeader.textContent = formattedDate;
      dateHeader.style.backgroundColor = '#f0f0f0';
      dateHeader.style.padding = '10px';
      dateHeader.style.borderRadius = '5px';
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
