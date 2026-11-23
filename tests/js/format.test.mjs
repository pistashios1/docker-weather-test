import assert from "node:assert/strict";
import { test } from "node:test";
import {
  conditionForCode, fahrenheitToCelsius, formatClock, formatCoordinates,
  compassPoint, daylightStatus, forecastStartIndex, formatDuration, formatHour,
  formatUtcOffset, hpaToInHg,
  metresToDistance, mphToKmh, toneForFahrenheit, uvCategory,
} from "../../public/static/js/format.js";

test("unit conversions", () => {
  assert.equal(fahrenheitToCelsius(32), 0);
  assert.equal(fahrenheitToCelsius(212), 100);
  assert.ok(Math.abs(mphToKmh(10) - 16.09344) < 1e-9);
});

test("toneForFahrenheit boundaries", () => {
  const cases = [[32, "freezing"], [33, "cool"], [55, "cool"], [56, "mild"],
    [75, "mild"], [76, "warm"], [90, "warm"], [91, "hot"]];
  for (const [f, tone] of cases) assert.equal(toneForFahrenheit(f), tone, `${f}F`);
});

test("conditionForCode maps WMO codes and falls back", () => {
  assert.equal(conditionForCode(0).label, "Clear");
  assert.equal(conditionForCode(48).key, "fog");
  assert.equal(conditionForCode(53).key, "rain");
  assert.equal(conditionForCode(81).label, "Rain");
  assert.equal(conditionForCode(75).label, "Snow");
  assert.equal(conditionForCode(99).label, "Thunderstorm");
  assert.equal(conditionForCode(4).key, "unknown");
  assert.equal(conditionForCode(undefined).key, "unknown");
});

test("Invalid times are shown as --", () => {
  assert.equal(formatHour("garbage"), "--");
  assert.equal(formatClock(Number.NaN), "--");
});

test("Unix API timestamps are converted with the selected timezone", () => {
  const utcTimestamp = 1763215200;
  assert.match(formatHour(utcTimestamp, "UTC"), /2/);
  assert.match(formatHour(utcTimestamp, "America/New_York"), /9/);
  assert.match(formatClock(utcTimestamp, "UTC"), /2:00/);
});

test("formatClock honours an explicit time zone for dates", () => {
  const noonUtc = new Date("2026-11-15T12:00:00Z");
  assert.match(formatClock(noonUtc, "UTC"), /12:00/);
});

test("formatUtcOffset", () => {
  const when = new Date("2026-01-15T12:00:00Z");
  assert.equal(formatUtcOffset("UTC", when), "UTC+0");
  assert.equal(formatUtcOffset("Asia/Kolkata", when), "UTC+5:30");
  assert.equal(formatUtcOffset("America/New_York", when), "UTC-5");
  assert.equal(formatUtcOffset("Not/AZone", when), "UTC");
});

test("formatCoordinates uses hemisphere letters", () => {
  assert.match(formatCoordinates(40.71, -74.01), /^40\.71° N, 74\.01° W$/);
  assert.match(formatCoordinates(-33.87, 151.21), /^33\.87° S, 151\.21° E$/);
});

test("forecastStartIndex picks the hour that contains the current time", () => {
  const hours = [0, 3600, 7200, 10800];
  assert.equal(forecastStartIndex(hours, 3600), 1); // exactly on the hour
  assert.equal(forecastStartIndex(hours, 3600 + 15 * 60), 1); // 15 minutes past
  assert.equal(forecastStartIndex(hours, -60), 0); // before the first hour
});

test("compassPoint names the 16 wind directions and wraps around", () => {
  assert.equal(compassPoint(0), "N");
  assert.equal(compassPoint(11), "N");
  assert.equal(compassPoint(12), "NNE");
  assert.equal(compassPoint(225), "SW");
  assert.equal(compassPoint(350), "N");
  assert.equal(compassPoint(360), "N");
  assert.equal(compassPoint(-90), "W");
});

test("pressure and visibility conversions", () => {
  assert.ok(Math.abs(hpaToInHg(1013.25) - 29.92) < 0.01);
  assert.equal(metresToDistance(24000, true), 24);
  assert.ok(Math.abs(metresToDistance(1609.344, false) - 1) < 1e-9);
});

test("uvCategory follows the WHO bands, which use whole numbers", () => {
  assert.deepEqual(
    [0, 2.4, 2.6, 5.4, 5.6, 7.4, 7.6, 10.4, 10.6].map(uvCategory),
    ["Low", "Low", "Moderate", "Moderate", "High", "High", "Very high", "Very high", "Extreme"],
  );
});

test("formatDuration reads as hours and minutes", () => {
  assert.equal(formatDuration(30), "under a minute");
  assert.equal(formatDuration(45 * 60), "45 min");
  assert.equal(formatDuration(2 * 3600), "2 h");
  assert.equal(formatDuration(3 * 3600 + 24 * 60 + 59), "3 h 24 min");
});

test("daylightStatus follows the sun through the day", () => {
  const day = { sunrise: 1000, sunset: 1000 + 10 * 3600, nextSunrise: 1000 + 24 * 3600 };

  assert.deepEqual(daylightStatus({ ...day, now: 1000 - 3600 }), { text: "Sunrise in 1 h", progress: null });
  const midday = daylightStatus({ ...day, now: 1000 + 5 * 3600 });
  assert.equal(midday.text, "5 h of daylight left");
  assert.equal(midday.progress, 0.5);
  assert.equal(daylightStatus({ ...day, now: day.sunset + 60 }).text, "Sunrise in 13 h 59 min");
  assert.equal(daylightStatus({ ...day, nextSunrise: null, now: day.sunset }).text, "The sun has set");
});

test("daylightStatus gives no text for polar days or missing times", () => {
  assert.deepEqual(daylightStatus({ now: 5, sunrise: 10, sunset: 10 }), { text: null, progress: null });
  assert.deepEqual(daylightStatus({ now: 5, sunrise: null, sunset: 10 }), { text: null, progress: null });
});
