import { expect, test } from "@playwright/test";
import { mockApi } from "./helpers.mjs";

// Layout-space position (immune to the map's scroll animation) as a fraction
// of one map tile, plus the tile height. Only a viewport-dependent layout can
// make these change when the window is resized.
const markerFraction = (page) => page.evaluate(() => {
  const track = document.querySelector("#map-track");
  const marker = [...document.querySelectorAll("[data-map-marker]")].find((m) => !m.hidden);
  const tileHeight = track.offsetHeight;
  const tileWidth = (tileHeight * 360) / 142;
  return {
    x: (marker.offsetLeft % tileWidth) / tileWidth,
    y: marker.offsetTop / tileHeight,
    tileHeight,
    markerX: Number(track.style.getPropertyValue("--marker-x")),
    markerY: Number(track.style.getPropertyValue("--marker-y")),
  };
});

test("marker stays glued to the map while the window resizes", async ({ page }) => {
  await mockApi(page, { location: { latitude: 40.7128, longitude: -74.006, name: "New York" } });
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/");
  await expect(page.locator("#location-name")).toHaveText("New York");
  const before = await markerFraction(page);

  for (const size of [{ width: 640, height: 700 }, { width: 1920, height: 900 }, { width: 800, height: 500 }]) {
    await page.setViewportSize(size);
    await page.waitForTimeout(150);
    const now = await markerFraction(page);
    // Same spot on the map regardless of viewport; the tile itself keeps its size.
    expect(now.x).toBeCloseTo(before.x, 2);
    expect(now.y).toBeCloseTo(before.y, 2);
    expect(now.tileHeight).toBe(before.tileHeight);
  }
});

test("a visible marker exists on a wide screen", async ({ page }) => {
  await mockApi(page, { location: { latitude: -33.87, longitude: 151.21, name: "Sydney" } });
  await page.setViewportSize({ width: 2560, height: 1200 });
  await page.goto("/");
  await expect(page.locator("#location-name")).toHaveText("Sydney");
  await expect(page.locator("[data-map-marker]:not([hidden])").first()).toBeVisible();
});
