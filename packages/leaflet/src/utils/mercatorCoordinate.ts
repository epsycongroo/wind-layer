import { utils } from '@jokkicn/vis-engine';

const { clamp } = utils;

export const earthRadius = 6371008.8;

/*
 * The average circumference of the world in meters.
 */
export const earthCircumference = 2 * Math.PI * earthRadius; // meters
export const halfEarthCircumference = earthCircumference / 2; // meters
/*
 * The circumference at a line of latitude in meters.
 */
export function circumferenceAtLatitude(latitude) {
  return earthCircumference * Math.cos((latitude * Math.PI) / 180);
}

export function mercatorXfromLng(lng: number) {
  return (180 + lng) / 360;
}

export function mercatorYfromLat(lat: number) {
  return (180 - (180 / Math.PI) * Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360))) / 360;
}

export function mercatorZfromAltitude(altitude, lat) {
  return altitude / circumferenceAtLatitude(lat);
}

export function lngFromMercatorX(x: number, wrap = 0) {
  return x * 360 - 180 + wrap * 360;
}

export function latFromMercatorY(y) {
  const y2 = 180 - y * 360;
  return (360 / Math.PI) * Math.atan(Math.exp((y2 * Math.PI) / 180)) - 90;
}

export function altitudeFromMercatorZ(z, y) {
  return z * circumferenceAtLatitude(latFromMercatorY(y));
}

/**
 * Determine the Mercator scale factor for a given latitude, see
 * https://en.wikipedia.org/wiki/Mercator_projection#Scale_factor
 *
 * At the equator the scale factor will be 1, which increases at higher latitudes.
 *
 * @param {number} lat Latitude
 * @returns {number} scale factor
 * @private
 */
export function mercatorScale(lat) {
  return 1 / Math.cos((lat * Math.PI) / 180);
}

export function meterInMercatorCoordinateUnits(y) {
  // 1 meter / circumference at equator in meters * Mercator projection scale factor at this latitude
  return (1 / earthCircumference) * mercatorScale(latFromMercatorY(y));
}

export function pixelsInMercatorCoordinateUnits(lat, pixelsPerMeter) {
  return (1 / earthCircumference) * mercatorScale(lat) * pixelsPerMeter;
}

export const MAX_MERCATOR_LATITUDE = 85.051129;

/**
 * 经纬度转到 mapbox 墨卡托坐标
 * @param lngLatLike
 * @param altitude
 */
export function fromLngLat(lngLatLike, altitude = 0) {
  const lat = clamp(lngLatLike.lat, -MAX_MERCATOR_LATITUDE, MAX_MERCATOR_LATITUDE);
  return {
    x: mercatorXfromLng(lngLatLike.lng),
    y: mercatorYfromLat(lat),
    z: mercatorZfromAltitude(altitude, lat),
  };
}

/**
 * 墨卡托坐标转经纬度
 * @param mercatorCoordinate
 */
export function toLngLat(mercatorCoordinate) {
  return {
    lng: lngFromMercatorX(mercatorCoordinate.x),
    lat: latFromMercatorY(mercatorCoordinate.y),
  };
}

export function getCoordinatesCenterTileID(coords: Array<{ x: number; y: number }>) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const coord of coords) {
    minX = Math.min(minX, coord.x);
    minY = Math.min(minY, coord.y);
    maxX = Math.max(maxX, coord.x);
    maxY = Math.max(maxY, coord.y);
  }

  const dx = maxX - minX;
  const dy = maxY - minY;
  const dMax = Math.max(dx, dy);
  const zoom = Math.max(0, Math.floor(-Math.log(dMax) / Math.LN2));
  const tilesAtZoom = Math.pow(2, zoom);

  return {
    z: zoom,
    x: Math.floor(((minX + maxX) / 2) * tilesAtZoom),
    y: Math.floor(((minY + maxY) / 2) * tilesAtZoom),
    extent: [minX, minY, maxX, maxY],
  };
}
