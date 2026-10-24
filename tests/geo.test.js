import { test } from 'node:test';
import assert from 'node:assert/strict';
import { haversineKm, formatDistance, nearest, project, unproject, tilesForView, fitBounds, geocodeUrl, parseGeocode, geocode } from '../src/geo.js';

test('haversine: London to Paris is about 344 km', () => {
  const km = haversineKm({ lat: 51.5074, lng: -0.1278 }, { lat: 48.8566, lng: 2.3522 });
  assert.ok(km > 340 && km < 345, km);
  assert.equal(haversineKm({ lat: 1, lng: 1 }, { lat: 1, lng: 1 }), 0);
});

test('formatDistance', () => {
  assert.equal(formatDistance(0.25), '250 m');
  assert.equal(formatDistance(2.345), '2.3 km');
  assert.equal(formatDistance(42.6), '43 km');
});

test('nearest sorts by distance and skips venues without coordinates', () => {
  const venues = [{ id: 'far', lat: 0, lng: 10 }, { id: 'none' }, { id: 'near', lat: 0, lng: 1 }];
  assert.deepEqual(nearest(venues, { lat: 0, lng: 0 }).map((r) => r.venue.id), ['near', 'far']);
  assert.equal(nearest(venues, { lat: 0, lng: 0 }, 1).length, 1);
});

test('project/unproject round-trip and known values', () => {
  const p = project(0, 0, 1);
  assert.deepEqual(p, { x: 256, y: 256 }); // centre of the 2x2 world at z=1
  const ll = unproject(p.x, p.y, 1);
  assert.ok(Math.abs(ll.lat) < 1e-9 && Math.abs(ll.lng) < 1e-9);
  const back = unproject(...Object.values(project(51.5, -0.12, 12)), 12);
  assert.ok(Math.abs(back.lat - 51.5) < 1e-6 && Math.abs(back.lng + 0.12) < 1e-6);
});

test('tilesForView covers the viewport and wraps x', () => {
  const tiles = tilesForView({ lat: 0, lng: 180 }, 2, 512, 256);
  assert.ok(tiles.length >= 3);
  assert.ok(tiles.every((t) => t.z === 2 && t.x >= 0 && t.x < 4 && t.y >= 0 && t.y < 4));
  assert.ok(tiles.every((t) => t.px > -256 && t.px < 512 && t.py > -256 && t.py < 256));
});

test('fitBounds picks a zoom at which all points fit', () => {
  const pts = [{ lat: 51.5, lng: -0.1 }, { lat: 51.52, lng: -0.08 }];
  const { center, zoom } = fitBounds(pts, 400, 600);
  assert.ok(zoom >= 12 && zoom <= 17, zoom);
  assert.ok(center.lat > 51.5 && center.lat < 51.52);
  const w = fitBounds([{ lat: 40.7, lng: -74 }, { lat: -33.9, lng: 151.2 }], 400, 600);
  assert.ok(w.zoom <= 3);
  assert.equal(fitBounds([], 400, 600).zoom, 2);
  assert.equal(fitBounds([{ lat: 1, lng: 1 }], 400, 600).zoom, 15);
});

test('geocode builds a Nominatim URL and parses results', async () => {
  const url = new URL(geocodeUrl('Bar Termini London'));
  assert.equal(url.origin + url.pathname, 'https://nominatim.openstreetmap.org/search');
  assert.equal(url.searchParams.get('q'), 'Bar Termini London');
  assert.equal(url.searchParams.get('format'), 'jsonv2');
  const sample = [
    { lat: '51.5134', lon: '-0.1316', name: 'Bar Termini', display_name: 'Bar Termini, Old Compton Street, Soho, London, UK', address: { city: 'London' } },
    { lat: 'x', lon: '1' },
    { lat: '1', lon: '2', display_name: 'Somewhere, Town', address: { town: 'Town' } },
  ];
  const parsed = parseGeocode(sample);
  assert.equal(parsed.length, 2);
  assert.equal(parsed[0].name, 'Bar Termini');
  assert.equal(parsed[0].city, 'London');
  assert.equal(parsed[1].name, 'Somewhere');
  assert.equal(parsed[1].city, 'Town');
  const fetchImpl = async () => ({ ok: true, json: async () => sample });
  assert.equal((await geocode('anything', fetchImpl)).length, 2);
  assert.deepEqual(await geocode('   ', fetchImpl), []);
  await assert.rejects(geocode('q', async () => ({ ok: false, status: 503 })));
});
