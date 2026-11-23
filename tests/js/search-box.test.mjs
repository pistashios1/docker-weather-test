import assert from "node:assert/strict";
import { test } from "node:test";
import { findMatch } from "../../public/static/js/search-box.js";

test("findMatch splits the name around the typed text", () => {
  assert.deepEqual(findMatch("Springfield", "spring"), ["", "Spring", "field"]);
  assert.deepEqual(findMatch("New York", "york"), ["New ", "York", ""]);
});

test("findMatch ignores accents and case, and keeps the original characters", () => {
  assert.deepEqual(findMatch("São Paulo", "sao"), ["", "São", " Paulo"]);
  assert.deepEqual(findMatch("Zürich", "ZUR"), ["", "Zür", "ich"]);
});

test("findMatch returns null when the text is not in the name", () => {
  assert.equal(findMatch("Paris", "rome"), null);
  assert.equal(findMatch("Paris", "   "), null);
});
