import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { readStorage, writeStorage } from "../../public/static/js/storage.js";

afterEach(() => { delete globalThis.localStorage; });

test("reads and writes through localStorage", () => {
  const data = new Map();
  globalThis.localStorage = {
    getItem: (k) => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => data.set(k, v),
  };
  writeStorage("unit", "metric");
  assert.equal(readStorage("unit"), "metric");
  assert.equal(readStorage("missing"), null);
});

test("blocked or absent storage never throws", () => {
  globalThis.localStorage = {
    getItem() { throw new DOMException("denied", "SecurityError"); },
    setItem() { throw new DOMException("full", "QuotaExceededError"); },
  };
  assert.equal(readStorage("k"), null);
  assert.doesNotThrow(() => writeStorage("k", "v"));
  delete globalThis.localStorage;
  assert.equal(readStorage("k"), null);
  assert.doesNotThrow(() => writeStorage("k", "v"));
});
