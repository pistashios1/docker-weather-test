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
export const forecastStartIndex = (times, now) =>
  Math.max(0, times.findLastIndex((time) => time <= now));

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
