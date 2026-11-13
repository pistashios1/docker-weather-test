// Builds public/static/img/world-map.svg: an outline-only world map used as the
// dashboard's background.
//
// Data: Natural Earth 1:110m land polygons (public domain), via the
// `world-atlas` package. Projection: equirectangular (plate carree), so a pixel
// maps linearly to longitude and latitude. The map spans exactly 360 degrees of
// longitude, so copies placed side by side join with no seam, which is what
// lets the CSS scroll it forever.
//
// Usage (from this directory):
//   npm install
//   npm run build-map

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { geoEquirectangular, geoGraticule10, geoPath } from "d3-geo";
import { feature } from "topojson-client";

const here = dirname(fileURLToPath(import.meta.url));
const outFile = resolve(here, "../public/static/img/world-map.svg");

// 1 SVG unit = 1 degree. The map is cropped to 84N..58S: Antarctica is left out
// because it would take a fifth of the height for a region almost nobody looks up.
const NORTH = 84;
const SOUTH = -58;
const WIDTH = 360;
const HEIGHT = NORTH - SOUTH;

const atlas = JSON.parse(
  readFileSync(resolve(here, "node_modules/world-atlas/land-110m.json"), "utf8")
);
const land = feature(atlas, atlas.objects.land);

const projection = geoEquirectangular()
  .scale(180 / Math.PI)
  .translate([WIDTH / 2, NORTH]);
const path = geoPath(projection).digits(1);

const round = (value) => Number(value.toFixed(2));
const y = (latitude) => round(NORTH - latitude);
const x = (longitude) => round(longitude + 180);

// Graticule: a line every 30 degrees, drawn by hand so the crop is exact.
const graticule = [];
for (let longitude = -180; longitude <= 180; longitude += 30) {
  graticule.push(`M${x(longitude)} 0V${HEIGHT}`);
}
for (let latitude = 60; latitude >= -30; latitude -= 30) {
  graticule.push(`M0 ${y(latitude)}H${WIDTH}`);
}
// Equator and the tropics, which matter for weather.
const climateLines = [23.4368, 0, -23.4368].map((latitude) => `M0 ${y(latitude)}H${WIDTH}`);

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${WIDTH} ${HEIGHT}" fill="none" stroke="#000" stroke-linejoin="round" stroke-linecap="round">
<title>World map outline (Natural Earth 1:110m, equirectangular, 84N to 58S)</title>
<path stroke-width="0.25" vector-effect="non-scaling-stroke" opacity="0.55" d="${graticule.join("")}"/>
<path stroke-width="0.25" vector-effect="non-scaling-stroke" stroke-dasharray="2 3" d="${climateLines.join("")}"/>
<path stroke-width="1" vector-effect="non-scaling-stroke" d="${path(land)}"/>
</svg>
`;

mkdirSync(dirname(outFile), { recursive: true });
writeFileSync(outFile, svg);
console.log(`Wrote ${outFile} (${(svg.length / 1024).toFixed(1)} KB)`);
