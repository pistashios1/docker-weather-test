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

const parseApiLocalTime = (isoTime) => {
  const match = typeof isoTime === "string"
    ? isoTime.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/)
    : null;
  if (!match) return null;
  return new Date(Date.UTC(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
    Number(match[4]),
    Number(match[5])
  ));
};

const formatApiTime = (isoTime, options) => {
  const localTime = parseApiLocalTime(isoTime);
  if (localTime) return localTime.toLocaleTimeString(undefined, { ...options, timeZone: "UTC" });
  const date = new Date(isoTime);
  return Number.isNaN(date.valueOf())
    ? "--"
    : date.toLocaleTimeString(undefined, options);
};

// Open-Meteo timestamps are local to the requested location and have no offset.
export const formatHour = (isoTime) => formatApiTime(isoTime, { hour: "numeric" });

export const formatClock = (value) => {
  if (typeof value === "string") {
    return formatApiTime(value, { hour: "numeric", minute: "2-digit" });
  }
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.valueOf())
    ? "--"
    : date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
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
