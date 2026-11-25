import { expect, test } from "@playwright/test";
import { json, mockApi, weatherPayload } from "./helpers.mjs";

const LONDON = { latitude: 51.5, longitude: -0.12, name: "London, England" };
const OSLO = { name: "Oslo", context: "Oslo, Norway", latitude: 59.91, longitude: 10.75, population: 1, country_code: "NO" };

// London loads from the IP lookup; Oslo's weather request fails.
const setup = async (page, startsAt = "London, England") => {
  await mockApi(page, { location: LONDON });
  await page.route("**/search?**", (route) => json(route, { results: [OSLO] }));
  await page.route("**/weather?latitude=59.91**", (route) => json(route, { error: "weather service unavailable" }, 502));
  await page.goto("/");
  await expect(page.locator("#location-name")).toHaveText(startsAt);
};

const searchOsloAndFail = async (page) => {
  await page.locator("#location-search").fill("oslo");
  await page.locator("#location-search").press("Enter");
  await expect(page.locator("#error-message")).toBeVisible();
};

test("Try again retries the place that failed, not the saved location", async ({ page }) => {
  // A "Use my location" result from a few minutes ago.
  await page.addInitScript(() => localStorage.setItem("user-location",
    JSON.stringify({ latitude: 48.85, longitude: 2.35, name: "Paris, France", savedAt: Date.now() })));
  await setup(page, "Paris, France"); // a recent "Use my location" wins at start-up
  await searchOsloAndFail(page);

  const retry = page.waitForRequest((request) => request.url().includes("/weather?"));
  await page.locator("#retry-button").click();

  expect((await retry).url()).toContain("latitude=59.91");
});

test("after a failed load the hero keeps the name of the place on screen", async ({ page }) => {
  await page.addInitScript(() => {
    navigator.geolocation.getCurrentPosition = (_ok, fail) => fail({ code: 1 });
  });
  await setup(page);
  await searchOsloAndFail(page);
  await page.locator('input[name="units"][value="metric"]').check({ force: true });

  await page.locator("#location-button").click(); // denied: shows London again

  await expect(page.locator("#location-name")).toHaveText("London, England");
});

test("an hour with no data shows -- instead of failing the forecast", async ({ page }) => {
  await mockApi(page, { location: LONDON });
  await page.route("**/weather?**", (route) => {
    const payload = weatherPayload(LONDON.latitude, LONDON.longitude);
    payload.hourly.temperature_2m[1] = null;
    payload.hourly.weather_code[1] = null;
    json(route, payload);
  });
  await page.goto("/");

  const nextHour = page.locator(".forecast-card").nth(1);
  await expect(nextHour.locator(".forecast-temperature")).toHaveText("--");
  await expect(nextHour.locator(".forecast-condition")).not.toHaveText("Clear");
});
