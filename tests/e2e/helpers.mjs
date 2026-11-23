// Shared fixtures: every provider call is mocked, so the suite runs offline.
const HOURS = Array.from({ length: 48 });

export const weatherPayload = (latitude, longitude) => ({
  latitude, longitude, timezone: "UTC", source: "Open-Meteo",
  current: {
    time: 1794625200,
    temperature_2m: 61, wind_speed_10m: 7, weather_code: 2,
    rain: 0, relative_humidity_2m: 55, uv_index: 3,
  },
  hourly: {
    time: HOURS.map((_, index) => 1794625200 + index * 3600),
    temperature_2m: HOURS.map(() => 60),
    weather_code: HOURS.map(() => 2),
  },
});

export const json = (route, body, status = 200) =>
  route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

export async function mockApi(page, { location } = {}) {
  await page.route("**/weather?**", (route) => {
    const url = new URL(route.request().url());
    json(route, weatherPayload(
      Number(url.searchParams.get("latitude")),
      Number(url.searchParams.get("longitude")),
    ));
  });
  await page.route("**/search?**", (route) => json(route, { results: [] }));
  await page.route("**/location", (route) =>
    location ? json(route, location) : json(route, { error: "unavailable" }, 502));
}
