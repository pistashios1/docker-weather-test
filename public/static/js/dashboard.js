const assetVersion = new URL(import.meta.url).searchParams.get("v") || "";
const versionedImport = (path) =>
  import(`${path}?v=${encodeURIComponent(assetVersion)}`);

const [
  { formatClock, formatUtcOffset, numberFormat },
  { isNumber, renderDaylight, renderWeather },
  { createSearchBox },
  { readStorage, writeStorage },
  { createMapMarker },
  { watchScrollFade },
] = await Promise.all([
  versionedImport("./format.js"),
  versionedImport("./render.js"),
  versionedImport("./search-box.js"),
  versionedImport("./storage.js"),
  versionedImport("./map-marker.js"),
  versionedImport("./scroll-fade.js"),
]);

const $ = (selector) => document.querySelector(selector);

const REQUEST_TIMEOUT_MS = 10000;
const IP_LOOKUP_TIMEOUT_MS = 6000;
const TOAST_MS = 8000;
const LOCATION_CACHE_TTL_MS = 15 * 60 * 1000;
const LOCATION_PROMPT_TIMEOUT_MS = 8000;
const UNIT_STORAGE_KEY = "weather-units";
const MAP_STORAGE_KEY = "weather-map-animation";
const USER_LOCATION_KEY = "user-location";
// The last place the visitor picked (search or "Use my location"), shown on return visits.
const LAST_LOCATION_KEY = "last-location";
const LAST_LOCATION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
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
const mapMarker = createMapMarker({ track: $("#map-track") });
watchScrollFade(forecast);

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
let selectedLocation = null;
let shownLocation = null; // The place lastData belongs to (selectedLocation can be newer)
let activeRequest = null; // AbortController of the in-flight weather request
let busy = false;
let locationAttempt = 0; // Bumped whenever a newer location choice supersedes a pending one
let localTimeTimer = null;

/* ---------- Units ---------- */

const currentUnits = () => document.querySelector('input[name="units"]:checked').value;

const isMetric = () => currentUnits() === "metric";

/* ---------- Recent places (shown in the empty search, and used to rank results) ---------- */

const RECENT_PLACES_KEY = "recent-places";
const RECENT_PLACES_LIMIT = 5;

const readRecentPlaces = () => {
  try {
    const value = JSON.parse(readStorage(RECENT_PLACES_KEY) || "[]");
    return Array.isArray(value)
      ? value
          .filter((place) =>
            typeof place?.name === "string" &&
            Number.isFinite(place.latitude) &&
            Number.isFinite(place.longitude))
          .map(({ name, context, latitude, longitude }) =>
            ({ name, context: typeof context === "string" ? context : "", latitude, longitude }))
          .slice(0, RECENT_PLACES_LIMIT)
      : [];
  } catch {
    return [];
  }
};

const rememberRecentPlace = ({ name, context = "", latitude, longitude }) => {
  const places = [
    { name, context, latitude, longitude },
    ...readRecentPlaces().filter((place) => !(place.name === name && place.context === context)),
  ].slice(0, RECENT_PLACES_LIMIT);
  writeStorage(RECENT_PLACES_KEY, JSON.stringify(places));
};

const recentNames = () => readRecentPlaces().map((place) => place.name);

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
  stopLocalTimeClock();
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

/* ---------- Rendering (render.js) ---------- */

const render = () => {
  if (!lastData) return;
  renderWeather(lastData, shownLocation.name, isMetric());
  updateLocalTime();
};


const stopLocalTimeClock = () => {
  if (localTimeTimer) {
    clearInterval(localTimeTimer);
    localTimeTimer = null;
  }
};

const updateLocalTime = () => {
  if (!lastData) return;
  const now = new Date();
  $("#local-time").textContent = formatClock(now, lastData.timezone);
  $("#utc-offset").textContent = formatUtcOffset(lastData.timezone, now);
  renderDaylight(lastData, now.getTime() / 1000);
};

const startLocalTimeClock = () => {
  stopLocalTimeClock();
  updateLocalTime();
  localTimeTimer = setInterval(updateLocalTime, 1000);
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
  stopLocalTimeClock();
  mapMarker.clear();
  announce("Loading weather…");

  try {
    const query = new URLSearchParams({
      latitude: selectedLocation.latitude,
      longitude: selectedLocation.longitude,
    });
    const data = await fetchJson(`/weather?${query}`, controller.signal);

    lastData = data;
    shownLocation = selectedLocation;
    render();
    mapMarker.setCoordinates(data.latitude, data.longitude);
    setState("ready");
    startLocalTimeClock();
    revealResult();
    announce(
      `Weather loaded for ${shownLocation.name}: ${$("#temperature").textContent}` +
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

const applyLocation = (location) => {
  locationAttempt += 1;
  selectedLocation = location;
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
// The IP estimate from this visit, so a refused "Use my location" can fall back to it.
let approximateLocation = null;
let approximateLookupFailed = false;

const fetchApproximateLocation = async () => {
  if (approximateLocation || approximateLookupFailed) return approximateLocation;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), IP_LOOKUP_TIMEOUT_MS);
  try {
    const data = await fetchJson("/location", controller.signal);
    if (Number.isFinite(data.latitude) && Number.isFinite(data.longitude)) {
      const name = typeof data.name === "string" ? data.name.trim() : "";
      approximateLocation = { latitude: data.latitude, longitude: data.longitude, name: name || "Your area" };
    }
  } catch {
    // Unavailable (private address, provider down, slow).
  } finally {
    clearTimeout(timer);
  }
  approximateLookupFailed = !approximateLocation;
  return approximateLocation;
};

const useApproximateLocation = async () => {
  const attempt = locationAttempt;
  setBusy(true);
  setState("loading");
  const location = await fetchApproximateLocation();
  if (attempt !== locationAttempt) return; // The visitor chose a place meanwhile.
  if (location) applyLocation(location);
  else requestPreciseLocation(); // No estimate: ask the browser instead.
};

// Show the weather that is already loaded again (after the "locating" state).
const showCurrentWeather = () => {
  setBusy(false);
  setState("ready");
  startLocalTimeClock();
  announce(`Showing weather for ${shownLocation.name}.`);
};

// The precise lookup failed or was refused. Say why, then keep the place already
// on screen (usually the IP estimate); with nothing on screen use the IP
// estimate, and only when that is unavailable too, New York.
const useFallbackLocation = async (message, attempt) => {
  showToast(message);
  if (shownLocation && lastData) {
    // The weather on screen may be for an earlier place if a newer load failed.
    selectedLocation = shownLocation;
    showCurrentWeather();
    return;
  }
  const location = await fetchApproximateLocation();
  if (attempt !== locationAttempt) return;
  applyLocation(location || DEFAULT_LOCATION);
};

const readSavedLocation = (key, maxAgeMs) => {
  try {
    const value = JSON.parse(readStorage(key) || "null");
    const name = typeof value?.name === "string" ? value.name.trim() : "";
    return value &&
      Number.isFinite(value.latitude) &&
      Number.isFinite(value.longitude) &&
      name &&
      Number.isFinite(value.savedAt) &&
      Date.now() - value.savedAt < maxAgeMs
      ? { latitude: value.latitude, longitude: value.longitude, name }
      : null;
  } catch {
    return null;
  }
};

const saveLocation = (key, location) => {
  const { latitude, longitude, name } = location;
  writeStorage(key, JSON.stringify({ latitude, longitude, name, savedAt: Date.now() }));
};

const readUserLocation = () => {
  const location = readSavedLocation(USER_LOCATION_KEY, LOCATION_CACHE_TTL_MS);
  return location &&
    !["Your location", "Current location", "Location unavailable"].includes(location.name)
    ? location
    : null;
};

const rememberUserLocation = (location) => saveLocation(USER_LOCATION_KEY, location);

const sameLocation = (left, right) =>
  left &&
  right &&
  left.latitude === right.latitude &&
  left.longitude === right.longitude;

const useCachedUserLocation = () => {
  const location = readUserLocation();
  if (!location) return false;

  // Compare with the place on screen: selectedLocation can be a newer pick whose load failed.
  if (sameLocation(shownLocation, location) && lastData) {
    selectedLocation = shownLocation;
    showCurrentWeather();
    return true;
  }

  applyLocation(location);
  return true;
};

const resolveBrowserLocation = async ({ coords }, attempt) => {
  const cached = readUserLocation();
  let name = sameLocation(cached, coords) ? cached.name : "";
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), IP_LOOKUP_TIMEOUT_MS);
  try {
    const data = await fetchJson(
      `/reverse-location?latitude=${coords.latitude}&longitude=${coords.longitude}`,
      controller.signal
    );
    const resolvedName = typeof data.name === "string" ? data.name.trim() : "";
    if (resolvedName) name = resolvedName;
  } catch {
    // Unavailable or too slow: the weather still works without a place name.
  } finally {
    clearTimeout(timer);
  }
  if (attempt !== locationAttempt) return; // The visitor picked a city meanwhile.
  if (!name) name = "Your location";
  const location = { latitude: coords.latitude, longitude: coords.longitude, name };
  rememberUserLocation(location);
  saveLocation(LAST_LOCATION_KEY, location);
  applyLocation(location);
};

const requestPreciseLocation = () => {
  const attempt = locationAttempt;
  setBusy(true);
  setState("locating");

  if (!navigator.geolocation) {
    useFallbackLocation(MESSAGE_UNAVAILABLE, attempt);
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
  const fail = (error, failedAttempt) =>
    useFallbackLocation(error && error.code === 1 ? MESSAGE_DENIED : MESSAGE_UNAVAILABLE, failedAttempt);
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

/* ---------- Search ---------- */

// "5,837 km" or "3,627 mi", following the unit toggle.
const describeDistance = (kilometres) => {
  if (!isNumber(kilometres)) return "";
  const value = isMetric() ? kilometres : kilometres / 1.609344;
  return value < 1 ? "Nearby" : `${numberFormat(0).format(value)} ${isMetric() ? "km" : "mi"}`;
};

const searchBox = createSearchBox({
  input: searchInput,
  popup: $("#search-popup"),
  message: $("#search-message"),
  list: $("#search-results"),
  announce,
  recentPlaces: readRecentPlaces,
  describeDistance,
  cacheContext: () =>
    `${selectedLocation?.latitude ?? ""},${selectedLocation?.longitude ?? ""}|${recentNames().join(",")}`,
  search: async (query, signal) => {
    const origin = selectedLocation || DEFAULT_LOCATION;
    const params = new URLSearchParams({
      q: query,
      latitude: origin.latitude,
      longitude: origin.longitude,
      affinity: recentNames().join(","),
    });
    const data = await fetchJson(`/search?${params}`, signal);
    return data.results || [];
  },
  onSelect: (location) => {
    rememberRecentPlace(location);
    saveLocation(LAST_LOCATION_KEY, location);
    applyLocation(location);
  },
});

/* ---------- Events ---------- */

form.addEventListener("submit", (event) => {
  event.preventDefault();
  searchBox.submit();
});

locationButton.addEventListener("click", () => {
  if (!busy) useMyLocation();
});

retryButton.addEventListener("click", () => {
  if (!busy) loadWeather(); // Retry the place that failed.
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

// A returning visitor sees the place they last picked; the IP estimate and the
// permission prompt are only for first visits (or after 30 days).
const lastLocation = readSavedLocation(LAST_LOCATION_KEY, LAST_LOCATION_TTL_MS);
if (lastLocation) applyLocation(lastLocation);
else if (!useCachedUserLocation()) useApproximateLocation();
