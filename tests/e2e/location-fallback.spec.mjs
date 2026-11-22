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
