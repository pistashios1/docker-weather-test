import assert from "node:assert/strict";
import { test } from "node:test";
import { projectCoordinates } from "../../public/static/js/map-marker.js";

test("projects to ratios of the tile, never pixels", () => {
  assert.deepEqual(projectCoordinates(84, -180), { x: 0, y: 0 });
  assert.deepEqual(projectCoordinates(-58, 180), { x: 1, y: 1 });
  assert.deepEqual(projectCoordinates(13, 0), { x: 0.5, y: 0.5 });
});

test("clamps latitudes outside the cropped tile", () => {
  assert.equal(projectCoordinates(90, 0).y, 0);
  assert.equal(projectCoordinates(-90, 0).y, 1);
});

test("rejects invalid coordinates", () => {
  for (const [lat, lon] of [[91, 0], [0, 181], [-91, 0], [0, -181],
    [Number.NaN, 0], [0, Infinity], [undefined, 0]]) {
    assert.equal(projectCoordinates(lat, lon), null, `${lat},${lon}`);
  }
});
