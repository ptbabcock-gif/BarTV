// Geography helpers: distance, Web Mercator tile math, and geocoding.
// Pure functions except geocode()/currentPosition(), which take injectable dependencies.

const R_EARTH_KM = 6371;
const TILE = 256;

/** Great-circle distance in km between two {lat,lng} points. */
export function haversineKm(a, b) {
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const la1 = toRad(a.lat);
  const la2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) ** 2;
  return 2 * R_EARTH_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function formatDistance(km) {
  if (km == null) return '';
  if (km < 1) return `${Math.round(km * 1000)} m`;
  if (km < 10) return `${km.toFixed(1)} km`;
  return `${Math.round(km)} km`;
}

/** Venues with coordinates, sorted by distance from `origin`. */
export function nearest(venues, origin, limit = Infinity) {
  return venues
    .filter((v) => v.lat != null && v.lng != null)
    .map((v) => ({ venue: v, km: haversineKm(origin, v) }))
    .sort((a, b) => a.km - b.km)
    .slice(0, limit);
}

/** Lat/lng -> world pixel coordinates at a (fractional) zoom level. */
export function project(lat, lng, zoom) {
  const scale = TILE * Math.pow(2, zoom);
  const x = ((lng + 180) / 360) * scale;
  const latR = (Math.max(-85.0511, Math.min(85.0511, lat)) * Math.PI) / 180;
  const y = ((1 - Math.log(Math.tan(latR) + 1 / Math.cos(latR)) / Math.PI) / 2) * scale;
  return { x, y };
}

/** World pixel coordinates -> lat/lng. */
export function unproject(x, y, zoom) {
  const scale = TILE * Math.pow(2, zoom);
  const lng = (x / scale) * 360 - 180;
  const n = Math.PI - (2 * Math.PI * y) / scale;
  const lat = (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
  return { lat, lng };
}

/** Tile indices covering a viewport. Returns [{z,x,y,px,py}] with px/py = screen offset of each tile. */
export function tilesForView(center, zoom, width, height) {
  const z = Math.round(zoom);
  const c = project(center.lat, center.lng, z);
  const left = c.x - width / 2;
  const top = c.y - height / 2;
  const max = Math.pow(2, z);
  const x0 = Math.floor(left / TILE);
  const y0 = Math.floor(top / TILE);
  const x1 = Math.ceil((left + width) / TILE) - 1;
  const y1 = Math.ceil((top + height) / TILE) - 1;
  const tiles = [];
  for (let x = x0; x <= x1; x++) {
    for (let y = y0; y <= y1; y++) {
      if (y < 0 || y >= max) continue;
      tiles.push({ z, x: ((x % max) + max) % max, y, px: x * TILE - left, py: y * TILE - top });
    }
  }
  return tiles;
}

/** Center + integer zoom that fits all points in a width×height viewport with padding. */
export function fitBounds(points, width, height, { padding = 40, maxZoom = 17, minZoom = 2 } = {}) {
  const pts = points.filter((p) => p.lat != null && p.lng != null);
  if (pts.length === 0) return { center: { lat: 20, lng: 0 }, zoom: minZoom };
  if (pts.length === 1) return { center: { lat: pts[0].lat, lng: pts[0].lng }, zoom: Math.min(maxZoom, 15) };
  const lats = pts.map((p) => p.lat);
  const lngs = pts.map((p) => p.lng);
  const sw = { lat: Math.min(...lats), lng: Math.min(...lngs) };
  const ne = { lat: Math.max(...lats), lng: Math.max(...lngs) };
  let zoom = maxZoom;
  for (; zoom > minZoom; zoom--) {
    const a = project(ne.lat, sw.lng, zoom);
    const b = project(sw.lat, ne.lng, zoom);
    if (b.x - a.x <= width - padding * 2 && b.y - a.y <= height - padding * 2) break;
  }
  const a = project(ne.lat, sw.lng, zoom);
  const b = project(sw.lat, ne.lng, zoom);
  const center = unproject((a.x + b.x) / 2, (a.y + b.y) / 2, zoom);
  return { center, zoom };
}

export const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search';

export function geocodeUrl(query, limit = 5) {
  const u = new URL(NOMINATIM_URL);
  u.searchParams.set('q', query);
  u.searchParams.set('format', 'jsonv2');
  u.searchParams.set('limit', String(limit));
  u.searchParams.set('addressdetails', '1');
  return u.toString();
}

/** Parse a Nominatim jsonv2 response into [{name, address, lat, lng}]. */
export function parseGeocode(results) {
  if (!Array.isArray(results)) return [];
  return results
    .map((r) => {
      const lat = Number(r.lat);
      const lng = Number(r.lon);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
      const a = r.address || {};
      const name = r.name || a.amenity || String(r.display_name || '').split(',')[0].trim();
      const city = a.city || a.town || a.village || a.suburb || a.county || '';
      return { name, address: String(r.display_name || ''), city, lat, lng };
    })
    .filter(Boolean);
}

/** Look up places by free-text query. `fetchImpl` is injectable for tests. */
export async function geocode(query, fetchImpl = globalThis.fetch) {
  const q = String(query || '').trim();
  if (!q) return [];
  const res = await fetchImpl(geocodeUrl(q), { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`Place search failed (${res.status})`);
  return parseGeocode(await res.json());
}

/** Turn a GeolocationPositionError into something a person can act on. */
export function describeGeoError(err = {}) {
  const msg = String(err.message || '');
  if (/permissions policy|feature policy|disabled in this document/i.test(msg)) {
    return 'Location is blocked by the page this app is embedded in. Open the app at its own web address to use it.';
  }
  if (err.code === 1) return 'Location permission was denied. Allow location for this site in your browser settings.';
  if (err.code === 2) return 'Your position could not be determined. Check that location services are on.';
  if (err.code === 3) return 'Finding your location timed out. Try again outdoors or on Wi-Fi.';
  return msg || 'Could not get your location';
}

/** Promise wrapper around the Geolocation API. */
export function currentPosition(geolocation = globalThis.navigator?.geolocation) {
  return new Promise((resolve, reject) => {
    if (!geolocation) return reject(new Error('Location is not available on this device'));
    geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy }),
      (err) => reject(new Error(describeGeoError(err))),
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 60000 },
    );
  });
}
