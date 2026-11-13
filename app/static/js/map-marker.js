// Projects weather coordinates onto the generated equirectangular map tile.
// The SVG viewBox is 360 x 142 units: 360 degrees of longitude from -180 to
// 180, and the cropped latitude range from 84N to 58S.
const MAP_PROJECTION = Object.freeze({
  north: 84,
  south: -58,
  west: -180,
  east: 180,
  width: 360,
  height: 142,
});

const readTileScale = (track) => {
  const height = track.getBoundingClientRect().height;
  const width = height * MAP_PROJECTION.width / MAP_PROJECTION.height;
  return Number.isFinite(width) && width > 0 && Number.isFinite(height) && height > 0
    ? { width, height }
    : null;
};

export const projectCoordinates = (latitude, longitude, scale) => {
  if (
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude) ||
    latitude < -90 ||
    latitude > 90 ||
    longitude < -180 ||
    longitude > 180 ||
    !scale
  ) {
    return null;
  }

  const xRatio = (longitude - MAP_PROJECTION.west) /
    (MAP_PROJECTION.east - MAP_PROJECTION.west);
  const yRatio = (MAP_PROJECTION.north - latitude) /
    (MAP_PROJECTION.north - MAP_PROJECTION.south);
  return {
    x: Math.min(1, Math.max(0, xRatio)) * scale.width,
    y: Math.min(1, Math.max(0, yRatio)) * scale.height,
  };
};

export const createMapMarker = ({ track, markers }) => {
  const markerElements = Array.from(markers);

  const clear = () => {
    markerElements.forEach((marker) => {
      marker.hidden = true;
    });
  };

  const setCoordinates = (latitude, longitude) => {
    const scale = readTileScale(track);
    const point = projectCoordinates(latitude, longitude, scale);
    if (!point) {
      clear();
      return;
    }

    markerElements.forEach((marker, index) => {
      marker.style.left = `${point.x + index * scale.width}px`;
      marker.style.top = `${point.y}px`;
      marker.hidden = false;
    });
  };

  return { clear, setCoordinates };
};
