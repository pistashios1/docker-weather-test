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
    daylightStatus,
    forecastStartIndex,
    formatDuration,
    mphToKmh,
    numberFormat,
    formatUtcOffset,
    compassPoint,
    hpaToInHg,
    metresToDistance,
    uvCategory,
    toneForFahrenheit,
  },
  { createSearchBox },
  { readStorage, writeStorage },
  { createMapMarker },
  { watchScrollFade },
] = await Promise.all([
  versionedImport("./format.js"),
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
const FORECAST_HOURS = 12;
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

// The numbers shown in the details row (wind is shown in the hero).
// Optional values can be missing or null upstream; show "--" for just that one.
const isNumber = (value) => typeof value === "number" && Number.isFinite(value);
const formatOr = (value, digits, suffix = "") =>
  isNumber(value) ? `${numberFormat(digits).format(value)}${suffix}` : "--";

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
  const currentIndex = forecastStartIndex(hourly.time, lastData.current.time);
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
        ["forecast-time", index === 0 ? time : formatHour(time, lastData.timezone)],
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
  updateLocalTime();
  $("#condition").textContent = `${condition.icon} ${condition.label}`;
  $("#temperature").textContent = numberFormat(0).format(temperature);
  $("#temperature-unit").textContent = metric ? "°C" : "°F";
  $("#wind").textContent = numberFormat(1).format(wind);
  $("#wind-unit").textContent = metric ? "km/h" : "mph";
  renderWindDirection(current.wind_direction_10m);
  renderDetails(metric);

  panel.dataset.tone = toneForFahrenheit(current.temperature_2m);
  panel.dataset.condition = condition.key;
  // Open-Meteo's is_day is 1 or 0; a missing value keeps the day look.
  panel.dataset.daylight = current.is_day === 0 ? "night" : "day";
  renderForecast();
};

const renderWindDirection = (degrees) => {
  const arrow = $("#wind-arrow");
  arrow.hidden = !isNumber(degrees);
  $("#wind-direction").textContent = isNumber(degrees) ? `from ${compassPoint(degrees)}` : "--";
  // The arrow points the way the wind blows, opposite to where it comes from.
  if (isNumber(degrees)) arrow.style.setProperty("--wind-rotate", `${degrees + 180}deg`);
};

const renderDetails = (metric) => {
  const { current, daily } = lastData;
  // Today's row of the daily summaries: the last day starting at or before now.
  const day = daily && Array.isArray(daily.time)
    ? forecastStartIndex(daily.time, current.time)
    : -1;
  const today = (field) => (day >= 0 && Array.isArray(daily[field]) ? daily[field][day] : null);
  const degrees = (fahrenheit) =>
    isNumber(fahrenheit) ? formatOr(metric ? fahrenheitToCelsius(fahrenheit) : fahrenheit, 0, "°") : "--";
  const clamp = (value) => (isNumber(value) ? Math.max(0, value) : value);

  $("#feels-like").textContent = degrees(current.apparent_temperature);
  $("#temp-high").textContent = degrees(today("temperature_2m_max"));
  $("#temp-low").textContent = degrees(today("temperature_2m_min"));

  $("#precip-chance").textContent = formatOr(clamp(today("precipitation_probability_max")), 0, "% chance");
  $("#precip-total").textContent = isNumber(today("precipitation_sum"))
    ? `${formatOr(clamp(today("precipitation_sum")), 1, " mm")} today`
    : "--";
  const rainNow = clamp(current.rain);
  $("#rain-now").hidden = !(rainNow > 0);
  $("#rain-now").textContent = rainNow > 0 ? `Raining now: ${formatOr(rainNow, 1, " mm")}` : "";

  // Shown only when snow is falling now or expected today.
  const snowToday = clamp(today("snowfall_sum"));
  const snowNow = clamp(current.snowfall);
  $("#snow-row").hidden = !(snowToday > 0 || snowNow > 0);
  $("#snowfall").textContent = snowToday > 0
    ? `${formatOr(snowToday, 1, " cm")} today`
    : `${formatOr(snowNow, 1, " cm")} now`;

  $("#humidity").textContent = formatOr(clamp(current.relative_humidity_2m), 0, "%");
  $("#dew-point").textContent = degrees(current.dew_point_2m);
  $("#pressure").textContent = isNumber(current.pressure_msl)
    ? metric
      ? formatOr(current.pressure_msl, 0, " hPa")
      : formatOr(hpaToInHg(current.pressure_msl), 2, " inHg")
    : "--";
  const distance = isNumber(current.visibility)
    ? metresToDistance(Math.max(0, current.visibility), metric)
    : null;
  $("#visibility").textContent = formatOr(distance, distance >= 10 ? 0 : 1, metric ? " km" : " mi");
  // "3.1 / 4.2": the current reading is the headline, today's peak is muted beside it.
  const uvNow = clamp(current.uv_index);
  const uvMax = clamp(today("uv_index_max"));
  const uvMaxPart = document.createElement("span");
  uvMaxPart.className = "uv-max";
  uvMaxPart.textContent = ` / ${formatOr(uvMax, 1)}`;
  const uvSpoken = document.createElement("span");
  uvSpoken.className = "visually-hidden";
  uvSpoken.textContent = " (now, of today's max)";
  $("#uv-index").replaceChildren(formatOr(uvNow, 1), uvMaxPart, uvSpoken);
  $("#uv-level").textContent = isNumber(uvNow)
    ? `Now / today's max · ${uvCategory(uvNow)}`
    : "Now / today's max";

  const sunrise = today("sunrise");
  const sunset = today("sunset");
  $("#sunrise").textContent = isNumber(sunrise) ? formatClock(sunrise, lastData.timezone) : "--";
  $("#sunset").textContent = isNumber(sunset) ? formatClock(sunset, lastData.timezone) : "--";
  $("#day-length").textContent = isNumber(sunrise) && isNumber(sunset) && sunset > sunrise
    ? `${formatDuration(sunset - sunrise)} of daylight`
    : "--";
};

// The Sunset tile's countdown and daylight bar. Runs with the clock, so it moves
// on while the page stays open.
const renderDaylight = (now) => {
  const daily = lastData.daily;
  const times = daily && Array.isArray(daily.time) ? daily.time : null;
  const day = times ? forecastStartIndex(times, now) : -1;
  const at = (field, index) =>
    day >= 0 && Array.isArray(daily[field]) ? daily[field][index] ?? null : null;
  const { text, progress } = daylightStatus({
    now,
    sunrise: at("sunrise", day),
    sunset: at("sunset", day),
    nextSunrise: at("sunrise", day + 1),
  });
  $("#daylight-left").textContent = text ?? "--";
  $("#daylight-track").hidden = progress === null;
  if (progress !== null) {
    $("#daylight-fill").style.setProperty("--daylight", String(Math.min(1, Math.max(0, progress))));
  }
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
  renderDaylight(now.getTime() / 1000);
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
  announce(`Showing weather for ${selectedLocation.name}.`);
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

  if (sameLocation(selectedLocation, location) && lastData) {
    showCurrentWeather();
    return true;
  }

  applyLocation(location);
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

const refreshWeather = () => {
  const location = readUserLocation();
  if (location && !sameLocation(selectedLocation, location)) {
    applyLocation(location);
  } else {
    loadWeather();
  }
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

// A returning visitor sees the place they last picked; the IP estimate and the
// permission prompt are only for first visits (or after 30 days).
const lastLocation = readSavedLocation(LAST_LOCATION_KEY, LAST_LOCATION_TTL_MS);
if (lastLocation) applyLocation(lastLocation);
else if (!useCachedUserLocation()) useApproximateLocation();
