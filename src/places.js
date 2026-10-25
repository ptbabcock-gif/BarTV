// Discover bars, pubs, restaurants and cafes near a point using OpenStreetMap's Overpass API.
// No API key. Results are cached briefly so repeated taps don't hammer the community servers.
import { haversineKm } from './geo.js';

export const OVERPASS_URL = 'https://overpass-api.de/api/interpreter';
export const PLACE_KINDS = {
  bar: { label: 'Bar', icon: '🍸' },
  pub: { label: 'Pub', icon: '🍺' },
  restaurant: { label: 'Restaurant', icon: '🍽️' },
  cafe: { label: 'Café', icon: '☕' },
  nightclub: { label: 'Club', icon: '🪩' },
  biergarten: { label: 'Beer garden', icon: '🍻' },
};
const KIND_REGEX = Object.keys(PLACE_KINDS).join('|');

/** Overpass QL for named drinking/eating places within `radius` metres of a point. */
export function overpassQuery(lat, lng, radius = 800) {
  const r = Math.max(50, Math.min(5000, Math.round(radius)));
  return `[out:json][timeout:20];nwr(around:${r},${lat.toFixed(6)},${lng.toFixed(6)})[amenity~"^(${KIND_REGEX})$"][name];out center tags;`;
}

function addressOf(tags = {}) {
  const line1 = [tags['addr:housenumber'], tags['addr:street']].filter(Boolean).join(' ');
  const city = tags['addr:city'] || tags['addr:suburb'] || tags['addr:town'] || tags['addr:village'] || '';
  return { address: [line1, tags['addr:suburb'] && tags['addr:suburb'] !== city ? tags['addr:suburb'] : '', city].filter(Boolean).join(', '), city };
}

/** Normalise an Overpass JSON response into [{id, name, kind, lat, lng, address, city, website, hours}]. */
export function parsePlaces(json) {
  const out = [];
  const seen = new Set();
  for (const el of json?.elements || []) {
    const tags = el.tags || {};
    const lat = el.lat ?? el.center?.lat;
    const lng = el.lon ?? el.center?.lon;
    if (!tags.name || !Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    const kind = PLACE_KINDS[tags.amenity] ? tags.amenity : 'bar';
    const key = `${tags.name.toLowerCase()}|${lat.toFixed(4)}|${lng.toFixed(4)}`;
    if (seen.has(key)) continue; // the same venue often exists as a node and a building outline
    seen.add(key);
    const { address, city } = addressOf(tags);
    out.push({ id: `osm-${el.type}-${el.id}`, name: tags.name, kind, lat, lng, address, city, website: tags.website || tags['contact:website'] || '', hours: tags.opening_hours || '', cuisine: tags.cuisine || '' });
  }
  return out;
}

/** Distance-sorted places around `origin`, each with `km`. */
export function sortByDistance(places, origin) {
  return places.map((p) => ({ ...p, km: haversineKm(origin, p) })).sort((a, b) => a.km - b.km);
}

const norm = (s) => String(s || '').toLowerCase().replace(/^(the|bar|le|la|el)\s+/, '').replace(/[^a-z0-9]+/g, ' ').trim();

/** The rated venue this place corresponds to, if any: same name within 200 m, or anything within 25 m. */
export function matchVenue(place, venues) {
  let best = null;
  for (const v of venues) {
    if (v.lat == null || v.lng == null) continue;
    const m = haversineKm(place, v) * 1000;
    const sameName = norm(v.name) && norm(v.name) === norm(place.name);
    if ((sameName && m <= 200) || m <= 25) {
      if (!best || m < best.m) best = { v, m };
    }
  }
  return best?.v || null;
}

const memo = new Map();
const TTL_MS = 10 * 60 * 1000;

/** Fetch places near a point. `fetchImpl`/`storage`/`now` are injectable for tests. */
export async function fetchNearbyPlaces({ lat, lng, radius = 800 }, { fetchImpl = globalThis.fetch?.bind(globalThis), storage = globalThis.sessionStorage, now = () => Date.now(), url = OVERPASS_URL } = {}) {
  const key = `cheers.places.${lat.toFixed(3)}.${lng.toFixed(3)}.${radius}`;
  const cached = memo.get(key) || (() => { try { return JSON.parse(storage?.getItem(key) || 'null'); } catch { return null; } })();
  if (cached && now() - cached.at < TTL_MS) return cached.places;

  const res = await fetchImpl(url, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'data=' + encodeURIComponent(overpassQuery(lat, lng, radius)) });
  if (res.status === 429) throw new Error('The map service is busy. Wait a moment and try again.');
  if (!res.ok) throw new Error(`Place lookup failed (${res.status})`);
  const places = parsePlaces(await res.json());
  const entry = { at: now(), places };
  memo.set(key, entry);
  try { storage?.setItem(key, JSON.stringify(entry)); } catch { /* storage full or unavailable */ }
  return places;
}
