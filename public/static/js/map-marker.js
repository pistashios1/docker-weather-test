// Projects weather coordinates onto the generated equirectangular map tile.
// The SVG viewBox is 360 x 142 units: 360 degrees of longitude from -180 to
// 180, and the cropped latitude range from 84N to 58S.
//
// The projection is expressed as ratios (0 to 1) of the tile, never pixels.
// The markers live inside .map-track and are placed in CSS from those ratios
// and the track's own --tile-width / --tile-height, so they always share the
// map's coordinate space. Nothing here reads the viewport or element sizes,
// which means resizing the window cannot move a marker off the map.
const MAP_PROJECTION = Object.freeze({
  north: 84,
  south: -58,
  west: -180,
  east: 180,
});

export const projectCoordinates = (latitude, longitude) => {
  if (
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude) ||
    latitude < -90 ||
    latitude > 90 ||
    longitude < -180 ||
    longitude > 180
  ) {
    return null;
  }

  const xRatio = (longitude - MAP_PROJECTION.west) /
    (MAP_PROJECTION.east - MAP_PROJECTION.west);
  const yRatio = (MAP_PROJECTION.north - latitude) /
    (MAP_PROJECTION.north - MAP_PROJECTION.south);
  return {
    x: Math.min(1, Math.max(0, xRatio)),
    y: Math.min(1, Math.max(0, yRatio)),
  };
};

export const createMapMarker = ({ track, markers }) => {
  const markerElements = Array.from(markers);

  const clear = () => {
    markerElements.forEach((marker) => {
      marker.hidden = true;
    });
    track.style.removeProperty("--marker-x");
    track.style.removeProperty("--marker-y");
  };

  const setCoordinates = (latitude, longitude) => {
    const point = projectCoordinates(latitude, longitude);
    if (!point) {
      clear();
      return;
    }

    // Ratios only: CSS multiplies them by the live tile size.
    track.style.setProperty("--marker-x", String(point.x));
    track.style.setProperty("--marker-y", String(point.y));
    markerElements.forEach((marker) => {
      marker.hidden = false;
    });
  };

  return { clear, setCoordinates };
};
