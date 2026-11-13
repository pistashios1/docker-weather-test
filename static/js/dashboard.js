import {
  conditionForCode,
  fahrenheitToCelsius,
  formatClock,
  formatCoordinates,
  formatHour,
  mphToKmh,
  numberFormat,
  toneForFahrenheit,
} from "./format.js";
import { createSearchBox } from "./search-box.js";
import { readStorage, writeStorage } from "./storage.js";

const $ = (selector) => document.querySelector(selector);

const REQUEST_TIMEOUT_MS = 10000;
const PERMISSION_WAIT_MS = 8000;
const FORECAST_HOURS = 12;
const UNIT_STORAGE_KEY = "weather-units";
const SEARCH_AFFINITY_KEY = "weather-search-affinity";
const MAP_STORAGE_KEY = "weather-map-animation";
const DEFAULT_LOCATION = { latitude: 40.7128, longitude: -74.006, name: "New York" };

const form = $("#weather-form");
const searchInput = $("#location-search");
const locationButton = $("#location-button");
const searchButton = $("#search-button");
const retryButton = $("#retry-button");
const unitRadios = document.querySelectorAll('input[name="units"]');
const panel = $("#panel");
const status = $("#status");

const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

let lastData = null; // Latest /weather payload (imperial units)
let lastFetchedAt = null;
let selectedLocation = null;
let activeRequest = null; // AbortController of the in-flight weather request
let busy = false;

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
  const forecast = $("#forecast");
  const hourly = lastData.hourly;
  if (!hourly || !Array.isArray(hourly.time) || !hourly.time.length) {
    const unavailable = document.createElement("p");
    unavailable.className = "forecast-condition";
    unavailable.textContent = "Hourly forecast unavailable.";
    forecast.replaceChildren(unavailable);
    return;
  }

  const metric = isMetric();
  forecast.replaceChildren(
    ...hourly.time.slice(0, FORECAST_HOURS).map((time, index) => {
      const condition = conditionForCode(Number(hourly.weather_code[index]));
      const fahrenheit = hourly.temperature_2m[index];
      const temperature = metric ? fahrenheitToCelsius(fahrenheit) : fahrenheit;

      const card = document.createElement("div");
      card.className = "forecast-card";
      const parts = [
        ["forecast-time", index === 0 ? "Now" : formatHour(time)],
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
  $("#updated").textContent = formatClock(lastFetchedAt);
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
  selectedLocation = location;
  if (updateSearchField) searchInput.value = location.name;
  loadWeather();
};

const useDefaultLocation = () => applyLocation(DEFAULT_LOCATION, false);

const resolveBrowserLocation = async ({ coords }) => {
  let name = "Your location";
  try {
    const data = await fetchJson(
      `/reverse-location?latitude=${coords.latitude}&longitude=${coords.longitude}`
    );
    name = data.name || name;
  } catch {
    // Weather still works when reverse geocoding is unavailable.
  }
  applyLocation({ latitude: coords.latitude, longitude: coords.longitude, name }, false);
};

const useMyLocation = () => {
  setBusy(true);
  setState("locating");

  if (!navigator.geolocation) {
    useDefaultLocation();
    return;
  }

  announce("Requesting your location…");

  // The browser's own timeout only starts after permission is granted, so an
  // unanswered prompt would wait forever. Fall back to New York instead.
  let settled = false;
  const settle = (handler) => (...args) => {
    if (settled) return;
    settled = true;
    clearTimeout(promptTimer);
    handler(...args);
  };
  const promptTimer = setTimeout(settle(useDefaultLocation), PERMISSION_WAIT_MS);

  navigator.geolocation.getCurrentPosition(
    settle(resolveBrowserLocation),
    settle(useDefaultLocation),
    { enableHighAccuracy: false, timeout: 10000, maximumAge: 300000 }
  );
};

/* ---------- Search ---------- */

const searchBox = createSearchBox({
  input: searchInput,
  popup: $("#search-popup"),
  message: $("#search-message"),
  list: $("#search-results"),
  announce,
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
  if (!busy) loadWeather();
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

useMyLocation();
