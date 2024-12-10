console.log("popup.js loaded");

async function fetchDestinations(origin) {
  return new Promise((resolve, reject) => {
    chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
      const currentTab = tabs[0];
      if (currentTab.url.includes("multipass.wizzair.com")) {
        chrome.tabs.sendMessage(
          currentTab.id,
          { action: "getDestinations", origin: origin },
          function (response) {
            if (response && response.destinations) {
              resolve(response.destinations);
            } else if (response && response.error) {
              reject(new Error(response.error));
            } else {
              reject(new Error("Failed to fetch destinations"));
            }
          }
        );
      } else {
        chrome.tabs.create({
          url: "https://multipass.wizzair.com/w6/subscriptions/spa/private-page/wallets",
        });
        reject(
          new Error(
            "Not on the Wizzair Multipass page. Opening the correct page for you. Please enter any random route and press Search."
          )
        );
      }
    });
  });
}

function getDynamicUrl() {
  return new Promise((resolve, reject) => {
    chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
      const currentTab = tabs[0];
      chrome.tabs.sendMessage(
        currentTab.id,
        { action: "getDynamicUrl" },
        function (response) {
          if (chrome.runtime.lastError) {
            reject(chrome.runtime.lastError);
          } else if (response && response.dynamicUrl) {
            resolve(response.dynamicUrl);
          } else if (response && response.error) {
            reject(new Error(response.error));
          } else {
            reject(new Error("Failed to get dynamic URL"));
          }
        }
      );
    });
  });
}

async function checkRoute(origin, destination, date) {
  try {
    await new Promise((resolve) => setTimeout(resolve, 200));

    const dynamicUrl = await getDynamicUrl();

    const data = {
      flightType: "OW",
      origin: origin,
      destination: destination,
      departure: date,
      arrival: "",
      intervalSubtype: null,
    };

    const [tab] = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });

    const response = await new Promise((resolve) => {
      chrome.tabs.sendMessage(tab.id, { action: "getHeaders" }, resolve);
    });

    if (!response || !response.headers) {
      throw new Error("Failed to get headers from the page");
    }

    const headers = response.headers;

    headers["Content-Type"] = "application/json";

    const fetchResponse = await fetch(dynamicUrl, {
      method: "POST",
      headers: headers,
      body: JSON.stringify(data),
    });

    if (!fetchResponse.ok) {
      throw new Error(`HTTP error! status: ${fetchResponse.status}`);
    }

    const responseData = await fetchResponse.json();
    return responseData.flightsOutbound || [];
  } catch (error) {
    console.error("Error in checkRoute:", error);
    throw error;
  }
}

function cacheKey(origin, date) {
  const [year, month, day] = date.split("-");
  return `${origin}-${year}-${month}-${day}`;
}

function setCachedResults(key, results) {
  const cacheData = {
    results: results,
    timestamp: Date.now(),
  };
  localStorage.setItem(key, JSON.stringify(cacheData));
}

function getCachedResults(key) {
  const cachedData = localStorage.getItem(key);
  if (cachedData) {
    const { results, timestamp } = JSON.parse(cachedData);
    const eightHoursInMs = 8 * 60 * 60 * 1000;
    if (Date.now() - timestamp < eightHoursInMs) {
      return results;
    } else {
      clearCache(key);
    }
  }
  return null;
}

function clearCache(key) {
  localStorage.removeItem(key);
}

async function checkAllRoutes() {
  console.log("checkAllRoutes started");
  const originInput = document.getElementById("airport-input");
  const dateSelect = document.getElementById("date-select");
  const checkReturnsCheckbox = document.getElementById("check-returns");
  const origin = originInput.value.toUpperCase();
  const selectedDate = dateSelect.value;
  const checkReturns = checkReturnsCheckbox.checked;
  let rateLimited = false;

  if (!origin) {
    alert("Please enter a departure airport code.");
    return;
  }

  // Clear previous results
  let routeListElement = document.querySelector(".route-list");
  routeListElement.innerHTML = "";

  const cacheKey = `${origin}-${selectedDate}`;
  const cachedResults = getCachedResults(cacheKey);

  if (cachedResults) {
    console.log("Using cached results");
    displayResults({ [selectedDate]: cachedResults });
    const routeListElement = document.querySelector(".route-list");
    const cacheNotification = document.createElement("div");
    cacheNotification.textContent =
      'Using cached results. Click the "Refresh Cache" button to fetch new data.';
    cacheNotification.style.backgroundColor = "#e6f7ff";
    cacheNotification.style.border = "1px solid #91d5ff";
    cacheNotification.style.borderRadius = "4px";
    cacheNotification.style.padding = "10px";
    cacheNotification.style.marginBottom = "15px";
    routeListElement.insertBefore(
      cacheNotification,
      routeListElement.firstChild
    );
    return;
  }

  const flightsByDate = {};

  if (!routeListElement) {
    console.error("Error: .route-list element not found in the DOM");
    return;
  }

  try {
    const destinations = await fetchDestinations(origin);
    console.log("Fetched destinations:", destinations);

    const progressElement = document.createElement("div");
    progressElement.id = "progress";
    progressElement.style.marginBottom = "10px";
    routeListElement.insertBefore(progressElement, routeListElement.firstChild);

    const results = [];
    let completedRoutes = 0;

    for (const destination of destinations) {
      const updateProgress = () => {
        progressElement.textContent = `Checking ${origin} to ${destination}... ${completedRoutes}/${destinations.length}`;
      };
      try {
        const flights = await checkRoute(origin, destination, selectedDate);
        if (flights && flights.length > 0) {
          flights.forEach((flight) => {
            const flightInfo = {
              route: `${origin} (${flight.departureStationText}) to ${destination} (${flight.arrivalStationText}) - ${flight.flightCode}`,
              date: flight.departureDate,
              departure: `${flight.departure} (${flight.departureOffsetText})`,
              arrival: `${flight.arrival} (${flight.arrivalOffsetText})`,
              duration: flight.duration,
            };

            results.push(flightInfo);

            if (!flightsByDate[selectedDate]) {
              flightsByDate[selectedDate] = [];
            }
            flightsByDate[selectedDate].push(flightInfo);
            displayResults(flightsByDate, checkReturns, true);
          });
        }
      } catch (error) {
        console.error(
          `Error processing ${origin} to ${destination} on ${selectedDate}:`,
          error.message
        );

        if (
          error.message.includes("429") ||
          error.message.includes("Rate limited")
        ) {
          rateLimited = true;
          const errorDiv = document.createElement("div");
          errorDiv.className = "notification is-danger";
          errorDiv.innerHTML = `
            <p class="has-text-weight-bold">${error.message}</p>
            <p class="mt-2">Search stopped due to rate limiting. Results shown are partial. Please wait a few minutes before searching again.</p>
          `;
          routeListElement.insertBefore(errorDiv, progressElement);
          break;
        }
      }

      completedRoutes++;
      updateProgress();
      await new Promise((resolve) => setTimeout(resolve, 200));
    }

    progressElement.remove();

    if (results.length === 0) {
      routeListElement.innerHTML = `<p class="is-size-4 has-text-centered">No flights available for ${selectedDate}.</p>`;
    } else {
      setCachedResults(cacheKey, flightsByDate[selectedDate]);
      await displayResults(flightsByDate, checkReturns);

      if (checkReturns) {
        const returnPromises = flightsByDate[selectedDate].map(
          async (flight) => {
            const returnFlights = await findReturnFlight(flight);
            const returnCacheKey = `${cacheKey}-return-${flight.route}`;
            setCachedResults(returnCacheKey, returnFlights);
          }
        );
        await Promise.all(returnPromises);
      }
    }
  } catch (error) {
    console.error("An error occurred:", error.message);
    routeListElement.innerHTML = `<p>Error: ${error.message}</p>`;
  }
}

function formatDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function displayResults(flightsByDate, checkReturns, append = false) {
  const resultsDiv = document.querySelector(".route-list");
  if (!resultsDiv) {
    console.error("Error: .route-list element not found in the DOM");
    return;
  }

  if (!append) {
    resultsDiv.innerHTML = "";
  }

  resultsDiv.style.fontFamily = "Arial, sans-serif";
  resultsDiv.style.maxWidth = "600px";
  resultsDiv.style.margin = "0 auto";

  for (const [date, flights] of Object.entries(flightsByDate)) {
    if (flights.length > 0) {
      let dateHeader = append
        ? resultsDiv.querySelector(`h3[data-date="${date}"]`)
        : null;
      let flightList = append
        ? resultsDiv.querySelector(`ul[data-date="${date}"]`)
        : null;

      if (!dateHeader) {
        dateHeader = document.createElement("h3");
        dateHeader.setAttribute("data-date", date);
        dateHeader.style.display = "flex";
        dateHeader.style.justifyContent = "space-between";
        dateHeader.style.alignItems = "center";
        dateHeader.style.backgroundColor = "#f0f0f0";
        dateHeader.style.padding = "10px";
        dateHeader.style.borderRadius = "5px";

        const dateText = document.createElement("span");
        dateText.textContent = new Date(date).toLocaleDateString("en-US", {
          weekday: "long",
          day: "numeric",
          month: "long",
          year: "numeric",
        });
        dateHeader.appendChild(dateText);

        const clearCacheButton = document.createElement("button");
        clearCacheButton.textContent = "♻️ Refresh Cache";
        clearCacheButton.style.padding = "5px 10px";

        clearCacheButton.style.fontSize = "12px";
        clearCacheButton.style.backgroundColor = "#f0f0f0";
        clearCacheButton.style.border = "1px solid #ccc";
        clearCacheButton.style.borderRadius = "3px";
        clearCacheButton.style.cursor = "pointer";
        clearCacheButton.addEventListener("click", () => {
          const origin = document
            .getElementById("airport-input")
            .value.toUpperCase();
          const cacheKey = `${origin}-${date}`;
          clearCache(cacheKey);
        });

        dateHeader.appendChild(clearCacheButton);
        resultsDiv.appendChild(dateHeader);
      }

      if (!flightList) {
        flightList = document.createElement("ul");
        flightList.setAttribute("data-date", date);
        flightList.style.listStyleType = "none";
        flightList.style.padding = "0";
        resultsDiv.appendChild(flightList);
      }

      const flightsToProcess = append ? [flights[flights.length - 1]] : flights;

      for (const flight of flightsToProcess) {
        const flightItem = document.createElement("li");
        flightItem.style.marginBottom = "15px";
        flightItem.style.padding = "10px";
        flightItem.style.border = "1px solid #ddd";
        flightItem.style.borderRadius = "5px";
        flightItem.style.display = "flex";
        flightItem.style.flexDirection = "column";
        flightItem.style.gap = "5px";

        const routeDiv = document.createElement("div");
        routeDiv.textContent = flight.route;
        routeDiv.style.fontWeight = "bold";
        routeDiv.style.marginBottom = "5px";

        const detailsDiv = document.createElement("div");
        detailsDiv.style.display = "flex";
        detailsDiv.style.justifyContent = "space-between";

        const departureDiv = document.createElement("div");
        departureDiv.textContent = `✈️ Departure: ${flight.departure}`;

        const arrivalDiv = document.createElement("div");
        arrivalDiv.textContent = `🛬 Arrival: ${flight.arrival}`;

        const durationDiv = document.createElement("div");
        durationDiv.textContent = `⏱️ Duration: ${flight.duration}`;

        detailsDiv.appendChild(departureDiv);
        detailsDiv.appendChild(arrivalDiv);
        detailsDiv.appendChild(durationDiv);

        flightItem.appendChild(routeDiv);
        flightItem.appendChild(detailsDiv);

        const origin = document
          .getElementById("airport-input")
          .value.toUpperCase();
        const returnCacheKey = `${origin}-${date}-return-${flight.route}`;
        const cachedReturnData = localStorage.getItem(returnCacheKey);

        if (!checkReturns && !cachedReturnData) {
          const findReturnButton = document.createElement("button");
          findReturnButton.textContent = "Find Return";
          findReturnButton.style.width = "100px";
          findReturnButton.classList.add(
            "button",
            "is-small",
            "is-primary",
            "mt-2",
            "has-text-white",
            "has-text-weight-bold",
            "is-size-7"
          );
          findReturnButton.addEventListener("click", () => {
            flight.element = flightItem;
            findReturnFlight(flight);
            findReturnButton.remove();
          });
          flightItem.appendChild(findReturnButton);
        } else if (cachedReturnData) {
          const { results: returnFlights } = JSON.parse(cachedReturnData);
          flight.element = flightItem;
          displayReturnFlights(flight, returnFlights);
        }

        flightList.appendChild(flightItem);
        flight.element = flightItem;
      }
    }
  }
}

async function findReturnFlight(outboundFlight) {
  const origin = outboundFlight.route.split(" to ")[1].split(" (")[0];
  const destination = outboundFlight.route.split(" to ")[0].split(" (")[0];
  const outboundDate = new Date(outboundFlight.date);
  const outboundArrivalTime = outboundFlight.arrival.split(" (")[0];

  const returnDates = [];
  for (let i = 0; i < 4; i++) {
    const date = new Date(outboundDate);
    date.setDate(outboundDate.getDate() + i);
    returnDates.push(formatDate(date));
  }

  const returnFlights = [];

  const progressElement = document.createElement("div");
  progressElement.classList.add("return-flight-progress");
  progressElement.style.marginTop = "10px";
  progressElement.style.fontSize = "0.9em";
  progressElement.style.color = "#000";
  outboundFlight.element.appendChild(progressElement);

  let checkedDates = 0;
  const updateProgress = () => {
    progressElement.textContent = `Checking return flights: ${checkedDates} of ${returnDates.length} dates checked...`;
  };

  updateProgress();

  for (const returnDate of returnDates) {
    console.log(`Checking return flights for ${returnDate}`);
    try {
      const flights = await checkRoute(origin, destination, returnDate);
      if (Array.isArray(flights)) {
        const validReturnFlights = flights.filter((flight) => {
          const [flightHours, flightMinutes] = flight.departure
            .split(" (")[0]
            .split(":");
          const flightDate = new Date(returnDate);
          flightDate.setHours(
            parseInt(flightHours, 10),
            parseInt(flightMinutes, 10),
            0,
            0
          );

          const [outboundHours, outboundMinutes] =
            outboundArrivalTime.split(":");
          const outboundArrival = new Date(outboundDate);
          outboundArrival.setHours(
            parseInt(outboundHours, 10),
            parseInt(outboundMinutes, 10),
            0,
            0
          );
          return flightDate > outboundArrival;
        });
        console.log(
          `Found ${validReturnFlights.length} valid return flights for ${returnDate}`
        );
        returnFlights.push(...validReturnFlights);
      } else {
        console.error(`Unexpected response format for ${returnDate}:`, flights);
      }
    } catch (error) {
      console.error(`Error checking return flight for ${returnDate}:`, error);
    }
    checkedDates++;
    updateProgress();
  }

  progressElement.remove();

  console.log(`Total return flights found: ${returnFlights.length}`);
  displayReturnFlights(outboundFlight, returnFlights);

  return returnFlights;
}

function calculateTimeAtDestination(outboundFlight, returnFlight) {
  const outboundArrival = new Date(
    `${outboundFlight.date} ${outboundFlight.arrival.split(" (")[0]}`
  );
  const returnDeparture = new Date(
    `${returnFlight.departureDate} ${returnFlight.departure.split(" (")[0]}`
  );

  const timeDiff = returnDeparture - outboundArrival;
  const days = Math.floor(timeDiff / (1000 * 60 * 60 * 24));
  const hours = Math.floor(
    (timeDiff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60)
  );

  return `${days} days and ${hours} hours`;
}

function displayReturnFlights(outboundFlight, returnFlights) {
  const flightItem = outboundFlight.element;
  if (!flightItem) {
    console.error("Flight item element not found");
    return;
  }

  const existingReturnFlights = flightItem.querySelector(".return-flights");
  if (existingReturnFlights) {
    existingReturnFlights.remove();
  }

  const returnFlightsDiv = document.createElement("div");
  returnFlightsDiv.classList.add("return-flights");
  returnFlightsDiv.style.marginTop = "15px";
  returnFlightsDiv.style.borderTop = "2px solid #ddd";
  returnFlightsDiv.style.paddingTop = "15px";

  const validReturnFlights = returnFlights.filter((flight) => {
    const timeAtDestination = calculateTimeAtDestination(
      outboundFlight,
      flight
    );
    const [days, hours] = timeAtDestination.split(" and ");
    return parseInt(days) > 0 || parseInt(hours) >= 1;
  });

  const header = document.createElement("h4");
  header.textContent = `Return Flights (${validReturnFlights.length} found)`;
  header.style.marginBottom = "15px";
  header.style.fontWeight = "bold";
  returnFlightsDiv.appendChild(header);

  if (validReturnFlights.length === 0) {
    const noFlightsMsg = document.createElement("p");
    noFlightsMsg.textContent =
      "No valid (>1h until return) flights found within the next 3 days.";
    noFlightsMsg.style.fontStyle = "italic";
    returnFlightsDiv.appendChild(noFlightsMsg);
  } else {
    const flightList = document.createElement("ul");
    flightList.style.listStyleType = "none";
    flightList.style.padding = "0";

    validReturnFlights.forEach((flight) => {
      const returnFlightItem = document.createElement("li");
      returnFlightItem.style.marginBottom = "15px";
      returnFlightItem.style.padding = "10px";
      returnFlightItem.style.border = "1px solid #ddd";
      returnFlightItem.style.borderRadius = "5px";

      const routeDiv = document.createElement("div");
      routeDiv.textContent = `${
        flight.departureStationText || flight.departureStation
      } to ${flight.arrivalStationText || flight.arrivalStation} - ${
        flight.flightCode
      }`;
      routeDiv.style.fontWeight = "bold";
      routeDiv.style.marginBottom = "5px";

      const dateDiv = document.createElement("div");
      dateDiv.textContent = `Date: ${new Date(
        flight.departureDate
      ).toLocaleDateString()}`;
      dateDiv.style.fontSize = "0.9rem";
      dateDiv.style.color = "#4a4a4a";
      dateDiv.style.marginBottom = "5px";

      const detailsDiv = document.createElement("div");
      detailsDiv.style.display = "flex";
      detailsDiv.style.justifyContent = "space-between";
      detailsDiv.style.fontSize = "0.9em";

      const departureDiv = document.createElement("div");
      departureDiv.textContent = `✈️ Departure: ${flight.departure} (${
        flight.departureOffsetText || ""
      })`;

      const arrivalDiv = document.createElement("div");
      arrivalDiv.textContent = `🛬 Arrival: ${flight.arrival} (${
        flight.arrivalOffsetText || ""
      })`;

      const durationDiv = document.createElement("div");
      durationDiv.textContent = `⏱️ Duration: ${flight.duration}`;

      const timeAtDestinationDiv = document.createElement("div");
      const timeAtDestination = calculateTimeAtDestination(
        outboundFlight,
        flight
      );
      timeAtDestinationDiv.textContent = `🕒 Time until return: ${timeAtDestination}`;
      timeAtDestinationDiv.style.fontSize = "0.9em";
      timeAtDestinationDiv.style.color = "#4a4a4a";
      timeAtDestinationDiv.style.marginTop = "5px";

      detailsDiv.appendChild(departureDiv);
      detailsDiv.appendChild(arrivalDiv);
      detailsDiv.appendChild(durationDiv);

      returnFlightItem.appendChild(routeDiv);
      returnFlightItem.appendChild(dateDiv);
      returnFlightItem.appendChild(detailsDiv);
      returnFlightItem.appendChild(timeAtDestinationDiv);
      flightList.appendChild(returnFlightItem);
    });

    returnFlightsDiv.appendChild(flightList);
  }

  flightItem.appendChild(returnFlightsDiv);
}

function displayCacheButton() {
  const cacheButton = document.createElement("button");
  cacheButton.id = "show-cache";
  cacheButton.textContent = "Show Last Results (8h)";
  cacheButton.classList.add(
    "button",
    "has-background-primary",
    "mb-4",
    "ml-2",
    "has-text-white"
  );

  const searchFlightsButton = document.getElementById("search-flights");
  searchFlightsButton.parentNode.insertBefore(
    cacheButton,
    searchFlightsButton.nextSibling
  );

  cacheButton.addEventListener("click", showCachedResults);
}

function showCachedResults() {
  const cacheKeys = Object.keys(localStorage).filter((key) =>
    key.match(/^[A-Z]+-\d{4}-\d{2}-\d{2}$/)
  );

  const resultsDiv = document.querySelector(".route-list");
  resultsDiv.innerHTML = "";

  const headerContainer = document.createElement("div");
  headerContainer.style.display = "flex";
  headerContainer.style.justifyContent = "space-between";
  headerContainer.style.alignItems = "center";
  headerContainer.style.marginBottom = "4px";

  if (cacheKeys.length !== 0) {
    const header = document.createElement("h2");
    header.textContent = "Last Results (8h)";
    headerContainer.appendChild(header);
    const clearAllButton = document.createElement("button");
    clearAllButton.textContent = "Clear All";
    clearAllButton.classList.add("button", "is-small", "is-danger", "is-light");
    clearAllButton.addEventListener("click", clearAllCachedResults);
    headerContainer.appendChild(clearAllButton);
  }

  resultsDiv.appendChild(headerContainer);

  if (cacheKeys.length === 0) {
    const noResultsMessage = document.createElement("p");
    noResultsMessage.textContent = "Searched flights will appear here.";
    noResultsMessage.style.color = "#0f0f0f";
    resultsDiv.appendChild(noResultsMessage);
    return;
  }

  cacheKeys.forEach((key) => {
    const [origin, year, month, day] = key.split("-");
    const date = new Date(year, month - 1, day);
    const dayOfWeek = [
      "Sunday",
      "Monday",
      "Tuesday",
      "Wednesday",
      "Thursday",
      "Friday",
      "Saturday",
    ][date.getDay()];
    const monthNames = [
      "Jan",
      "Feb",
      "Mar",
      "Apr",
      "May",
      "Jun",
      "Jul",
      "Aug",
      "Sep",
      "Oct",
      "Nov",
      "Dec",
    ];
    const formattedDate = `${dayOfWeek}, ${
      monthNames[date.getMonth()]
    } ${date.getDate()}`;

    const button = document.createElement("button");
    button.style.marginTop = "5px";
    button.textContent = `${origin} - ${formattedDate}`;
    button.classList.add("button", "is-small", "is-light", "mr-2", "mb-2");
    button.addEventListener("click", () => displayCachedResult(key));
    resultsDiv.appendChild(button);
  });
}

function clearAllCachedResults() {
  const cacheKeys = Object.keys(localStorage).filter((key) =>
    key.match(/^[A-Z]+-\d{4}-\d{2}-\d{2}$/)
  );

  cacheKeys.forEach((key) => {
    localStorage.removeItem(key);
  });

  const resultsDiv = document.querySelector(".route-list");
  resultsDiv.innerHTML = "<p>All cached results have been cleared.</p>";
}

function displayCachedResult(key) {
  const cachedData = localStorage.getItem(key);
  if (cachedData) {
    const { results, timestamp } = JSON.parse(cachedData);
    const [origin, year, month, day] = key.split("-");
    const date = `${year}-${month}-${day}`;

    const resultsDiv = document.querySelector(".route-list");
    resultsDiv.innerHTML = "";

    const cacheNotification = document.createElement("div");
    cacheNotification.textContent =
      'Using cached results. Click the "Refresh Cache" button to fetch new data.';
    cacheNotification.style.backgroundColor = "#e6f7ff";
    cacheNotification.style.border = "1px solid #91d5ff";
    cacheNotification.style.borderRadius = "4px";
    cacheNotification.style.padding = "10px";
    cacheNotification.style.marginBottom = "15px";

    const cacheInfoDiv = document.createElement("div");
    cacheInfoDiv.style.backgroundColor = "#e6f7ff";
    cacheInfoDiv.style.border = "1px solid #91d5ff";
    cacheInfoDiv.style.borderRadius = "4px";
    cacheInfoDiv.style.padding = "10px";
    cacheInfoDiv.style.marginBottom = "15px";

    const dateObj = new Date(date);
    const formattedDate = dateObj.toLocaleDateString("en-US", {
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
    });

    cacheInfoDiv.innerHTML = `<p>Showing cached results for ${origin} on ${formattedDate}</p>
                              <p>Cache date: ${new Date(
                                timestamp
                              ).toLocaleString()}</p>`;

    const refreshButton = document.createElement("button");
    refreshButton.textContent = "♻️ Refresh Cache";
    refreshButton.style.marginTop = "10px";
    refreshButton.classList.add("button", "is-small", "is-info", "is-light");
    refreshButton.addEventListener("click", () => {
      clearCache(key);
      checkAllRoutes();
    });

    cacheInfoDiv.appendChild(refreshButton);
    cacheInfoDiv.appendChild(cacheNotification);
    resultsDiv.appendChild(cacheInfoDiv);

    displayResults({ [date]: results });

    results.forEach(async (flight) => {
      const returnCacheKey = `${key}-return-${flight.route}`;
      const cachedReturnData = localStorage.getItem(returnCacheKey);
      if (cachedReturnData) {
        const { results: returnFlights } = JSON.parse(cachedReturnData);
        displayReturnFlights(flight, returnFlights);
      }
    });
  } else {
    alert("Cached data not found.");
  }
}

function checkCacheValidity() {
  const cacheKeys = Object.keys(localStorage).filter((key) =>
    key.match(/^[A-Z]+-\d{4}-\d{2}-\d{2}$/)
  );
  const eightHoursInMs = 8 * 60 * 60 * 1000;

  cacheKeys.forEach((key) => {
    const cachedData = localStorage.getItem(key);
    if (cachedData) {
      const { timestamp } = JSON.parse(cachedData);
      if (Date.now() - timestamp >= eightHoursInMs) {
        clearCache(key);
      }
    }
  });
}

document.addEventListener("DOMContentLoaded", () => {
  console.log("DOM content loaded");
  checkCacheValidity();
  const checkFlightsButton = document.getElementById("search-flights");
  const routeListElement = document.querySelector(".route-list");
  const airportInput = document.getElementById("airport-input");

  const lastAirport = localStorage.getItem("lastAirport");
  if (lastAirport) {
    airportInput.value = lastAirport;
  }

  airportInput.addEventListener("input", () => {
    localStorage.setItem("lastAirport", airportInput.value.toUpperCase());
  });

  if (!routeListElement) {
    console.error("Error: .route-list element not found in the DOM");
  }

  if (checkFlightsButton) {
    console.log("Check Flights button found");
    checkFlightsButton.addEventListener("click", () => {
      console.log("Check Flights button clicked");
      checkAllRoutes().catch((error) => {
        console.error("Error in checkAllRoutes:", error);
        if (routeListElement) {
          routeListElement.innerHTML = `<p>Error: ${error.message}</p>`;
        }
      });
    });
  } else {
    console.error("Check Flights button not found");
  }

  displayCacheButton();
});

document.addEventListener("DOMContentLoaded", function () {
  const dateSelect = document.getElementById("date-select");
  const today = new Date();

  for (let i = 0; i < 4; i++) {
    const date = new Date(today);
    date.setDate(today.getDate() + i);

    const option = document.createElement("option");
    option.value = date.toISOString().split("T")[0];
    option.textContent = date.toLocaleDateString("en-US", {
      weekday: "long",
      month: "short",
      day: "numeric",
    });

    dateSelect.appendChild(option);
  }
});
