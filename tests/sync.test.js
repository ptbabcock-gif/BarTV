import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStore, memoryStorage } from '../src/store.js';
import { createCloud } from '../src/cloud.js';
import { createSync } from '../src/sync.js';
import { createFakeSupabase } from './fake-supabase.js';

function device(server, storage = memoryStorage()) {
  const store = createStore(storage);
  const cloud = createCloud({ url: server.base, anonKey: 'anon', fetchImpl: server.fetchImpl, getSession: () => store.state.cloud.session, setSession: (session) => store.updateCloud({ session }) });
  const statuses = [];
  const sync = createSync({ store, cloud, onStatus: (s) => statuses.push(s), isOnline: () => true });
  return { store, cloud, sync, statuses, storage };
}

test('cloud: anonymous sign-in happens on first request and the session is stored', async () => {
  const server = createFakeSupabase();
  const { cloud, store } = device(server);
  assert.equal(cloud.configured, true);
  await cloud.token();
  assert.ok(store.state.cloud.session.access);
  assert.ok(cloud.userId().startsWith('user-'));
});

test('cloud: unconfigured client reports so', () => {
  const store = createStore(memoryStorage());
  const cloud = createCloud({ url: '', anonKey: '', getSession: () => null, setSession: () => {} });
  assert.equal(cloud.configured, false);
  assert.equal(createSync({ store, cloud, isOnline: () => true }).status(), 'solo');
});

test('create a group, rate, and a second device joining sees the rating with the rater name', async () => {
  const server = createFakeSupabase();
  const a = device(server);
  const g = await a.sync.createGroup('Soho crew', 'Pat');
  assert.match(g.code, /^[A-Z0-9]{6}$/);
  assert.equal(a.sync.status(), 'synced');

  const v = a.store.addVenue({ name: 'Bar Termini', city: 'London', lat: 51.5, lng: -0.13 });
  const t = a.store.addTasting({ venueId: v.id, scores: { coffee: 5, balance: 4 }, price: 14, ingredients: { liqueur: 'Mr Black' } });
  assert.equal(a.sync.status(), 'pending');
  await a.sync.sync();
  assert.equal(a.sync.status(), 'synced');
  assert.equal(server.db.venues.length, 1);
  assert.equal(server.db.tastings[0].user_id, a.cloud.userId());
  assert.equal(a.store.getTasting(t.id).userName, 'Pat');

  const b = device(server);
  await b.sync.joinGroup(g.code.toLowerCase(), 'Sam');
  assert.equal(b.store.state.venues.length, 1);
  assert.equal(b.store.state.tastings.length, 1);
  assert.equal(b.store.getTasting(t.id).userName, 'Pat');
  assert.deepEqual(Object.values(b.sync.members()).sort(), ['Pat', 'Sam']);

  // B rates the same venue; A pulls it
  b.store.addTasting({ venueId: v.id, scores: { coffee: 3 } });
  await b.sync.sync();
  await a.sync.sync();
  assert.equal(a.store.state.tastings.length, 2);
  assert.equal(a.store.state.tastings.find((x) => x.id !== t.id).userName, 'Sam');
});

test('existing local data is shared on join; non-UUID records are left out', async () => {
  const server = createFakeSupabase();
  const a = device(server);
  const v = a.store.addVenue({ name: 'Dante' });
  a.store.addTasting({ venueId: v.id, scores: { coffee: 4 } });
  const legacy = a.store.addVenue({ id: 'legacy-id', name: 'Old' });
  await a.sync.createGroup('G', 'Pat');
  assert.equal(server.db.venues.length, 1);
  assert.equal(server.db.tastings.length, 1);
  assert.equal(a.store.getVenue(legacy.id).groupId, null);
  assert.equal(a.store.getVenue(v.id).groupId, a.sync.group().id);
});

test('deletes propagate as soft deletes; only your own tastings can be deleted remotely', async () => {
  const server = createFakeSupabase();
  const a = device(server);
  const g = await a.sync.createGroup('G', 'Pat');
  const v = a.store.addVenue({ name: 'V' });
  const t = a.store.addTasting({ venueId: v.id, scores: { coffee: 4 } });
  await a.sync.sync();
  const b = device(server);
  await b.sync.joinGroup(g.code, 'Sam');
  assert.equal(b.store.state.tastings.length, 1);

  a.store.deleteTasting(t.id);
  await a.sync.sync();
  assert.ok(server.db.tastings[0].deleted_at);
  await b.sync.sync();
  assert.equal(b.store.state.tastings.length, 0);

  // B cannot delete A's venue tastings remotely, but soft-deleting the venue works for members
  b.store.deleteVenue(v.id);
  await b.sync.sync();
  assert.ok(server.db.venues[0].deleted_at);
  await a.sync.sync();
  assert.equal(a.store.state.venues.length, 0);
});

test('photos: data URLs are uploaded and replaced with public URLs; removal is synced', async () => {
  const server = createFakeSupabase();
  const a = device(server);
  const g = await a.sync.createGroup('G', 'Pat');
  const img = 'data:image/jpeg;base64,/9j/4AAQSkZJRg==';
  const v = a.store.addVenue({ name: 'V', photos: [img] });
  a.store.addTasting({ venueId: v.id, scores: { coffee: 5 }, photo: img });
  await a.sync.sync();
  const venue = a.store.getVenue(v.id);
  assert.match(venue.photos[0], /^https:\/\/fake\.supabase\.co\/storage\/v1\/object\/public\/photos\//);
  assert.match(a.store.state.tastings[0].photo, /^https:\/\//);
  assert.equal(server.db.venue_photos.length, 1);

  const b = device(server);
  await b.sync.joinGroup(g.code, 'Sam');
  assert.equal(b.store.getVenue(v.id).photos.length, 1);

  a.sync.removeVenuePhoto(v.id, venue.photos[0]);
  await a.sync.sync();
  assert.ok(server.db.venue_photos[0].deleted_at);
  await b.sync.sync();
  assert.equal(b.store.getVenue(v.id).photos.length, 0);
});

test('offline: changes queue and upload once back online; session survives reload', async () => {
  const server = createFakeSupabase();
  let online = true;
  const storage = memoryStorage();
  const store = createStore(storage);
  const cloud = createCloud({ url: server.base, anonKey: 'anon', fetchImpl: server.fetchImpl, getSession: () => store.state.cloud.session, setSession: (session) => store.updateCloud({ session }) });
  const sync = createSync({ store, cloud, isOnline: () => online });
  await sync.createGroup('G', 'Pat');
  online = false;
  const v = store.addVenue({ name: 'Offline bar' });
  store.addTasting({ venueId: v.id, scores: { coffee: 2 } });
  assert.equal((await sync.sync()), false);
  assert.equal(sync.status(), 'offline');
  assert.equal(server.db.venues.length, 0);

  // reload the app from storage
  const store2 = createStore(storage);
  const cloud2 = createCloud({ url: server.base, anonKey: 'anon', fetchImpl: server.fetchImpl, getSession: () => store2.state.cloud.session, setSession: (session) => store2.updateCloud({ session }) });
  const sync2 = createSync({ store: store2, cloud: cloud2, isOnline: () => true });
  assert.equal(store2.state.cloud.pending.length, 2);
  await sync2.sync();
  assert.equal(server.db.venues.length, 1);
  assert.equal(sync2.status(), 'synced');
  assert.equal(cloud2.userId(), cloud.userId(), 'same anonymous identity after reload');
});

test('rename updates the member list and existing ratings on both devices', async () => {
  const server = createFakeSupabase();
  const a = device(server);
  const g = await a.sync.createGroup('G', 'Pat');
  const v = a.store.addVenue({ name: 'V' });
  a.store.addTasting({ venueId: v.id, scores: { coffee: 4 } });
  await a.sync.sync();
  const b = device(server);
  await b.sync.joinGroup(g.code, 'Sam');
  await a.sync.setDisplayName('Patrick');
  assert.equal(a.store.state.tastings[0].userName, 'Patrick');
  await b.sync.sync();
  assert.equal(b.store.state.tastings[0].userName, 'Patrick');
  assert.equal(b.sync.members()[a.cloud.userId()], 'Patrick');
});

test('leaving a group keeps local data and stops syncing', async () => {
  const server = createFakeSupabase();
  const a = device(server);
  await a.sync.createGroup('G', 'Pat');
  a.store.addVenue({ name: 'V' });
  await a.sync.sync();
  a.sync.leaveGroup();
  assert.equal(a.sync.status(), 'solo');
  a.store.addVenue({ name: 'Private' });
  assert.equal(a.store.state.cloud.pending.length, 0);
  assert.equal(a.store.state.venues.length, 2);
});
