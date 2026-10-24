import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStore, memoryStorage, sanitizeState, todayISO } from '../src/store.js';

function fresh() { return createStore(memoryStorage()); }

test('starts empty and persists across reloads', () => {
  const storage = memoryStorage();
  const s = createStore(storage);
  assert.equal(s.state.venues.length, 0);
  const v = s.addVenue({ name: 'Bar Termini', city: 'London', lat: 51.51, lng: -0.13 });
  s.addTasting({ venueId: v.id, scores: { coffee: 5, balance: 4 }, price: 12.5, ingredients: { vodka: 'Ketel One' } });
  const s2 = createStore(storage);
  assert.equal(s2.state.venues.length, 1);
  assert.equal(s2.state.tastings.length, 1);
  assert.equal(s2.state.tastings[0].ingredients.vodka, 'Ketel One');
  assert.equal(s2.state.venues[0].lat, 51.51);
});

test('venue validation and find-or-create', () => {
  const s = fresh();
  assert.throws(() => s.addVenue({ name: '   ' }));
  const a = s.findOrCreateVenue({ name: 'Dante', city: 'New York' });
  const b = s.findOrCreateVenue({ name: 'dante ', city: 'new york' });
  assert.equal(a.id, b.id);
  const c = s.findOrCreateVenue({ name: 'Dante', city: 'Chicago' });
  assert.notEqual(a.id, c.id);
  assert.equal(s.state.venues.length, 2);
});

test('coordinates outside range are dropped', () => {
  const s = fresh();
  const v = s.addVenue({ name: 'X', lat: 100, lng: 'nope' });
  assert.equal(v.lat, null); assert.equal(v.lng, null);
});

test('tasting sanitising: scores clamp, dates default, photo must be a data image', () => {
  const s = fresh();
  const v = s.addVenue({ name: 'V' });
  const t = s.addTasting({ venueId: v.id, scores: { coffee: 7, foam: 3, balance: '4' }, date: 'yesterday', price: -3, photo: 'http://evil' });
  assert.deepEqual(t.scores, { foam: 3, balance: 4 });
  assert.equal(t.date, todayISO());
  assert.equal(t.price, null);
  assert.equal(t.photo, null);
  assert.throws(() => s.addTasting({ venueId: 'missing', scores: {} }));
});

test('update and delete cascade', () => {
  const s = fresh();
  const v = s.addVenue({ name: 'V' });
  const t = s.addTasting({ venueId: v.id, scores: { coffee: 3 } });
  s.updateTasting(t.id, { notes: 'hi', scores: { coffee: 5 } });
  assert.equal(s.getTasting(t.id).notes, 'hi');
  s.updateVenue(v.id, { name: 'Renamed' });
  assert.equal(s.getVenue(v.id).name, 'Renamed');
  s.deleteVenue(v.id);
  assert.equal(s.state.tastings.length, 0);
});

test('export/import round trip, merge and replace', () => {
  const a = fresh();
  const v = a.addVenue({ name: 'A' });
  a.addTasting({ venueId: v.id, scores: { coffee: 4 } });
  const json = a.exportJSON();

  const b = fresh();
  b.addVenue({ name: 'B' });
  const r = b.importJSON(json, 'merge');
  assert.deepEqual(r, { venues: 1, tastings: 1 });
  assert.equal(b.state.venues.length, 2);
  b.importJSON(json, 'merge'); // idempotent
  assert.equal(b.state.venues.length, 2);
  b.importJSON(json, 'replace');
  assert.equal(b.state.venues.length, 1);
  assert.throws(() => b.importJSON('{"nope":1}'));
  assert.throws(() => sanitizeState(null));
});

test('orphan tastings are dropped on load; corrupt storage falls back to empty', () => {
  const storage = memoryStorage();
  storage.setItem('crema.state', JSON.stringify({ venues: [{ id: 'v1', name: 'V' }], tastings: [{ id: 't1', venueId: 'ghost' }, { id: 't2', venueId: 'v1' }] }));
  assert.equal(createStore(storage).state.tastings.length, 1);
  storage.setItem('crema.state', '{not json');
  assert.equal(createStore(storage).state.venues.length, 0);
});

test('subscribe notifies on change', () => {
  const s = fresh();
  let n = 0;
  const off = s.subscribe(() => n++);
  s.addVenue({ name: 'V' });
  s.setSetting('theme', 'dark');
  off();
  s.addVenue({ name: 'W' });
  assert.equal(n, 2);
  assert.equal(s.state.settings.theme, 'dark');
});

test('venue photos: only data images are kept, capped at the maximum', () => {
  const s = fresh();
  const good = 'data:image/jpeg;base64,AAAA';
  const v = s.addVenue({ name: 'V', photos: [good, 'http://x/y.jpg', 42, good] });
  assert.deepEqual(v.photos, [good, good]);
  s.updateVenue(v.id, { photos: new Array(40).fill(good) });
  assert.equal(s.getVenue(v.id).photos.length, 30);
  assert.deepEqual(s.addVenue({ name: 'W' }).photos, []);
});
