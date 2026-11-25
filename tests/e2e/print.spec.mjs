import { expect, test } from "@playwright/test";
import { mockApi } from "./helpers.mjs";

const LONDON = { latitude: 51.5, longitude: -0.12, name: "London, England" };

test("printing shows the result card as on screen, without the map, title or controls", async ({ page }) => {
  await mockApi(page, { location: LONDON });
  await page.goto("/");
  await expect(page.locator("#location-name")).toHaveText("London, England");

  await page.emulateMedia({ media: "print" });

  await expect(page.locator("#map-bg")).toBeHidden();
  for (const marker of await page.locator(".map-marker").all()) await expect(marker).toBeHidden();
  await expect(page.locator(".search-card")).toBeHidden();
  await expect(page.locator(".page-header")).toBeHidden();
  await expect(page.locator("#map-toggle")).toBeHidden();
  await expect(page.locator("#location-name")).toBeVisible();
  await expect(page.locator("#temperature")).toBeVisible();
  await expect(page.locator("#week .week-day")).toHaveCount(7);

  // The hero keeps its colours, and the page asks the browser to print them.
  const hero = await page.locator(".hero").evaluate((element) => ({
    image: getComputedStyle(element).backgroundImage,
    adjust: getComputedStyle(document.documentElement).printColorAdjust,
  }));
  expect(hero.image).not.toBe("none");
  expect(hero.adjust).toBe("exact");
  expect(await page.locator("#panel").evaluate((element) => getComputedStyle(element).backdropFilter)).toBe("none");

  // Every forecast hour fits on the page instead of scrolling off the edge.
  const forecast = await page.locator("#forecast").evaluate(
    (element) => element.scrollWidth <= element.clientWidth,
  );
  expect(forecast).toBe(true);
});

// Print always uses the light palette, so a dark-mode visitor gets the same sheet.
for (const colorScheme of ["light", "dark"]) {
  test(`printing from ${colorScheme} mode gives one light page, even at night with every optional row shown`, async ({ page }) => {
    await page.emulateMedia({ colorScheme });
    await mockApi(page, {
      location: LONDON,
      weather: { current: { is_day: 0, rain: 0.4, snowfall: 0.3 }, daily: { snowfall_sum: [2.1, 0] } },
    });
    await page.goto("/");
    await expect(page.locator("#snow-row")).toBeVisible();

    await page.emulateMedia({ media: "print", colorScheme });
    const colours = await page.locator("#panel").evaluate((element) => ({
      text: getComputedStyle(element).color,
      background: getComputedStyle(element).backgroundColor,
    }));
    expect(colours).toEqual({ text: "rgb(23, 33, 43)", background: "rgb(255, 255, 255)" });
    // Nine tiles in two rows of five.
    const columns = await page.locator(".details").evaluate(
      (element) => getComputedStyle(element).gridTemplateColumns.split(" ").length,
    );
    expect(columns).toBe(5);

    for (const format of ["A4", "Letter"]) {
      const pdf = (await page.pdf({ format, preferCSSPageSize: true })).toString("latin1");
      expect(pdf.match(/\/Type\s*\/Page[^s]/g), `${format} pages`).toHaveLength(1);
    }
  });
}
