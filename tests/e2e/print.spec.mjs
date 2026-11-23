import { expect, test } from "@playwright/test";
import { mockApi } from "./helpers.mjs";

test("printing shows the weather without the map, marker, glass or controls", async ({ page }) => {
  await mockApi(page, { location: { latitude: 51.5, longitude: -0.12, name: "London, England" } });
  await page.goto("/");
  await expect(page.locator("#location-name")).toHaveText("London, England");

  await page.emulateMedia({ media: "print" });

  await expect(page.locator("#map-bg")).toBeHidden();
  for (const marker of await page.locator(".map-marker").all()) await expect(marker).toBeHidden();
  await expect(page.locator(".search-card")).toBeHidden();
  await expect(page.locator("#map-toggle")).toBeHidden();
  await expect(page.locator("#location-name")).toBeVisible();
  await expect(page.locator("#temperature")).toBeVisible();

  const panel = await page.locator("#panel").evaluate((element) => {
    const style = getComputedStyle(element);
    return { blur: style.backdropFilter, background: style.backgroundColor };
  });
  expect(panel.blur).toBe("none");
  expect(panel.background).toBe("rgb(255, 255, 255)");

  // Every forecast hour fits on the page instead of scrolling off the edge.
  const forecast = await page.locator("#forecast").evaluate(
    (element) => element.scrollWidth <= element.clientWidth,
  );
  expect(forecast).toBe(true);
});
