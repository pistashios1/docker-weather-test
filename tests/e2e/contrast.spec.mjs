// Contrast probe: slides the background map under the page and measures the
// worst text and control-border contrast against what is really behind them.
// Slow (several minutes), so it only runs on request:
//   CONTRAST=1 npx playwright test contrast      (PowerShell: $env:CONTRAST = "1")
// Re-run it after changing --color-glass, --glass-blur, --marker-opacity,
// --color-map-line or --color-border-strong.
import { expect, test } from "@playwright/test";
import { mockApi } from "./helpers.mjs";

const TEXT = [".page-header h1", ".subtitle", "footer p", ".location-name", ".location-meta",
  ".details dt", ".details dd", ".forecast-heading", ".forecast-time", ".forecast-temperature",
  ".forecast-condition", ".week-name", ".week-temperature", ".week-range", ".week-extra", ".week-chance"];
// Controls drawn straight on the map or on glass; the switch is measured switched off,
// where its track has only the border to show its edge.
const BORDERS = [".segmented", ".switch", ".switch .track"];
const LATITUDES = [70, 55, 40, 25, 10, -10, -30];
const POSITIONS = 30;
const FADE = 40; // px of edge fade on the hourly strip; text under it is not measured
// The map is a band across the middle of the (tall) viewport, so it is also moved
// onto the header and the footer, where text and controls sit straight on it.
const BANDS = { middle: null, header: ".page-header", footer: "footer" };

test.skip(!process.env.CONTRAST, "set CONTRAST=1 to run the contrast probe");

for (const scheme of ["light", "dark"]) for (const [band, over] of Object.entries(BANDS)) {
  test(`text and control borders keep their contrast over the map (${scheme}, ${band})`, async ({ page }) => {
    test.setTimeout(600_000);
    await page.emulateMedia({ colorScheme: scheme });
    await page.setViewportSize({ width: 1100, height: 2300 });
    const worst = {};
    for (const latitude of LATITUDES) {
      await page.unrouteAll();
      await mockApi(page, { location: { latitude, longitude: 10, name: "Probe" },
        weather: { current: { rain: 0.4, snowfall: 0.3 }, daily: { snowfall_sum: [2.1, 0] } } });
      await page.goto("/");
      await page.locator("#week .week-day").first().waitFor();
      // The setting persists across reloads, so only switch it off once.
      const toggle = page.locator("#map-toggle");
      if (await toggle.getAttribute("aria-checked") === "true") await toggle.click();
      // Let the track's colour fade finish, or its old fill is measured.
      await page.evaluate(() => Promise.all(document.getAnimations().filter((a) => a instanceof CSSTransition).map((a) => a.finished)));
      const tile = await page.evaluate((over) => {
        const track = document.getElementById("map-track");
        track.style.animation = "none";
        if (over) {
          const r = document.querySelector(over).getBoundingClientRect();
          track.style.top = `${r.top + r.height / 2}px`;
        }
        return parseFloat(getComputedStyle(track).getPropertyValue("--tile-width")) || track.getBoundingClientRect().width / 8;
      }, over);
      for (let step = 0; step < POSITIONS; step++) {
        await page.evaluate((x) => { document.getElementById("map-track").style.transform = `translateX(${x}px)`; }, -tile * step / POSITIONS);
        const withText = (await page.screenshot()).toString("base64");
        // Glyphs made transparent (their halo stays), so what is behind them can be read.
        await page.evaluate((sels) => sels.forEach((s) => document.querySelectorAll(s).forEach((e) => e.style.setProperty("color", "transparent"))), TEXT);
        const noText = (await page.screenshot()).toString("base64");
        await page.evaluate((sels) => sels.forEach((s) => document.querySelectorAll(s).forEach((e) => e.style.removeProperty("color"))), TEXT);
        const result = await page.evaluate(async ({ withText, noText, text, borders, fade }) => {
          const load = async (b64) => {
            const img = new Image();
            img.src = "data:image/png;base64," + b64;
            await img.decode();
            const canvas = document.createElement("canvas");
            canvas.width = img.width; canvas.height = img.height;
            const ctx = canvas.getContext("2d");
            ctx.drawImage(img, 0, 0);
            return ctx;
          };
          const [full, bare] = [await load(withText), await load(noText)];
          const lin = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
          const lum = (r, g, b) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
          const lumOf = (css) => lum(...css.match(/\d+(\.\d+)?/g).map(Number));
          const ratio = (a, b) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
          const minOver = (ctx, x, y, w, h, l) => {
            const data = ctx.getImageData(Math.round(x), Math.round(y), Math.max(1, Math.round(w)), Math.max(1, Math.round(h))).data;
            let min = 99;
            for (let i = 0; i < data.length; i += 4) min = Math.min(min, ratio(l, lum(data[i], data[i + 1], data[i + 2])));
            return min;
          };
          // Only the pixels a glyph covers: where the two shots differ. Colour emoji
          // ignore `color`, so they drop out on their own.
          const minUnderGlyphs = (x, y, w, h, l) => {
            const box = [Math.round(x), Math.round(y), Math.max(1, Math.round(w)), Math.max(1, Math.round(h))];
            const a = full.getImageData(...box).data, b = bare.getImageData(...box).data;
            let min = 99;
            for (let i = 0; i < a.length; i += 4) {
              if (Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]) < 30) continue;
              min = Math.min(min, ratio(l, lum(b[i], b[i + 1], b[i + 2])));
            }
            return min;
          };
          const shown = (el) => !el.closest("[hidden]") && getComputedStyle(el).display !== "none";
          const out = {};
          const keep = (key, v) => { if (!(key in out) || v < out[key]) out[key] = v; };
          for (const s of text) {
            for (const el of document.querySelectorAll(s)) {
              let r = el.getBoundingClientRect();
              const strip = el.closest(".forecast");
              if (strip) {
                const b = strip.getBoundingClientRect();
                const left = Math.max(r.left, b.left + fade), right = Math.min(r.right, b.right - fade);
                r = { x: left, y: r.y, width: Math.max(0, right - left), height: r.height };
              }
              if (!r.width || !r.height || !shown(el)) continue;
              const v = minUnderGlyphs(r.x, r.y, r.width, r.height, lumOf(getComputedStyle(el).color));
              if (v < 99) keep(s, v);
            }
          }
          // Borders: the 1 px rows just outside and just inside the top and bottom
          // edges, skipping the rounded ends.
          for (const s of borders) {
            for (const el of document.querySelectorAll(s)) {
              const r = el.getBoundingClientRect();
              if (!r.width || !shown(el)) continue;
              const l = lumOf(getComputedStyle(el).borderTopColor);
              const x = r.left + r.height / 2, w = r.width - r.height;
              for (const y of [Math.floor(r.top) - 1, Math.ceil(r.top) + 1, Math.floor(r.bottom) - 2, Math.ceil(r.bottom)]) {
                keep(s, minOver(full, x, y, w, 1, l));
              }
            }
          }
          return out;
        }, { withText, noText, text: TEXT, borders: BORDERS, fade: FADE });
        for (const [s, v] of Object.entries(result)) if (!(s in worst) || v < worst[s].v) worst[s] = { v, latitude, step };
      }
    }
    const report = Object.entries(worst).sort((a, b) => a[1].v - b[1].v)
      .map(([s, w]) => `${s}=${w.v.toFixed(2)} (lat ${w.latitude}, step ${w.step})`).join("\n");
    console.log(`${scheme}, ${band}:\n${report}`);
    for (const s of TEXT) if (s in worst) expect.soft(worst[s].v, `${s} text`).toBeGreaterThanOrEqual(4.5);
    for (const s of BORDERS) expect.soft(worst[s]?.v, `${s} border`).toBeGreaterThanOrEqual(3);
  });
}
