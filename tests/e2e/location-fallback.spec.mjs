import { expect, test } from "@playwright/test";
import { mockApi } from "./helpers.mjs";

const GEO = { latitude: 48.8566, longitude: 2.3522 };

test("IP lookup succeeds: shows that place without asking the browser", async ({ page }) => {
  await mockApi(page, { location: { latitude: 51.5, longitude: -0.12, name: "London, England" } });
  await page.goto("/");
  await expect(page.locator("#location-name")).toHaveText("London, England");
});

test.describe("IP lookup fails, geolocation granted", () => {
  test.use({ geolocation: GEO, permissions: ["geolocation"] });
  test("falls back to the browser's position", async ({ page }) => {
    await mockApi(page);
    await page.route("**/reverse-location?**", (route) =>
      route.fulfill({ contentType: "application/json", body: JSON.stringify({ name: "Paris, France" }) }));
    const weather = page.waitForRequest((r) => r.url().includes("/weather?") && r.url().includes("48.85"));
    await page.goto("/");
    await weather;
  });
});

test.describe("IP lookup fails, geolocation denied", () => {
  test.use({ permissions: [] });
  test("falls back to New York", async ({ page }) => {
    await mockApi(page);
    // Deny deterministically instead of relying on the headless prompt behaviour.
    await page.addInitScript(() => {
      navigator.geolocation.getCurrentPosition = (_ok, fail) => fail({ code: 1 });
    });
    await page.goto("/");
    await expect(page.locator("#location-name")).toHaveText("New York");
  });
});

test("no geolocation API at all: still falls back to New York", async ({ page }) => {
  await mockApi(page);
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "geolocation", { value: undefined, configurable: true });
  });
  await page.goto("/");
  await expect(page.locator("#location-name")).toHaveText("New York");
});

test("local time ticks in the browser without another weather request", async ({ page }) => {
  await mockApi(page, { location: { latitude: 51.5, longitude: -0.12, name: "London, England" } });
  let weatherRequests = 0;
  page.on("request", (request) => {
    if (request.url().includes("/weather?")) weatherRequests += 1;
  });

  await page.goto("/");
  await expect(page.locator("#local-time")).not.toHaveText("--");
  await page.waitForTimeout(2500);

  expect(weatherRequests).toBe(1);
  await expect(page.locator("#utc-offset")).not.toHaveText("UTC --");
});

const saveLastLocation = (page, savedAt) => page.addInitScript((time) => {
  localStorage.setItem("last-location", JSON.stringify({
    latitude: 35.68, longitude: 139.69, name: "Tokyo, Japan", savedAt: time,
  }));
}, savedAt);

test("a returning visitor sees their last place without an IP lookup", async ({ page }) => {
  await mockApi(page, { location: { latitude: 51.5, longitude: -0.12, name: "London, England" } });
  let ipLookups = 0;
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === "/location") ipLookups += 1;
  });
  await saveLastLocation(page, Date.now());
  await page.goto("/");
  await expect(page.locator("#location-name")).toHaveText("Tokyo, Japan");
  expect(ipLookups).toBe(0);
});

test("a last place older than 30 days is ignored", async ({ page }) => {
  await mockApi(page, { location: { latitude: 51.5, longitude: -0.12, name: "London, England" } });
  await saveLastLocation(page, Date.now() - 31 * 24 * 60 * 60 * 1000);
  await page.goto("/");
  await expect(page.locator("#location-name")).toHaveText("London, England");
});

test("picking a search result is remembered for the next visit", async ({ page }) => {
  await mockApi(page, { location: { latitude: 51.5, longitude: -0.12, name: "London, England" } });
  await page.route("**/search?**", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({ results: [
      { name: "Oslo", context: "Norway", latitude: 59.91, longitude: 10.75, population: 1 },
    ] }),
  }));
  await page.goto("/");
  await expect(page.locator("#location-name")).toHaveText("London, England");
  await page.locator("#location-search").fill("Oslo");
  await page.locator("#search-option-0").click();
  await expect(page.locator("#location-name")).toHaveText("Oslo");

  await page.reload();
  await expect(page.locator("#location-name")).toHaveText("Oslo");
});

test.describe("IP lookup succeeds, then Use my location is denied", () => {
  test.use({ permissions: [] });
  test("keeps the IP location instead of jumping to New York", async ({ page }) => {
    await mockApi(page, { location: { latitude: 51.5, longitude: -0.12, name: "London, England" } });
    await page.addInitScript(() => {
      navigator.geolocation.getCurrentPosition = (_ok, fail) => fail({ code: 1 });
    });
    await page.goto("/");
    await expect(page.locator("#location-name")).toHaveText("London, England");

    await page.locator("#location-button").click();

    await expect(page.locator("#toast-text")).toHaveText("Location permission was denied.");
    await expect(page.locator("#panel")).toHaveAttribute("data-state", "ready");
    await expect(page.locator("#location-name")).toHaveText("London, England");
  });
});

test.describe("a newer place failed to load, then Use my location is denied", () => {
  test.use({ permissions: [] });
  test("goes back to the place whose weather is actually on screen", async ({ page }) => {
    await mockApi(page, { location: { latitude: 51.5, longitude: -0.12, name: "London, England" } });
    await page.route("**/search?**", (route) => route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ results: [
        { name: "Tokyo", context: "Tokyo, Japan", latitude: 35.68, longitude: 139.69, population: 1 },
      ] }),
    }));
    await page.addInitScript(() => {
      navigator.geolocation.getCurrentPosition = (_ok, fail) => fail({ code: 1 });
    });
    await page.goto("/");
    await expect(page.locator("#location-name")).toHaveText("London, England");

    // Tokyo's weather fails to load (registered last, so it wins over mockApi's route).
    await page.route("**/weather?latitude=35.68**", (route) => route.fulfill({
      status: 502, contentType: "application/json", body: JSON.stringify({ error: "weather service unavailable" }),
    }));
    await page.locator("#location-search").fill("Tokyo");
    await page.locator("#search-option-0").click();
    await expect(page.locator("#panel")).toHaveAttribute("data-state", "error");

    await page.locator("#location-button").click();

    await expect(page.locator("#panel")).toHaveAttribute("data-state", "ready");
    await expect(page.locator("#location-name")).toHaveText("London, England");
    await expect(page.locator("#status")).toHaveText("Showing weather for London, England.");
  });
});
