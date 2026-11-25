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
  await expect(text(page, "sunrise")).toHaveText(/^7:00\sAM$/);
  await expect(text(page, "day-length")).toHaveText("9 h 30 min of daylight");
  await expect(text(page, "sunset")).toHaveText(/^4:30\sPM$/);

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

// The fixture day: midnight UTC, sunrise 07:00, sunset 16:30 (see helpers.mjs).
const FIXTURE_MIDNIGHT = (1794625200 - 3 * 3600) * 1000;
const at = (hours) => new Date(FIXTURE_MIDNIGHT + hours * 3600 * 1000);

test("the high and low sit in the hero's top-right corner as H: and L:", async ({ page }) => {
  await mockApi(page, { location: LONDON });
  await page.goto("/");
  await expect(text(page, "location-name")).toHaveText("London, England");

  // "High" / "Low" are screen-reader-only words between the visible "H:" and the value.
  await expect(page.locator(".hero-range")).toHaveText(/H:\s*High\s*66°,\s*L:\s*Low\s*48°/);
  const hero = await page.locator(".hero").boundingBox();
  const range = await page.locator(".hero-range").boundingBox();
  expect(range.y - hero.y).toBeLessThan(hero.height / 3); // top
  expect(range.x + range.width).toBeGreaterThan(hero.x + hero.width * 0.75); // right
});

test("the sunset tile counts down the daylight and fills its bar", async ({ page }) => {
  await page.clock.setFixedTime(at(12));
  await mockApi(page, { location: LONDON });
  await page.goto("/");
  await expect(text(page, "location-name")).toHaveText("London, England");

  await expect(text(page, "daylight-left")).toHaveText("4 h 30 min of daylight left");
  await expect(text(page, "daylight-track")).toBeVisible();
  const fill = await text(page, "daylight-fill").evaluate(
    (element) => Number(element.style.getPropertyValue("--daylight")),
  );
  expect(fill).toBeCloseTo(5 / 9.5, 2);
});

test("the daylight countdown keeps ticking while the page stays open", async ({ page }) => {
  await page.clock.install({ time: at(12).getTime() - 30_000 }); // 4 h 30 min 30 s left
  await mockApi(page, { location: LONDON });
  await page.goto("/");
  await expect(text(page, "daylight-left")).toHaveText("4 h 30 min of daylight left");

  await page.clock.runFor(60_000);
  await expect(text(page, "daylight-left")).toHaveText("4 h 29 min of daylight left");
});

test("before sunrise the sunset tile counts down to sunrise and hides the bar", async ({ page }) => {
  await page.clock.setFixedTime(at(5));
  await mockApi(page, { location: LONDON });
  await page.goto("/");
  await expect(text(page, "location-name")).toHaveText("London, England");

  await expect(text(page, "daylight-left")).toHaveText("Sunrise in 2 h");
  await expect(text(page, "daylight-track")).toBeHidden();
});

test("after sunset it counts down to tomorrow's sunrise", async ({ page }) => {
  await page.clock.setFixedTime(at(20));
  await mockApi(page, { location: LONDON });
  await page.goto("/");
  await expect(text(page, "location-name")).toHaveText("London, England");

  await expect(text(page, "daylight-left")).toHaveText("Sunrise in 11 h");
});

// Stale-weather refresh: a controlled clock, a /weather request counter, and a
// switch for document.visibilityState (headless tabs are always "visible").
const watchRefresh = async (page) => {
  await page.addInitScript(() => {
    window.__tabHidden = false;
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => (window.__tabHidden ? "hidden" : "visible"),
    });
  });
  await page.clock.install({ time: at(12) });
  await mockApi(page, { location: LONDON });
  const requests = { weather: 0 };
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === "/weather") requests.weather += 1;
  });
  await page.goto("/");
  await expect(text(page, "location-name")).toHaveText("London, England");
  return requests;
};
// A refresh sets the loading state synchronously, so reading it straight after is exact.
const panelState = (page) => page.evaluate(() => document.getElementById("panel").dataset.state);
const setTabHidden = (page, hidden) =>
  page.evaluate((value) => {
    window.__tabHidden = value;
    document.dispatchEvent(new Event("visibilitychange"));
    return document.getElementById("panel").dataset.state;
  }, hidden);

test("returning to the tab reloads the weather once it is over 10 minutes old", async ({ page }) => {
  const requests = await watchRefresh(page);

  await setTabHidden(page, true);
  await page.clock.runFor(5 * 60_000);
  expect(await setTabHidden(page, false)).toBe("ready"); // 5 min: still fresh

  await setTabHidden(page, true);
  await page.clock.runFor(11 * 60_000); // the timer skips a hidden tab
  expect(requests.weather).toBe(1);
  expect(await setTabHidden(page, false)).toBe("loading");
  await expect.poll(() => requests.weather).toBe(2);
  await expect(page.locator("#panel")).toHaveAttribute("data-state", "ready");
});

test("a tab that stays on screen reloads the weather every 10 minutes", async ({ page }) => {
  const requests = await watchRefresh(page);

  await page.clock.runFor(9 * 60_000);
  expect(await panelState(page)).toBe("ready");
  await page.clock.runFor(2 * 60_000);
  await expect.poll(() => requests.weather).toBe(2);
});

test("offline, the refresh waits for the connection instead of showing an error", async ({ page, context }) => {
  const requests = await watchRefresh(page);

  await context.setOffline(true);
  await page.clock.runFor(11 * 60_000);
  expect(await panelState(page)).toBe("ready"); // old weather stays, no error

  await context.setOffline(false); // fires "online"
  await expect.poll(() => requests.weather).toBe(2);
  await expect(page.locator("#panel")).toHaveAttribute("data-state", "ready");
});

test("the weekly forecast lists seven days with average, low-high, wind and UV", async ({ page }) => {
  await mockApi(page, { location: LONDON });
  await page.goto("/");
  const days = page.locator("#week .week-day");
  await expect(days).toHaveCount(7);

  await expect(days.locator(".week-name")).toHaveText(["Today", "Sun", "Mon", "Tue", "Wed", "Thu", "Fri"]);
  await expect(days.nth(0)).toHaveText(
    "Today ⛅Partly cloudy Average 56° low 48°–, high 66° Wind 12 mph · UV 4",
  );
  // A chance only on rain, snow and storm days, never on a clear or cloudy one.
  await expect(days.locator(".week-chance")).toHaveText(["10% chance", "80% chance", "60% chance", "90% chance"]);
  await expect(days.nth(3).locator(".week-chance")).toHaveCount(0);

  await page.locator('input[name="units"][value="metric"]').check();
  await expect(days.nth(0).locator(".week-temperature")).toHaveText("Average 13°");
  await expect(days.nth(0).locator(".week-range")).toHaveText("low 9°–, high 19°");
  await expect(days.nth(0).locator(".week-extra")).toHaveText("Wind 19 km/h · UV 4");
});

test("the weekly forecast falls back to the low-high midpoint and to -- for gaps", async ({ page }) => {
  await mockApi(page, {
    location: LONDON,
    weather: { daily: { temperature_2m_mean: [], wind_speed_10m_max: [null], uv_index_max: [] } },
  });
  await page.goto("/");
  const today = page.locator("#week .week-day").first();
  await expect(today.locator(".week-temperature")).toHaveText("Average 57°");
  await expect(today.locator(".week-extra")).toHaveText("");
  await expect(page.locator("#week .week-day").nth(1).locator(".week-temperature")).toHaveText("Average 60°");
});

test("without daily data the weekly forecast says it is unavailable", async ({ page }) => {
  await mockApi(page, { location: LONDON, weather: { daily: { time: [] } } });
  await page.goto("/");
  await expect(page.locator("#week")).toHaveText("Weekly forecast unavailable.");
  await expect(text(page, "temp-high")).toHaveText("--");
});
