import { expect, test } from "@playwright/test";
import { json, mockApi } from "./helpers.mjs";

const LONDON = { latitude: 51.5, longitude: -0.12, name: "London, England" };
const PLACES = [
  { name: "Oslo", context: "Oslo, Norway", latitude: 59.91, longitude: 10.75, population: 1, country_code: "NO", distance_km: 1153 },
  { name: "Osaka", context: "Osaka, Japan", latitude: 34.69, longitude: 135.5, population: 1, country_code: "JP", distance_km: 9500 },
];

const setup = async (page) => {
  await mockApi(page, { location: LONDON });
  await page.route("**/search?**", (route) => json(route, { results: PLACES }));
  await page.goto("/");
  await expect(page.locator("#location-name")).toHaveText("London, England");
};

test("results show the matched text and the distance", async ({ page }) => {
  await setup(page);
  await page.locator("#location-search").fill("os");

  const first = page.locator("#search-option-0");
  await expect(first.locator("mark")).toHaveText("Os");
  await expect(first).toContainText("Oslo, Norway");
  await expect(first).toContainText("716 mi"); // 1,153 km in °F · mph mode
});

test("pressing outside the list closes it without picking anything", async ({ page }) => {
  await setup(page);
  await page.locator("#location-search").fill("os");
  await expect(page.locator("#search-option-0")).toBeVisible();

  await page.locator("h1").click();

  await expect(page.locator("#search-popup")).toBeHidden();
  await expect(page.locator("#location-name")).toHaveText("London, England");
});

test("Enter picks the best match even before the results have appeared", async ({ page }) => {
  await setup(page);
  await page.locator("#location-search").fill("oslo");
  await page.locator("#location-search").press("Enter");

  await expect(page.locator("#location-name")).toHaveText("Oslo");
  await expect(page.locator("#location-search")).toHaveValue("");
});

test("the field can be edited normally: clicking does not select or wipe the text", async ({ page }) => {
  await setup(page);
  const field = page.locator("#location-search");
  await field.fill("Osl");
  await field.click();
  await field.press("End");
  await field.type("o");

  await expect(field).toHaveValue("Oslo");
});

test("recent places appear when the empty field is focused", async ({ page }) => {
  await setup(page);
  await page.locator("#location-search").fill("os");
  await page.locator("#search-option-0").click();
  await expect(page.locator("#location-name")).toHaveText("Oslo");

  await page.locator("#location-search").click();

  await expect(page.locator("#search-message")).toHaveText("Recent places");
  await expect(page.locator("#search-option-0")).toContainText("Oslo");
});

test.describe("on a phone", () => {
  test.use({ viewport: { width: 390, height: 760 }, hasTouch: true, isMobile: true });

  test("tapping outside closes the list without picking; tapping a result picks it", async ({ page }) => {
    await setup(page);
    await page.locator("#location-search").tap();
    await page.locator("#location-search").fill("os");
    await expect(page.locator("#search-option-1")).toBeVisible();

    await page.locator("h1").tap();
    await expect(page.locator("#search-popup")).toBeHidden();
    await expect(page.locator("#location-name")).toHaveText("London, England");

    await page.locator("#location-search").tap();
    await page.locator("#location-search").fill("osa");
    await page.locator("#search-option-1").tap();
    await expect(page.locator("#location-name")).toHaveText("Osaka");
    await expect(page.locator("#location-search")).not.toBeFocused(); // keyboard closes
  });
});

test("after a pick, Arrow Down in the empty field does not reopen the old results", async ({ page }) => {
  await setup(page);
  const field = page.locator("#location-search");
  await field.fill("os");
  await page.locator("#search-option-0").click();
  await expect(page.locator("#location-name")).toHaveText("Oslo");

  await page.locator("#search-popup").evaluate((popup) => { popup.hidden = true; });
  await field.press("ArrowDown");

  await expect(page.locator("#search-popup")).toBeHidden();
});

test("clicking Search picks the highlighted option, not the first one", async ({ page }) => {
  await setup(page);
  const field = page.locator("#location-search");
  await field.fill("os");
  await expect(page.locator("#search-option-1")).toBeVisible();
  await field.press("ArrowDown");
  await field.press("ArrowDown");

  await page.locator("#search-button").click();

  await expect(page.locator("#location-name")).toHaveText("Osaka");
});

test("tabbing from the field to the Search button still closes the list", async ({ page }) => {
  await setup(page);
  const field = page.locator("#location-search");
  await field.fill("os");
  await expect(page.locator("#search-option-0")).toBeVisible();

  await field.press("Tab");

  await expect(page.locator("#search-popup")).toBeHidden();
});
