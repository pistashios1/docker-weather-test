// Pure helpers: unit conversion, number formatting and weather-code labels.
// The API returns imperial units (°F, mph); metric is converted in the browser.

const formatters = new Map();

export const numberFormat = (digits) => {
  if (!formatters.has(digits)) {
    formatters.set(
      digits,
      new Intl.NumberFormat(undefined, {
        minimumFractionDigits: digits,
        maximumFractionDigits: digits,
      })
    );
  }
  return formatters.get(digits);
};

export const fahrenheitToCelsius = (fahrenheit) => ((fahrenheit - 32) * 5) / 9;
export const mphToKmh = (mph) => mph * 1.609344;
export const hpaToInHg = (hpa) => hpa * 0.02953;

// Open-Meteo reports visibility in metres whatever units are requested.
export const metresToDistance = (metres, metric) =>
  metric ? metres / 1000 : metres / 1609.344;

const COMPASS = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE",
  "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];

// Wind direction is where the wind comes from, in degrees clockwise from north.
export const compassPoint = (degrees) =>
  COMPASS[Math.round((((degrees % 360) + 360) % 360) / 22.5) % 16];

export const toneForFahrenheit = (fahrenheit) => {
  if (fahrenheit <= 32) return "freezing";
  if (fahrenheit <= 55) return "cool";
  if (fahrenheit <= 75) return "mild";
  if (fahrenheit <= 90) return "warm";
  return "hot";
};

// WMO weather interpretation codes, as returned by Open-Meteo.
const CONDITIONS = [
  [(code) => code === 0, "Clear", "☀️", "clear"],
  [(code) => code === 1, "Mainly clear", "🌤️", "clear"],
  [(code) => code === 2, "Partly cloudy", "⛅", "cloudy"],
  [(code) => code === 3, "Overcast", "☁️", "cloudy"],
  [(code) => code === 45 || code === 48, "Foggy", "🌁", "fog"],
  [(code) => code >= 51 && code <= 57, "Drizzle", "🌦️", "rain"],
  [(code) => (code >= 61 && code <= 67) || (code >= 80 && code <= 82), "Rain", "🌧️", "rain"],
  [(code) => (code >= 71 && code <= 77) || (code >= 85 && code <= 86), "Snow", "🌨️", "snow"],
  [(code) => code >= 95 && code <= 99, "Thunderstorm", "⛈️", "storm"],
];

export const conditionForCode = (code) => {
  const match = CONDITIONS.find(([matches]) => matches(code));
  return match
    ? { label: match[1], icon: match[2], key: match[3] }
    : { label: "Weather", icon: "🌡️", key: "unknown" };
};

// The API sends Unix timestamps (seconds, UTC).
export const formatHour = (timestamp, timeZone) => {
  const date = new Date(typeof timestamp === "number" ? timestamp * 1000 : Number.NaN);
  return Number.isNaN(date.valueOf())
    ? "--"
    : date.toLocaleTimeString(undefined, { hour: "numeric", ...(timeZone ? { timeZone } : {}) });
};

// Index of the hour that contains `now`. Open-Meteo's current time moves in
// 15-minute steps (14:15), so this is the last hour at or before it.
// -1 when every hour is later than `now`.
export const forecastStartIndex = (times, now) => times.findLastIndex((time) => time <= now);

// "3 h 24 min", "45 min", "2 h"; anything under a minute reads "under a minute".
export const formatDuration = (seconds) => {
  const minutes = Math.floor(seconds / 60);
  if (minutes < 1) return "under a minute";
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (!hours) return `${rest} min`;
  return rest ? `${hours} h ${rest} min` : `${hours} h`;
};

// Where `now` sits in today's daylight (all Unix seconds). `progress` is the share
// of daylight gone (0..1) while the sun is up, otherwise null. Polar days and
// missing times give null text, so the page shows "--".
export const daylightStatus = ({ now, sunrise, sunset, nextSunrise }) => {
  const valid = (value) => typeof value === "number" && Number.isFinite(value);
  if (!valid(now) || !valid(sunrise) || !valid(sunset) || sunset <= sunrise) {
    return { text: null, progress: null };
  }
  if (now < sunrise) return { text: `Sunrise in ${formatDuration(sunrise - now)}`, progress: null };
  if (now < sunset) {
    return {
      text: `${formatDuration(sunset - now)} of daylight left`,
      progress: (now - sunrise) / (sunset - sunrise),
    };
  }
  return valid(nextSunrise) && nextSunrise > now
    ? { text: `Sunrise in ${formatDuration(nextSunrise - now)}`, progress: null }
    : { text: "The sun has set", progress: null };
};

export const formatClock = (value, timeZone) => {
  const date = value instanceof Date
    ? value
    : new Date(typeof value === "number" && value < 1e12 ? value * 1000 : value);
  return Number.isNaN(date.valueOf())
    ? "--"
    : date.toLocaleTimeString(undefined, {
        hour: "numeric",
        minute: "2-digit",
        ...(timeZone ? { timeZone } : {}),
      });
};

export const formatUtcOffset = (timeZone, value = new Date()) => {
  try {
    const timeZoneName = new Intl.DateTimeFormat("en-US", {
      timeZone,
      timeZoneName: "longOffset",
      hour: "numeric",
    })
      .formatToParts(value)
      .find((part) => part.type === "timeZoneName")?.value;
    if (!timeZoneName || timeZoneName === "GMT") return "UTC+0";
    return timeZoneName
      .replace("GMT", "UTC")
      .replace(/([+-])0(\d)/, "$1$2")
      .replace(":00", "");
  } catch {
    return "UTC";
  }
};

export const formatCoordinates = (latitude, longitude) => {
  const lat = `${numberFormat(2).format(Math.abs(latitude))}° ${latitude >= 0 ? "N" : "S"}`;
  const lon = `${numberFormat(2).format(Math.abs(longitude))}° ${longitude >= 0 ? "E" : "W"}`;
  return `${lat}, ${lon}`;
};

// WHO UV index categories. The WHO scale is whole numbers, so 2.6 counts as 3 (Moderate).
export const uvCategory = (index) => {
  index = Math.round(index);
  if (index < 3) return "Low";
  if (index < 6) return "Moderate";
  if (index < 8) return "High";
  if (index < 11) return "Very high";
  return "Extreme";
};
