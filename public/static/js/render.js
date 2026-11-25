// Rendering: writes one /weather payload into the page. No state and no network;
// dashboard.js decides what to show and when.
const assetVersion = new URL(import.meta.url).searchParams.get("v") || "";
const {
  compassPoint,
  conditionForCode,
  daylightStatus,
  fahrenheitToCelsius,
  forecastStartIndex,
  formatClock,
  formatCoordinates,
  formatDuration,
  formatHour,
  formatWeekday,
  hpaToInHg,
  metresToDistance,
  mphToKmh,
  numberFormat,
  toneForFahrenheit,
  uvCategory,
} = await import(`./format.js?v=${encodeURIComponent(assetVersion)}`);

const $ = (selector) => document.querySelector(selector);
const FORECAST_HOURS = 12;
const WEEK_DAYS = 7;
// Conditions that get a precipitation chance beside their icon.
const WET_CONDITIONS = new Set(["rain", "snow", "storm"]);

// Optional values can be missing or null upstream; show "--" for just that one.
export const isNumber = (value) => typeof value === "number" && Number.isFinite(value);
const formatOr = (value, digits, suffix = "") =>
  isNumber(value) ? `${numberFormat(digits).format(value)}${suffix}` : "--";

const renderForecast = (data, metric) => {
  const forecast = $("#forecast");
  const hourly = data.hourly;
  if (!hourly || !Array.isArray(hourly.time) || !hourly.time.length) {
    const unavailable = document.createElement("p");
    unavailable.className = "forecast-condition";
    unavailable.textContent = "Hourly forecast unavailable.";
    forecast.replaceChildren(unavailable);
    return;
  }

  const currentIndex = forecastStartIndex(hourly.time, data.current.time);
  const times = hourly.time.slice(currentIndex + 1, currentIndex + FORECAST_HOURS);
  const temperatures = hourly.temperature_2m.slice(currentIndex + 1, currentIndex + FORECAST_HOURS);
  const weatherCodes = hourly.weather_code.slice(currentIndex + 1, currentIndex + FORECAST_HOURS);
  const forecastItems = [
    {
      time: "Now",
      temperature: data.current.temperature_2m,
      weatherCode: data.current.weather_code,
    },
    ...times.map((time, index) => ({
      time,
      temperature: temperatures[index],
      weatherCode: weatherCodes[index],
    })),
  ];
  forecast.replaceChildren(
    ...forecastItems.map(({ time, temperature: fahrenheit, weatherCode }, index) => {
      // Hourly values can be null (a gap in the model); Number(null) would read as "Clear".
      const condition = conditionForCode(isNumber(weatherCode) ? weatherCode : undefined);
      const temperature = metric ? fahrenheitToCelsius(fahrenheit) : fahrenheit;

      const card = document.createElement("div");
      card.className = "forecast-card";
      const parts = [
        ["forecast-time", index === 0 ? time : formatHour(time, data.timezone)],
        ["forecast-symbol", condition.icon],
        ["forecast-temperature", isNumber(fahrenheit) ? `${numberFormat(0).format(temperature)}°` : "--"],
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

const span = (className, ...children) => {
  const element = document.createElement("span");
  if (className) element.className = className;
  element.append(...children);
  return element;
};
const spoken = (text) => span("visually-hidden", text);
const shown = (text) => {
  const element = span("", text);
  element.setAttribute("aria-hidden", "true");
  return element;
};

// One row per day from today: icon (plus rain/snow chance), average, low-high, wind and UV.
const renderWeek = (data, metric) => {
  const week = $("#week");
  const { daily } = data;
  const times = daily && Array.isArray(daily.time) ? daily.time : [];
  const today = forecastStartIndex(times, data.current.time);
  const start = Math.max(0, today);
  const days = times.slice(start, start + WEEK_DAYS);
  if (!days.length) {
    const unavailable = document.createElement("li");
    unavailable.className = "week-unavailable";
    unavailable.textContent = "Weekly forecast unavailable.";
    week.replaceChildren(unavailable);
    return;
  }

  const degrees = (fahrenheit) =>
    formatOr(isNumber(fahrenheit) && metric ? fahrenheitToCelsius(fahrenheit) : fahrenheit, 0, "°");
  week.replaceChildren(
    ...days.map((time, offset) => {
      const index = start + offset;
      const value = (field) => (Array.isArray(daily[field]) ? daily[field][index] ?? null : null);
      const code = value("weather_code");
      const condition = conditionForCode(isNumber(code) ? code : undefined);
      const low = value("temperature_2m_min");
      const high = value("temperature_2m_max");
      // Open-Meteo's daily mean; the midpoint stands in if a model leaves it out.
      const mean = value("temperature_2m_mean")
        ?? (isNumber(low) && isNumber(high) ? (low + high) / 2 : null);
      const chance = value("precipitation_probability_max");
      const wind = value("wind_speed_10m_max");
      const uv = value("uv_index_max");

      const symbol = span("week-symbol", shown(condition.icon), spoken(condition.label));
      if (WET_CONDITIONS.has(condition.key) && isNumber(chance)) {
        symbol.append(" ", span("week-chance", `${numberFormat(0).format(Math.max(0, chance))}%`, spoken(" chance")));
      }
      const extras = [
        isNumber(wind) && `Wind ${formatOr(metric ? mphToKmh(wind) : wind, 0, metric ? " km/h" : " mph")}`,
        isNumber(uv) && `UV ${formatOr(Math.max(0, uv), 0)}`,
      ].filter(Boolean);

      const row = document.createElement("li");
      row.className = "week-day";
      // Spaces between the parts keep screen readers from running words together;
      // grid layout ignores them.
      const parts = [
        span("week-name", index === today ? "Today" : formatWeekday(time, data.timezone)),
        symbol,
        span("week-temperature", spoken("Average "), degrees(mean)),
        // One "--" when either end is missing, not a "--–--" run of dashes.
        isNumber(low) && isNumber(high)
          ? span("week-range", spoken("low "), degrees(low), shown("–"), spoken(", high "), degrees(high))
          : span("week-range", "--"),
        span("week-extra", extras.join(" · ")),
      ];
      row.append(...parts.flatMap((part, at) => (at ? [" ", part] : [part])));
      return row;
    })
  );
};

// The hero, details and forecast for one /weather payload (imperial units).
export const renderWeather = (data, placeName, metric) => {
  const { current } = data;
  const panel = $("#panel");
  const temperature = metric ? fahrenheitToCelsius(current.temperature_2m) : current.temperature_2m;
  const wind = metric ? mphToKmh(current.wind_speed_10m) : current.wind_speed_10m;
  const condition = conditionForCode(Number(current.weather_code));

  $("#location-name").textContent = placeName;
  $("#coordinates").textContent = formatCoordinates(data.latitude, data.longitude);
  $("#condition").textContent = `${condition.icon} ${condition.label}`;
  $("#temperature").textContent = numberFormat(0).format(temperature);
  $("#temperature-unit").textContent = metric ? "°C" : "°F";
  $("#wind").textContent = numberFormat(1).format(wind);
  $("#wind-unit").textContent = metric ? "km/h" : "mph";
  renderWindDirection(current.wind_direction_10m);
  renderDetails(data, metric);

  panel.dataset.tone = toneForFahrenheit(current.temperature_2m);
  panel.dataset.condition = condition.key;
  // Open-Meteo's is_day is 1 or 0; a missing value keeps the day look.
  panel.dataset.daylight = current.is_day === 0 ? "night" : "day";
  renderForecast(data, metric);
  renderWeek(data, metric);
};

const renderWindDirection = (degrees) => {
  const arrow = $("#wind-arrow");
  arrow.hidden = !isNumber(degrees);
  $("#wind-direction").textContent = isNumber(degrees) ? `from ${compassPoint(degrees)}` : "--";
  // The arrow points the way the wind blows, opposite to where it comes from.
  if (isNumber(degrees)) arrow.style.setProperty("--wind-rotate", `${degrees + 180}deg`);
};

const renderDetails = (data, metric) => {
  const { current, daily } = data;
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
  $("#sunrise").textContent = isNumber(sunrise) ? formatClock(sunrise, data.timezone) : "--";
  $("#sunset").textContent = isNumber(sunset) ? formatClock(sunset, data.timezone) : "--";
  $("#day-length").textContent = isNumber(sunrise) && isNumber(sunset) && sunset > sunrise
    ? `${formatDuration(sunset - sunrise)} of daylight`
    : "--";
};

// The Sunset tile's countdown and daylight bar. Runs with the clock, so it moves
// on while the page stays open.
export const renderDaylight = (data, now) => {
  const daily = data.daily;
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
