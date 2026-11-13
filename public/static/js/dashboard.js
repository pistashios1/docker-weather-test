const assetVersion = new URL(import.meta.url).searchParams.get("v") || "";
const versionedImport = (path) =>
  import(`${path}?v=${encodeURIComponent(assetVersion)}`);

const [
  {
    conditionForCode,
    fahrenheitToCelsius,
    formatClock,
    formatCoordinates,
    formatHour,
    mphToKmh,
    numberFormat,
    formatUtcOffset,
    toneForFahrenheit,
  },
  { createSearchBox },
  { readStorage, writeStorage },
  { createMapMarker },
] = await Promise.all([
  versionedImport("./format.js"),
  versionedImport("./search-box.js"),
  versionedImport("./storage.js"),
  versionedImport("./map-marker.js"),
]);

const $ = (selector) => document.querySelector(selector);

const REQUEST_TIMEOUT_MS = 10000;
const IP_LOOKUP_TIMEOUT_MS = 6000;
const TOAST_MS = 8000;
const LOCATION_CACHE_TTL_MS = 15 * 60 * 1000;
const LOCATION_PROMPT_TIMEOUT_MS = 8000;
const FORECAST_HOURS = 12;
const UNIT_STORAGE_KEY = "weather-units";
const SEARCH_AFFINITY_KEY = "weather-search-affinity";
const MAP_STORAGE_KEY = "weather-map-animation";
const USER_LOCATION_KEY = "user-location";
const DEFAULT_LOCATION = { latitude: 40.7128, longitude: -74.006, name: "New York" };

const form = $("#weather-form");
const searchInput = $("#location-search");
const locationButton = $("#location-button");
const searchButton = $("#search-button");
const retryButton = $("#retry-button");
const unitRadios = document.querySelectorAll('input[name="units"]');
const panel = $("#panel");
const status = $("#status");
const forecast = $("#forecast");
const mapMarker = createMapMarker({
  track: $("#map-track"),
  markers: document.querySelectorAll("[data-map-marker]"),
});

const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
const FORECAST_SCROLL_FACTOR = 0.85;

forecast.addEventListener(
  "wheel",
  (event) => {
    const isMouseWheel = event.deltaMode === WheelEvent.DOM_DELTA_LINE ||
      (event.deltaMode === WheelEvent.DOM_DELTA_PIXEL &&
        Number.isInteger(event.deltaY) &&
        Math.abs(event.deltaY) >= 40);
    if (!isMouseWheel || event.deltaX !== 0 || event.deltaY === 0) return;
    event.preventDefault();
    forecast.scrollBy({
      left: event.deltaY * FORECAST_SCROLL_FACTOR,
      behavior: prefersReducedMotion.matches ? "auto" : "smooth",
    });
  },
  { passive: false }
);

let lastData = null; // Latest /weather payload (imperial units)
let lastFetchedAt = null;
let selectedLocation = null;
let activeRequest = null; // AbortController of the in-flight weather request
let busy = false;
let locationAttempt = 0; // Bumped whenever a newer location choice supersedes a pending one

/* ---------- Units ---------- */

const currentUnits = () => document.querySelector('input[name="units"]:checked').value;

const isMetric = () => currentUnits() === "metric";

// The numbers shown in the details row (wind is shown in the hero).
const detailMetrics = [
  { id: "precipitation", value: (current) => Math.max(0, current.rain), digits: 1 },
  { id: "humidity", value: (current) => Math.max(0, current.relative_humidity_2m), digits: 0 },
  { id: "uv-index", value: (current) => Math.max(0, current.uv_index), digits: 1 },
];

/* ---------- Search history (used to rank search results) ---------- */

const readSearchAffinity = () => {
  try {
    const value = JSON.parse(readStorage(SEARCH_AFFINITY_KEY) || "[]");
    return Array.isArray(value) ? value.filter((item) => typeof item === "string").slice(0, 10) : [];
  } catch {
    return [];
  }
};

const rememberSearchAffinity = (name) => {
  const names = [name, ...readSearchAffinity().filter((item) => item !== name)].slice(0, 10);
  writeStorage(SEARCH_AFFINITY_KEY, JSON.stringify(names));
};

/* ---------- UI state ---------- */

const setState = (state) => {
  panel.dataset.state = state;
  panel.setAttribute("aria-busy", String(state === "loading"));
};

const announce = (text) => {
  status.textContent = text;
};

const setBusy = (value) => {
  busy = value;
  locationButton.disabled = value;
  searchButton.disabled = value;
  retryButton.disabled = value;
};

// Server messages are short lowercase phrases ("weather service unavailable").
const toSentence = (text) => {
  const trimmed = String(text).trim();
  return trimmed ? `${trimmed[0].toUpperCase()}${trimmed.slice(1).replace(/[.!?]?$/, ".")}` : "";
};

const showError = (text) => {
  // The error block has role="alert", so it is announced when it appears.
  $("#error-message").textContent = toSentence(text) || "Unable to load weather.";
  setState("error");
};

// On a small screen the result can start below the fold; bring it into view.
const revealResult = () => {
  if (panel.getBoundingClientRect().top > window.innerHeight * 0.55) {
    panel.scrollIntoView({
      behavior: prefersReducedMotion.matches ? "auto" : "smooth",
      block: "start",
    });
  }
};

/* ---------- Rendering ---------- */

const renderForecast = () => {
  const hourly = lastData.hourly;
  if (!hourly || !Array.isArray(hourly.time) || !hourly.time.length) {
    const unavailable = document.createElement("p");
    unavailable.className = "forecast-condition";
    unavailable.textContent = "Hourly forecast unavailable.";
    forecast.replaceChildren(unavailable);
    return;
  }

  const metric = isMetric();
  const rawCurrentTime = typeof lastData.current?.time === "string" ? lastData.current.time : "";
  const currentTime = rawCurrentTime.length >= 13 ? `${rawCurrentTime.slice(0, 13)}:00` : "";
  const currentIndex = currentTime
    ? Math.max(
        0,
        hourly.time.findIndex((time) => time >= currentTime)
      )
    : 0;
  const times = hourly.time.slice(currentIndex + 1, currentIndex + FORECAST_HOURS);
  const temperatures = hourly.temperature_2m.slice(currentIndex + 1, currentIndex + FORECAST_HOURS);
  const weatherCodes = hourly.weather_code.slice(currentIndex + 1, currentIndex + FORECAST_HOURS);
  const forecastItems = [
    {
      time: "Now",
      temperature: lastData.current.temperature_2m,
      weatherCode: lastData.current.weather_code,
    },
    ...times.map((time, index) => ({
      time,
      temperature: temperatures[index],
      weatherCode: weatherCodes[index],
    })),
  ];
  forecast.replaceChildren(
    ...forecastItems.map(({ time, temperature: fahrenheit, weatherCode }, index) => {
      const condition = conditionForCode(Number(weatherCode));
      const temperature = metric ? fahrenheitToCelsius(fahrenheit) : fahrenheit;

      const card = document.createElement("div");
      card.className = "forecast-card";
      const parts = [
        ["forecast-time", index === 0 ? time : formatHour(time)],
        ["forecast-symbol", condition.icon],
        ["forecast-temperature", `${numberFormat(0).format(temperature)}°`],
        ["forecast-condition", condition.label],
      ];
      parts.forEach(([className, text]) => {
        const span = document.createElement("span");
        span.className = className;
        span.textContent = text;
        if (className === "forecast-symbol") span.setAttribute("aria-hidden", "true");
        card.append(span);
      });
      return card;
    })
  );
};

const render = () => {
  if (!lastData) return;

  const { current } = lastData;
  const metric = isMetric();
  const temperature = metric ? fahrenheitToCelsius(current.temperature_2m) : current.temperature_2m;
  const wind = metric ? mphToKmh(current.wind_speed_10m) : current.wind_speed_10m;
  const condition = conditionForCode(Number(current.weather_code));

  $("#location-name").textContent = selectedLocation.name;
  $("#coordinates").textContent = formatCoordinates(lastData.latitude, lastData.longitude);
  $("#local-time").textContent = formatClock(current.time || lastFetchedAt);
  $("#utc-offset").textContent = formatUtcOffset(lastData.timezone);
  $("#condition").textContent = `${condition.icon} ${condition.label}`;
  $("#temperature").textContent = numberFormat(0).format(temperature);
  $("#temperature-unit").textContent = metric ? "°C" : "°F";
  $("#wind").textContent = numberFormat(1).format(wind);
  $("#wind-unit").textContent = metric ? "km/h" : "mph";
  detailMetrics.forEach(({ id, value, digits }) => {
    document.getElementById(id).textContent = numberFormat(digits).format(value(current));
  });

  panel.dataset.tone = toneForFahrenheit(current.temperature_2m);
  panel.dataset.condition = condition.key;
  renderForecast();
};

/* ---------- Network ---------- */

const fetchJson = async (url, signal) => {
  const response = await fetch(url, { signal });
  const contentType = response.headers.get("content-type") || "";

  if (!contentType.includes("application/json")) {
    throw new Error(`Unexpected response from the server (${response.status}).`);
  }

  const data = await response.json();
  if (!response.ok) {
    if (response.status === 429) {
      const retryAfter = response.headers.get("Retry-After");
      const wait = retryAfter ? ` Try again in ${retryAfter} seconds.` : "";
      throw new Error(`Too many requests.${wait}`);
    }
    throw new Error(data.error || `Request failed (${response.status}).`);
  }
  return data;
};

const isCompleteWeather = (data) => {
  const current = data && data.current;
  return Boolean(current) && [
    "temperature_2m",
    "wind_speed_10m",
    "weather_code",
    "rain",
    "relative_humidity_2m",
    "uv_index",
  ].every((key) => typeof current[key] === "number");
};

const loadWeather = async () => {
  if (!selectedLocation) {
    setBusy(false);
    setState(lastData ? "ready" : "empty");
    return;
  }

  if (activeRequest) activeRequest.abort();
  const controller = new AbortController();
  activeRequest = controller;
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  setBusy(true);
  setState("loading");
  mapMarker.clear();
  announce("Loading weather…");

  try {
    const query = new URLSearchParams({
      latitude: selectedLocation.latitude,
      longitude: selectedLocation.longitude,
    });
    const data = await fetchJson(`/weather?${query}`, controller.signal);
    if (!isCompleteWeather(data)) {
      throw new Error("The weather service returned incomplete data.");
    }

    lastData = data;
    lastFetchedAt = new Date();
    render();
    mapMarker.setCoordinates(data.latitude, data.longitude);
    setState("ready");
    revealResult();
    announce(
      `Weather loaded for ${selectedLocation.name}: ${$("#temperature").textContent}` +
        `${$("#temperature-unit").textContent}, ${$("#condition").textContent.replace(/^\S+\s/, "")}, ` +
        `wind ${$("#wind").textContent} ${$("#wind-unit").textContent}.`
    );
  } catch (error) {
    if (error.name === "AbortError") {
      if (activeRequest !== controller) return; // superseded by a newer request
      showError("The request timed out. Check your connection and try again.");
    } else {
      showError(error.message || "Unable to load weather.");
    }
  } finally {
    clearTimeout(timer);
    if (activeRequest === controller) {
      activeRequest = null;
      setBusy(false);
    }
  }
};

/* ---------- Location ---------- */

const applyLocation = (location, updateSearchField = true) => {
  locationAttempt += 1;
  selectedLocation = location;
  if (updateSearchField) searchInput.value = location.name;
  loadWeather();
};

/* ---------- Toast (short message that dismisses itself) ---------- */

const toast = $("#toast");
const toastText = $("#toast-text");
let toastTimer = null;

const hideToast = () => {
  clearTimeout(toastTimer);
  toast.hidden = true;
};

const showToast = (text) => {
  clearTimeout(toastTimer);
  toastText.textContent = text;
  toast.hidden = false;
  toastTimer = setTimeout(hideToast, TOAST_MS);
};

$("#toast-close").addEventListener("click", hideToast);

const MESSAGE_DENIED = "Location permission was denied.";
const MESSAGE_UNAVAILABLE = "Your location could not be found.";

// Start-up order:
//   1. Ask the server to estimate a position from the visitor's IP address
//      (/location). This is silent: the visitor sees the normal loading
//      state, then weather.
//   2. If that fails, ask the browser for permission straight away.
//   3. If permission is denied (or the position can't be found), show New York.
// "Use my location" goes straight to the browser's permission prompt.
const useApproximateLocation = async () => {
  const attempt = locationAttempt;
  setBusy(true);
  setState("loading");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), IP_LOOKUP_TIMEOUT_MS);
  let location = null;
  try {
    const data = await fetchJson("/location", controller.signal);
    if (Number.isFinite(data.latitude) && Number.isFinite(data.longitude)) {
      const name = typeof data.name === "string" ? data.name.trim() : "";
      location = { latitude: data.latitude, longitude: data.longitude, name: name || "Your area" };
    }
  } catch {
    // Unavailable (private address, provider down, slow): ask the browser instead.
  } finally {
    clearTimeout(timer);
  }

  if (attempt !== locationAttempt) return; // The visitor chose a place meanwhile.
  if (location) applyLocation(location, false);
  else requestPreciseLocation();
};

// The precise lookup failed or was refused: show New York and say why.
const useDefaultLocation = (message) => {
  showToast(message);
  applyLocation(DEFAULT_LOCATION, false);
};

const readUserLocation = () => {
  try {
    const value = JSON.parse(readStorage(USER_LOCATION_KEY) || "null");
    const name = typeof value?.name === "string" ? value.name.trim() : "";
    return value &&
      Number.isFinite(value.latitude) &&
      Number.isFinite(value.longitude) &&
      name &&
      Number.isFinite(value.savedAt) &&
      Date.now() - value.savedAt < LOCATION_CACHE_TTL_MS &&
      !["Your location", "Current location", "Location unavailable"].includes(name)
      ? { ...value, name }
      : null;
  } catch {
    return null;
  }
};

const rememberUserLocation = (location) => {
  writeStorage(USER_LOCATION_KEY, JSON.stringify({ ...location, savedAt: Date.now() }));
};

const sameLocation = (left, right) =>
  left &&
  right &&
  left.latitude === right.latitude &&
  left.longitude === right.longitude;

const useCachedUserLocation = () => {
  const location = readUserLocation();
  if (!location) return false;

  if (sameLocation(selectedLocation, location) && lastData) {
    setBusy(false);
    setState("ready");
    announce(`Showing weather for ${location.name}.`);
    return true;
  }

  applyLocation(location, false);
  return true;
};

const resolveBrowserLocation = async ({ coords }, attempt) => {
  const cached = readUserLocation();
  let name = sameLocation(cached, coords) ? cached.name : "";
  try {
    const data = await fetchJson(
      `/reverse-location?latitude=${coords.latitude}&longitude=${coords.longitude}`
    );
    const resolvedName = typeof data.name === "string" ? data.name.trim() : "";
    if (resolvedName) name = resolvedName;
  } catch {
    // Weather still works when reverse geocoding is unavailable.
  }
  if (!name) name = "Your location";
  const location = { latitude: coords.latitude, longitude: coords.longitude, name };
  rememberUserLocation(location);
  if (attempt !== locationAttempt) return; // The visitor picked a city meanwhile.
  applyLocation(location, false);
};

const requestPreciseLocation = () => {
  const attempt = locationAttempt;
  setBusy(true);
  setState("locating");

  if (!navigator.geolocation) {
    useDefaultLocation(MESSAGE_UNAVAILABLE);
    return;
  }

  // The browser's permission prompt is triggered only from here, which runs
  // when the visitor clicks "Use my location" or when the IP lookup failed.
  announce("Requesting your location…");

  let settled = false;
  const settle = (handler) => (...args) => {
    if (settled) return;
    settled = true;
    clearTimeout(promptTimer);
    if (attempt !== locationAttempt) return;
    handler(...args, attempt);
  };
  const fail = (error) =>
    useDefaultLocation(error && error.code === 1 ? MESSAGE_DENIED : MESSAGE_UNAVAILABLE);
  const promptTimer = setTimeout(settle(fail), LOCATION_PROMPT_TIMEOUT_MS);

  navigator.geolocation.getCurrentPosition(settle(resolveBrowserLocation), settle(fail), {
    enableHighAccuracy: false,
    timeout: LOCATION_PROMPT_TIMEOUT_MS,
    maximumAge: 300000,
  });
};

const useMyLocation = () => {
  searchInput.value = "";
  hideToast();
  if (useCachedUserLocation()) return;
  requestPreciseLocation();
};

const refreshWeather = () => {
  const location = readUserLocation();
  if (location && !sameLocation(selectedLocation, location)) {
    applyLocation(location, false);
  } else {
    loadWeather();
  }
};

/* ---------- Search ---------- */

const searchBox = createSearchBox({
  input: searchInput,
  popup: $("#search-popup"),
  message: $("#search-message"),
  list: $("#search-results"),
  announce,
  cacheContext: () =>
    `${selectedLocation?.latitude ?? ""},${selectedLocation?.longitude ?? ""}|${readSearchAffinity().join(",")}`,
  search: async (query, signal) => {
    const origin = selectedLocation || DEFAULT_LOCATION;
    const params = new URLSearchParams({
      q: query,
      latitude: origin.latitude,
      longitude: origin.longitude,
      affinity: readSearchAffinity().join(","),
    });
    const data = await fetchJson(`/search?${params}`, signal);
    return data.results || [];
  },
  onSelect: (location) => {
    rememberSearchAffinity(location.name);
    applyLocation(location);
  },
});

/* ---------- Events ---------- */

form.addEventListener("submit", (event) => {
  event.preventDefault();
  searchBox.run();
});

locationButton.addEventListener("click", () => {
  if (!busy) useMyLocation();
});

retryButton.addEventListener("click", () => {
  if (!busy) refreshWeather();
});

unitRadios.forEach((radio) => {
  radio.addEventListener("change", () => {
    writeStorage(UNIT_STORAGE_KEY, currentUnits());
    render();
  });
});

/* ---------- Background map: pause and play ---------- */

const mapBackground = $("#map-bg");
const mapToggle = $("#map-toggle");

const setMapAnimation = (on) => {
  mapBackground.dataset.animate = String(on);
  mapToggle.setAttribute("aria-checked", String(on));
};

mapToggle.addEventListener("click", () => {
  const next = mapToggle.getAttribute("aria-checked") !== "true";
  setMapAnimation(next);
  writeStorage(MAP_STORAGE_KEY, next ? "on" : "off");
});

/* ---------- Start ---------- */

const storedUnits = readStorage(UNIT_STORAGE_KEY);
if (storedUnits === "metric" || storedUnits === "imperial") {
  document.querySelector(`input[name="units"][value="${storedUnits}"]`).checked = true;
}
setMapAnimation(readStorage(MAP_STORAGE_KEY) !== "off");

if (!useCachedUserLocation()) useApproximateLocation();
