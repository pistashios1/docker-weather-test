import { expect, test } from "@playwright/test";
import { mockApi } from "./helpers.mjs";

const LONDON = { latitude: 51.5, longitude: -0.12, name: "London, England" };
const text = (page, id) => page.locator(`#${id}`);

test("shows feels-like, high/low, wind direction and every detail in °F", async ({ page }) => {
  await mockApi(page, { location: LONDON });
  await page.goto("/");
  await expect(text(page, "location-name")).toHaveText("London, England");

  await expect(text(page, "feels-like")).toHaveText("58°");
  await expect(text(page, "temp-high")).toHaveText("66°");
  await expect(text(page, "temp-low")).toHaveText("48°");
  await expect(text(page, "wind-direction")).toHaveText("from SW");
  await expect(text(page, "precip-chance")).toHaveText("40% chance");
  await expect(text(page, "precip-total")).toHaveText("1.2 mm today");
  await expect(text(page, "humidity")).toHaveText("55%");
  await expect(text(page, "dew-point")).toHaveText("45°");
  await expect(text(page, "pressure")).toHaveText("29.92 inHg");
  await expect(text(page, "visibility")).toHaveText("15 mi");
  await expect(text(page, "uv-index")).toHaveText(/^3\.1 \/ 4\.2/);
  await expect(text(page, "uv-level")).toHaveText("Now / today's max · Moderate");
  await expect(text(page, "sunrise")).toContainText("Sunrise 7:00");
  await expect(text(page, "sunset")).toContainText("Sunset 4:30");

  // Not raining or snowing: those rows stay hidden.
  await expect(text(page, "rain-now")).toBeHidden();
  await expect(text(page, "snow-row")).toBeHidden();
  await expect(page.locator("#panel")).toHaveAttribute("data-daylight", "day");
});

test("metric converts temperature, pressure and visibility", async ({ page }) => {
  await mockApi(page, { location: LONDON });
  await page.goto("/");
  await expect(text(page, "location-name")).toHaveText("London, England");
  await page.locator('input[name="units"][value="metric"]').check();

  await expect(text(page, "feels-like")).toHaveText("14°");
  await expect(text(page, "dew-point")).toHaveText("7°");
  await expect(text(page, "pressure")).toHaveText("1,013 hPa");
  await expect(text(page, "visibility")).toHaveText("24 km");
});

test("rain now, snowfall and the night hero appear only when they apply", async ({ page }) => {
  await mockApi(page, {
    location: LONDON,
    weather: { current: { rain: 0.4, snowfall: 0.3, is_day: 0 }, daily: { snowfall_sum: [2.1, 0] } },
  });
  await page.goto("/");
  await expect(text(page, "location-name")).toHaveText("London, England");

  await expect(text(page, "rain-now")).toHaveText("Raining now: 0.4 mm");
  await expect(text(page, "snow-row")).toBeVisible();
  await expect(text(page, "snowfall")).toHaveText("2.1 cm today");
  await expect(page.locator("#panel")).toHaveAttribute("data-daylight", "night");
});

test("missing optional values show -- instead of failing", async ({ page }) => {
  await mockApi(page, {
    location: LONDON,
    weather: { current: { visibility: null, apparent_temperature: null, wind_direction_10m: null, uv_index: null } },
  });
  await page.goto("/");
  await expect(text(page, "location-name")).toHaveText("London, England");

  await expect(text(page, "visibility")).toHaveText("--");
  await expect(text(page, "feels-like")).toHaveText("--");
  await expect(text(page, "wind-direction")).toHaveText("--");
  await expect(text(page, "wind-arrow")).toBeHidden();
  await expect(text(page, "uv-index")).toHaveText(/^-- \/ 4\.2/);
  await expect(text(page, "uv-level")).toHaveText("Now / today's max");
  await expect(text(page, "temperature")).toHaveText("61");
});
