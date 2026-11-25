// Shared fixtures: every provider call is mocked, so the suite runs offline.
const HOURS = Array.from({ length: 48 });
const NOW = 1794625200; // 03:00 UTC
const MIDNIGHT = NOW - 3 * 3600; // a Saturday
const DAYS = Array.from({ length: 7 }, (_, index) => MIDNIGHT + index * 86400);

// `current` and `daily` overrides are merged in, so a test can set one value.
export const weatherPayload = (latitude, longitude, { current = {}, daily = {} } = {}) => ({
  latitude, longitude, timezone: "UTC", source: "Open-Meteo",
  current: {
    time: NOW,
    temperature_2m: 61, apparent_temperature: 58, wind_speed_10m: 7, wind_direction_10m: 225,
    weather_code: 2, precipitation: 0, rain: 0, snowfall: 0, relative_humidity_2m: 55,
    dew_point_2m: 45, pressure_msl: 1013.25, visibility: 24000, is_day: 1, uv_index: 3.1,
    ...current,
  },
  hourly: {
    time: HOURS.map((_, index) => NOW + index * 3600),
    temperature_2m: HOURS.map(() => 60),
    weather_code: HOURS.map(() => 2),
  },
  daily: {
    time: DAYS,
    // Today, then a rainy, a wet, a clear, a snowy, a stormy and a cloudy day.
    weather_code: [2, 61, 63, 0, 71, 95, 3],
    temperature_2m_mean: [56, 60, 62, 55, 36, 49, 53],
    temperature_2m_max: [66, 70, 72, 64, 40, 58, 61],
    temperature_2m_min: [48, 50, 52, 47, 31, 41, 45],
    sunrise: DAYS.map((day) => day + 7 * 3600),
    sunset: DAYS.map((day) => day + 16.5 * 3600),
    uv_index_max: [4.2, 5, 3, 6, 2, 1, 4], precipitation_sum: [1.2, 0, 8, 0, 0, 12, 0],
    precipitation_probability_max: [40, 10, 80, 0, 60, 90, 5],
    snowfall_sum: [0, 0, 0, 0, 3.5, 0, 0],
    wind_speed_10m_max: [12, 15, 20, 8, 10, 25, 9],
    ...daily,
  },
});
export const json = (route, body, status = 200) =>
  route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

export async function mockApi(page, { location, weather = {} } = {}) {
  await page.route("**/weather?**", (route) => {
    const url = new URL(route.request().url());
    json(route, weatherPayload(
      Number(url.searchParams.get("latitude")),
      Number(url.searchParams.get("longitude")),
      weather,
    ));
  });
  await page.route("**/search?**", (route) => json(route, { results: [] }));
  await page.route("**/location", (route) =>
    location ? json(route, location) : json(route, { error: "unavailable" }, 502));
}
