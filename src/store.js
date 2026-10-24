// Persistent app state. Works with any Storage-like object (localStorage in the
// browser, an in-memory map in tests). All mutations go through here.
import { normalizeIngredients } from './ingredients.js';

export const SCHEMA_VERSION = 1;
export const STORAGE_KEY = 'crema.state';
export const MAX_VENUE_PHOTOS = 30;

function uid() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return 'id-' + Math.random().toString(36).slice(2) + Date.now().toString(36);
}

export function todayISO(d = new Date()) {
  const tz = d.getTimezoneOffset() * 60000;
  return new Date(d.getTime() - tz).toISOString().slice(0, 10);
}

export function emptyState() {
  return { version: SCHEMA_VERSION, venues: [], tastings: [], settings: { theme: 'auto', currency: '$' } };
}

/** In-memory Storage stand-in for Node tests. */
export function memoryStorage() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => void m.set(k, String(v)),
    removeItem: (k) => void m.delete(k),
  };
}

export function normalizeCoord(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export function sanitizeVenue(v = {}) {
  const lat = normalizeCoord(v.lat);
  const lng = normalizeCoord(v.lng);
  return {
    id: v.id || uid(),
    name: String(v.name ?? '').trim(),
    city: String(v.city ?? '').trim(),
    address: String(v.address ?? '').trim(),
    lat: lat != null && lat >= -90 && lat <= 90 ? lat : null,
    lng: lng != null && lng >= -180 && lng <= 180 ? lng : null,
    notes: String(v.notes ?? '').trim(),
    photos: (Array.isArray(v.photos) ? v.photos : []).filter((p) => typeof p === 'string' && p.startsWith('data:image/')).slice(0, MAX_VENUE_PHOTOS),
    createdAt: v.createdAt || new Date().toISOString(),
  };
}

export function sanitizeTasting(t = {}) {
  const scores = {};
  for (const [k, val] of Object.entries(t.scores || {})) {
    const n = Number(val);
    if (Number.isInteger(n) && n >= 1 && n <= 5) scores[k] = n;
  }
  const price = Number(t.price);
  return {
    id: t.id || uid(),
    venueId: String(t.venueId ?? ''),
    date: /^\d{4}-\d{2}-\d{2}$/.test(String(t.date)) ? t.date : todayISO(),
    price: Number.isFinite(price) && price >= 0 ? Math.round(price * 100) / 100 : null,
    scores,
    ingredients: normalizeIngredients(t.ingredients),
    notes: String(t.notes ?? '').trim(),
    wouldOrderAgain: typeof t.wouldOrderAgain === 'boolean' ? t.wouldOrderAgain : null,
    photo: typeof t.photo === 'string' && t.photo.startsWith('data:image/') ? t.photo : null,
    createdAt: t.createdAt || new Date().toISOString(),
  };
}

/** Validate & coerce an arbitrary object into a state. Throws on garbage. */
export function sanitizeState(raw) {
  if (!raw || typeof raw !== 'object') throw new Error('Not a backup file from The Cheers');
  if (!Array.isArray(raw.venues) || !Array.isArray(raw.tastings)) throw new Error('Missing venues or tastings');
  const venues = raw.venues.map(sanitizeVenue).filter((v) => v.name);
  const ids = new Set(venues.map((v) => v.id));
  const tastings = raw.tastings.map(sanitizeTasting).filter((t) => ids.has(t.venueId));
  const base = emptyState();
  return { ...base, venues, tastings, settings: { ...base.settings, ...(raw.settings || {}) } };
}

export function createStore(storage, key = STORAGE_KEY) {
  let state;
  const listeners = new Set();

  function load() {
    try {
      const raw = storage.getItem(key);
      state = raw ? sanitizeState(JSON.parse(raw)) : emptyState();
    } catch {
      state = emptyState();
    }
    return state;
  }

  function persist() {
    storage.setItem(key, JSON.stringify(state));
    for (const fn of listeners) fn(state);
  }

  load();

  const api = {
    get state() { return state; },
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },

    // ----- venues -----
    getVenue(id) { return state.venues.find((v) => v.id === id) || null; },
    findVenueByName(name, city = '') {
      const n = name.trim().toLowerCase();
      const c = city.trim().toLowerCase();
      return state.venues.find((v) => v.name.toLowerCase() === n && (!c || v.city.toLowerCase() === c)) || null;
    },
    addVenue(data) {
      const v = sanitizeVenue(data);
      if (!v.name) throw new Error('Venue needs a name');
      state.venues.push(v);
      persist();
      return v;
    },
    updateVenue(id, patch) {
      const i = state.venues.findIndex((v) => v.id === id);
      if (i < 0) throw new Error('Venue not found');
      const v = sanitizeVenue({ ...state.venues[i], ...patch, id });
      if (!v.name) throw new Error('Venue needs a name');
      state.venues[i] = v;
      persist();
      return v;
    },
    deleteVenue(id) {
      state.venues = state.venues.filter((v) => v.id !== id);
      state.tastings = state.tastings.filter((t) => t.venueId !== id);
      persist();
    },
    /** Reuse an existing venue by name+city or create a new one. */
    findOrCreateVenue(data) {
      return api.findVenueByName(data.name || '', data.city || '') || api.addVenue(data);
    },

    // ----- tastings -----
    getTasting(id) { return state.tastings.find((t) => t.id === id) || null; },
    tastingsForVenue(venueId) {
      return state.tastings.filter((t) => t.venueId === venueId).sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));
    },
    addTasting(data) {
      const t = sanitizeTasting(data);
      if (!api.getVenue(t.venueId)) throw new Error('Tasting needs a venue');
      state.tastings.push(t);
      persist();
      return t;
    },
    updateTasting(id, patch) {
      const i = state.tastings.findIndex((t) => t.id === id);
      if (i < 0) throw new Error('Tasting not found');
      const t = sanitizeTasting({ ...state.tastings[i], ...patch, id });
      if (!api.getVenue(t.venueId)) throw new Error('Tasting needs a venue');
      state.tastings[i] = t;
      persist();
      return t;
    },
    deleteTasting(id) {
      state.tastings = state.tastings.filter((t) => t.id !== id);
      persist();
    },

    // ----- settings -----
    setSetting(k, v) { state.settings = { ...state.settings, [k]: v }; persist(); },

    // ----- bulk -----
    exportJSON() {
      return JSON.stringify({ app: 'the-cheers', exportedAt: new Date().toISOString(), ...state }, null, 2);
    },
    /** mode: 'replace' | 'merge'. Merge keeps existing records and adds unknown ids. */
    importJSON(text, mode = 'merge') {
      const incoming = sanitizeState(JSON.parse(text));
      if (mode === 'replace') {
        state = incoming;
      } else {
        const vIds = new Set(state.venues.map((v) => v.id));
        const tIds = new Set(state.tastings.map((t) => t.id));
        state.venues.push(...incoming.venues.filter((v) => !vIds.has(v.id)));
        state.tastings.push(...incoming.tastings.filter((t) => !tIds.has(t.id)));
      }
      persist();
      return { venues: incoming.venues.length, tastings: incoming.tastings.length };
    },
    replaceState(next) { state = sanitizeState(next); persist(); },
    clear() { state = emptyState(); persist(); },
    reload: load,
  };
  return api;
}
