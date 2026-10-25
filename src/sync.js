// Offline-first sync between the local store and a shared group in the cloud.
// Local state is always the source of truth for the UI. Mutations are queued and
// pushed when online; remote changes are pulled by `updated_at` and merged in.
import { UUID_RE } from './store.js';

export const SYNC_STATUS = { solo: 'solo', syncing: 'syncing', synced: 'synced', pending: 'pending', offline: 'offline', error: 'error' };

function uid() { return globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID() : null; }

export function toRemoteVenue(v, groupId) {
  return { id: v.id, group_id: groupId, name: v.name, city: v.city, address: v.address, lat: v.lat, lng: v.lng, notes: v.notes, created_by: v.createdBy };
}
export function fromRemoteVenue(r, local) {
  return { ...(local || {}), id: r.id, name: r.name, city: r.city || '', address: r.address || '', lat: r.lat, lng: r.lng, notes: r.notes || '', groupId: r.group_id, createdBy: r.created_by, createdAt: local?.createdAt || r.created_at };
}
export function toRemoteTasting(t, groupId) {
  return { id: t.id, group_id: groupId, venue_id: t.venueId, user_id: t.userId, date: t.date, price: t.price, scores: t.scores, ingredients: t.ingredients, notes: t.notes, would_order_again: t.wouldOrderAgain, photo_url: t.photo && t.photo.startsWith('https://') ? t.photo : null };
}
export function fromRemoteTasting(r, local, members) {
  return { ...(local || {}), id: r.id, venueId: r.venue_id, date: r.date, price: r.price, scores: r.scores || {}, ingredients: r.ingredients || {}, notes: r.notes || '', wouldOrderAgain: r.would_order_again, photo: r.photo_url || (local?.photo?.startsWith('data:') ? local.photo : null), groupId: r.group_id, userId: r.user_id, userName: members[r.user_id] || local?.userName || '', createdAt: local?.createdAt || r.created_at };
}

export function createSync({ store, cloud, onStatus = () => {}, isOnline = () => globalThis.navigator?.onLine !== false }) {
  let status = SYNC_STATUS.solo;
  let running = null;
  let timer = null;
  let lastError = '';

  const cs = () => store.state.cloud;
  const inGroup = () => Boolean(cloud.configured && cs().group && cs().me);
  const setStatus = (s, err = '') => { status = s; lastError = err; onStatus(s, err); };
  const refreshStatus = () => {
    if (!inGroup()) return setStatus(SYNC_STATUS.solo);
    if (!isOnline()) return setStatus(SYNC_STATUS.offline);
    setStatus(cs().pending.length ? SYNC_STATUS.pending : SYNC_STATUS.synced);
  };

  // ----- queue -----
  function enqueue(op) {
    if (!inGroup()) return;
    const pending = cs().pending.filter((p) => !(p.type === op.type && p.id === op.id)); // latest op per record wins
    pending.push({ ...op, at: new Date().toISOString() });
    store.updateCloud({ pending });
    refreshStatus();
    schedule(400);
  }
  store.setMutationHook(enqueue);

  function schedule(ms) {
    clearTimeout(timer);
    timer = setTimeout(() => { sync().catch(() => {}); }, ms);
  }

  // ----- photos: data URLs are uploaded and replaced by public URLs -----
  async function materializePhotos(groupId) {
    const me = cs().me.id;
    const queued = new Set(cs().pending.map((p) => p.id));
    const ours = (r) => r.groupId === groupId || queued.has(r.id);
    for (const t of store.state.tastings) {
      if (ours(t) && (!t.userId || t.userId === me) && t.photo && t.photo.startsWith('data:')) {
        const url = await cloud.uploadPhoto(`${groupId}/${me}/${t.id}.jpg`, t.photo);
        store.applyRemote((s) => s.updateTasting(t.id, { photo: url }));
      }
    }
    for (const v of store.state.venues) {
      if (!ours(v)) continue;
      let changed = false;
      const photos = [...v.photos];
      const photoIds = { ...v.photoIds };
      for (let i = 0; i < photos.length; i++) {
        if (!photos[i].startsWith('data:')) continue;
        const pid = uid();
        const url = await cloud.uploadPhoto(`${groupId}/${me}/${pid}.jpg`, photos[i]);
        await cloud.upsert('venue_photos', [{ id: pid, group_id: groupId, venue_id: v.id, user_id: me, url }]);
        photos[i] = url; photoIds[url] = pid; changed = true;
      }
      if (changed) store.applyRemote((s) => s.updateVenue(v.id, { photos, photoIds }));
    }
  }

  // ----- push -----
  async function push() {
    const groupId = cs().group.id;
    await materializePhotos(groupId);
    for (const op of [...cs().pending]) {
      if (op.type === 'venue') {
        const v = store.getVenue(op.id);
        if (v && UUID_RE.test(v.id)) {
          if (!v.groupId || !v.createdBy) store.applyRemote((s) => s.updateVenue(v.id, { groupId, createdBy: v.createdBy || cs().me.id }));
          await cloud.upsert('venues', [toRemoteVenue(store.getVenue(v.id), groupId)]);
        }
      } else if (op.type === 'tasting') {
        const t = store.getTasting(op.id);
        if (t && UUID_RE.test(t.id)) {
          if (!t.groupId || !t.userId) store.applyRemote((s) => s.updateTasting(t.id, { groupId, userId: t.userId || cs().me.id, userName: t.userName || cs().me.name }));
          const cur = store.getTasting(t.id);
          if (cur.userId === cs().me.id) await cloud.upsert('tastings', [toRemoteTasting(cur, groupId)]);
        }
      } else if (op.type === 'delete_tasting') {
        await cloud.update('tastings', `id=eq.${op.id}&user_id=eq.${cs().me.id}`, { deleted_at: new Date().toISOString() });
      } else if (op.type === 'delete_venue') {
        await cloud.update('venues', `id=eq.${op.id}`, { deleted_at: new Date().toISOString() });
      } else if (op.type === 'remove_photo') {
        await cloud.update('venue_photos', `id=eq.${op.id}`, { deleted_at: new Date().toISOString() });
      }
      store.updateCloud({ pending: cs().pending.filter((p) => p !== op && !(p.type === op.type && p.id === op.id && p.at === op.at)) });
    }
  }

  // ----- pull -----
  let changed = 0;
  async function pull() {
    const groupId = cs().group.id;
    changed = 0;
    const since = cs().lastSync;
    const filter = since ? `&updated_at=gte.${encodeURIComponent(since)}` : '';
    const [memberRows, venues, tastings, photos] = await Promise.all([
      cloud.select('members', `group_id=eq.${groupId}&select=user_id,display_name`),
      cloud.select('venues', `group_id=eq.${groupId}${filter}&order=updated_at.asc`),
      cloud.select('tastings', `group_id=eq.${groupId}${filter}&order=updated_at.asc`),
      cloud.select('venue_photos', `group_id=eq.${groupId}${filter}&order=updated_at.asc`),
    ]);
    const members = Object.fromEntries((memberRows || []).map((m) => [m.user_id, m.display_name]));
    const pendingIds = new Set(cs().pending.map((p) => p.id));
    let newest = since;
    const bump = (r) => { if (r.updated_at && (!newest || r.updated_at > newest)) newest = r.updated_at; };

    const tap = store.subscribe(() => { changed++; });
    try { store.applyRemote((s) => {
      for (const r of venues || []) {
        bump(r);
        if (pendingIds.has(r.id)) continue;
        if (r.deleted_at) { if (s.getVenue(r.id)) s.deleteVenue(r.id); continue; }
        const local = s.getVenue(r.id);
        if (local) s.updateVenue(r.id, fromRemoteVenue(r, local)); else s.addVenue(fromRemoteVenue(r));
      }
      for (const r of tastings || []) {
        bump(r);
        if (pendingIds.has(r.id)) continue;
        if (r.deleted_at) { if (s.getTasting(r.id)) s.deleteTasting(r.id); continue; }
        if (!s.getVenue(r.venue_id)) continue;
        const local = s.getTasting(r.id);
        if (local) s.updateTasting(r.id, fromRemoteTasting(r, local, members)); else s.addTasting(fromRemoteTasting(r, null, members));
      }
      for (const r of photos || []) {
        bump(r);
        const v = s.getVenue(r.venue_id);
        if (!v) continue;
        const has = v.photos.includes(r.url);
        if (r.deleted_at && has) s.updateVenue(v.id, { photos: v.photos.filter((p) => p !== r.url) });
        if (!r.deleted_at && !has) s.updateVenue(v.id, { photos: [...v.photos, r.url], photoIds: { ...v.photoIds, [r.url]: r.id } });
      }
      // keep rater names fresh
      for (const t of s.state.tastings) {
        if (t.userId && members[t.userId] && members[t.userId] !== t.userName) s.updateTasting(t.id, { userName: members[t.userId] });
      }
    }); } finally { tap(); }
    store.updateCloud({ members, lastSync: newest });
    return changed;
  }

  async function sync() {
    if (!inGroup()) { refreshStatus(); return false; }
    if (running) return running;
    if (!isOnline()) { setStatus(SYNC_STATUS.offline); return false; }
    setStatus(SYNC_STATUS.syncing);
    running = (async () => {
      try {
        await push();
        const n = await pull();
        refreshStatus();
        return { ok: true, changed: n };
      } catch (e) {
        setStatus(SYNC_STATUS.error, e.message || String(e));
        return { ok: false, changed: 0, error: e.message };
      } finally { running = null; }
    })();
    return running;
  }

  // ----- groups -----
  function adoptLocalData() {
    // Everything on this device becomes part of the group and is queued for upload.
    const me = cs().me;
    const groupId = cs().group.id;
    const pending = [];
    store.applyRemote((s) => {
      for (const v of s.state.venues) {
        if (!UUID_RE.test(v.id)) continue;
        s.updateVenue(v.id, { groupId, createdBy: v.createdBy || me.id });
        pending.push({ type: 'venue', id: v.id, at: new Date().toISOString() });
      }
      for (const t of s.state.tastings) {
        if (!UUID_RE.test(t.id) || !UUID_RE.test(t.venueId)) continue;
        if (t.userId && t.userId !== me.id) continue;
        s.updateTasting(t.id, { groupId, userId: me.id, userName: me.name });
        pending.push({ type: 'tasting', id: t.id, at: new Date().toISOString() });
      }
    });
    store.updateCloud({ pending: [...cs().pending, ...pending], lastSync: null });
  }

  async function createGroup(name, displayName) {
    const g = await cloud.rpc('create_group', { p_name: name, p_display_name: displayName });
    store.updateCloud({ group: { id: g.id, name: g.name, code: g.join_code }, me: { id: cloud.userId(), name: displayName } });
    adoptLocalData();
    await sync();
    return cs().group;
  }

  async function joinGroup(code, displayName) {
    const g = await cloud.rpc('join_group', { p_code: code, p_display_name: displayName });
    store.updateCloud({ group: { id: g.id, name: g.name, code: g.join_code }, me: { id: cloud.userId(), name: displayName } });
    adoptLocalData();
    await sync();
    return cs().group;
  }

  async function setDisplayName(name) {
    const me = cs().me;
    await cloud.update('members', `group_id=eq.${cs().group.id}&user_id=eq.${me.id}`, { display_name: name });
    store.updateCloud({ me: { ...me, name }, members: { ...cs().members, [me.id]: name } });
    store.applyRemote((s) => { for (const t of s.state.tastings) if (t.userId === me.id) s.updateTasting(t.id, { userName: name }); });
  }

  function leaveGroup() {
    // Keep this device's own copy; just stop syncing.
    store.updateCloud({ group: null, members: {}, pending: [], lastSync: null });
    refreshStatus();
  }

  function removeVenuePhoto(venueId, url) {
    const v = store.getVenue(venueId);
    if (!v) return;
    const pid = v.photoIds?.[url];
    store.updateVenue(venueId, { photos: v.photos.filter((p) => p !== url) });
    if (pid && inGroup()) enqueue({ type: 'remove_photo', id: pid });
  }

  if (typeof addEventListener === 'function') {
    addEventListener('online', () => { refreshStatus(); schedule(200); });
    addEventListener('offline', refreshStatus);
  }
  refreshStatus();

  return { sync, enqueue, createGroup, joinGroup, leaveGroup, setDisplayName, removeVenuePhoto, inGroup, status: () => status, lastError: () => lastError, me: () => cs().me, group: () => cs().group, members: () => cs().members };
}
