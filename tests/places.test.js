import { test } from 'node:test';
import assert from 'node:assert/strict';
import { overpassQuery, parsePlaces, sortByDistance, matchVenue, fetchNearbyPlaces } from '../src/places.js';
import { memoryStorage } from '../src/store.js';

const SAMPLE = {
  elements: [
    { type: 'node', id: 1, lat: 51.5134, lon: -0.1316, tags: { amenity: 'bar', name: 'Bar Termini', 'addr:housenumber': '7', 'addr:street': 'Old Compton Street', 'addr:city': 'London', opening_hours: 'Mo-Sa 10:00-23:30' } },
    { type: 'way', id: 2, center: { lat: 51.5120, lon: -0.1372 }, tags: { amenity: 'cafe', name: 'The Soho Grind', 'addr:suburb': 'Soho' } },
    { type: 'node', id: 3, lat: 51.5134, lon: -0.1316, tags: { amenity: 'bar', name: 'bar termini' } }, // duplicate of 1
    { type: 'node', id: 4, lat: 51.514, lon: -0.13, tags: { amenity: 'bar' } }, // unnamed: dropped
    { type: 'node', id: 5, lat: 51.515, lon: -0.135, tags: { amenity: 'pub', name: 'The French House', website: 'https://frenchhouse.example' } },
    { type: 'node', id: 6, tags: { amenity: 'bar', name: 'No coords' } },
  ],
};

test('overpassQuery asks for named bars, pubs, restaurants and cafes around a point', () => {
  const q = overpassQuery(51.5, -0.12, 800);
  assert.match(q, /around:800,51\.500000,-0\.120000/);
  assert.match(q, /amenity~"\^\(bar\|pub\|restaurant\|cafe\|nightclub\|biergarten\)\$"/);
  assert.match(q, /\[name\]/);
  assert.match(overpassQuery(0, 0, 99999), /around:5000,/);
});

test('parsePlaces handles nodes and ways, builds addresses, de-duplicates and drops junk', () => {
  const places = parsePlaces(SAMPLE);
  assert.deepEqual(places.map((p) => p.name), ['Bar Termini', 'The Soho Grind', 'The French House']);
  assert.equal(places[0].address, '7 Old Compton Street, London');
  assert.equal(places[0].city, 'London');
  assert.equal(places[0].hours, 'Mo-Sa 10:00-23:30');
  assert.equal(places[1].kind, 'cafe');
  assert.equal(places[1].lat, 51.512);
  assert.equal(places[1].city, 'Soho');
  assert.equal(places[2].website, 'https://frenchhouse.example');
  assert.deepEqual(parsePlaces(null), []);
});

test('sortByDistance and matchVenue', () => {
  const places = sortByDistance(parsePlaces(SAMPLE), { lat: 51.5136, lng: -0.133 });
  assert.equal(places[0].name, 'Bar Termini');
  assert.ok(places[0].km < 0.2);
  const venues = [
    { id: 'a', name: 'Bar Termini', lat: 51.5135, lng: -0.1318 },
    { id: 'b', name: 'Somewhere else', lat: 51.5120, lng: -0.1372 },
    { id: 'c', name: 'The French House', lat: 51.52, lng: -0.10 },
  ];
  assert.equal(matchVenue(places.find((p) => p.name === 'Bar Termini'), venues).id, 'a', 'same name nearby');
  assert.equal(matchVenue(places.find((p) => p.name === 'The Soho Grind'), venues).id, 'b', 'different name but same spot');
  assert.equal(matchVenue(places.find((p) => p.name === 'The French House'), venues), null, 'same name but far away');
});

test('fetchNearbyPlaces posts the query, parses the result and caches it', async () => {
  const calls = [];
  const fetchImpl = async (url, init) => { calls.push({ url, init }); return { ok: true, status: 200, json: async () => SAMPLE }; };
  const storage = memoryStorage();
  let t = 1000;
  const opts = { fetchImpl, storage, now: () => t };
  const a = await fetchNearbyPlaces({ lat: 51.51, lng: -0.13, radius: 400 }, opts);
  assert.equal(a.length, 3);
  assert.equal(calls[0].url, 'https://overpass-api.de/api/interpreter');
  assert.match(decodeURIComponent(calls[0].init.body), /around:400,51\.510000/);
  await fetchNearbyPlaces({ lat: 51.51, lng: -0.13, radius: 400 }, opts);
  assert.equal(calls.length, 1, 'second call within TTL is served from cache');
  t += 11 * 60 * 1000;
  await fetchNearbyPlaces({ lat: 51.51, lng: -0.13, radius: 400 }, opts);
  assert.equal(calls.length, 2, 'cache expires');
  await assert.rejects(fetchNearbyPlaces({ lat: 1, lng: 1 }, { ...opts, fetchImpl: async () => ({ ok: false, status: 429 }) }), /busy/);
});
