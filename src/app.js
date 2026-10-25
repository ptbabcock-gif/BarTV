import { createStore, todayISO, MAX_VENUE_PHOTOS } from './store.js';
import { CRITERIA, LEVEL_LABELS, overallScore, grade, aggregate, rankVenues, valueRatio, scoreHistogram } from './scoring.js';
import { INGREDIENT_CATEGORIES, EXTRAS_SUGGESTIONS, normalizeIngredients, ingredientList, insightsByCategory, previouslyUsed } from './ingredients.js';
import { formatDistance, nearest, geocode, currentPosition } from './geo.js';
import { createMap } from './map.js';
import { esc, fmtMoney, fmtDate, fmtScore, toast, download, downscaleImage, readFileText, qs, qsa } from './ui.js';
import { sampleState } from './sample-data.js';
import { CLOUD } from './config.js';
import { createCloud } from './cloud.js';
import { createSync, SYNC_STATUS } from './sync.js';
import { fetchNearbyPlaces, sortByDistance, matchVenue, PLACE_KINDS } from './places.js';

const store = createStore(localStorage);
const cloud = createCloud({
  url: CLOUD.url, anonKey: CLOUD.anonKey,
  getSession: () => store.state.cloud.session,
  setSession: (session) => store.updateCloud({ session }),
});
const sync = createSync({ store, cloud, onStatus: drawSyncChip });
let lastAutoSync = 0;
const view = qs('#view');
const titleEl = qs('#page-title');
let cleanup = null;           // teardown for the current view
let lastPosition = null;      // last device location {lat,lng}
let mapMemory = null;         // remembered map viewport

// ---------- theme ----------
function applyTheme() {
  const t = store.state.settings.theme;
  if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t;
  else delete document.documentElement.dataset.theme;
}
applyTheme();
store.subscribe(applyTheme);

// ---------- routing ----------
const routes = [
  [/^#\/venues$/, renderVenues],
  [/^#\/venue\/([^/]+)\/edit$/, renderVenueEdit],
  [/^#\/venue\/([^/]+)$/, renderVenue],
  [/^#\/rate(?:\?(.*))?$/, (query) => renderRate({ query })],
  [/^#\/tasting\/([^/]+)$/, (id) => renderRate({ tastingId: id })],
  [/^#\/map$/, renderMap],
  [/^#\/history$/, renderHistory],
  [/^#\/stats$/, renderStats],
  [/^#\/settings$/, renderSettings],
  [/^#\/join\/([A-Za-z0-9]+)$/, renderJoin],
];

function drawSyncChip(status, err) {
  const chip = qs('#sync-chip');
  if (!chip) return;
  const labels = { syncing: 'Syncing', synced: 'Synced', pending: 'Pending', offline: 'Offline', error: 'Sync error' };
  chip.hidden = status === SYNC_STATUS.solo;
  chip.dataset.status = status;
  chip.textContent = labels[status] || '';
  const group = store.state.cloud.group;
  chip.title = err || (group ? `Group: ${group.name}` : '');
}

/** Pull group changes in the background, re-rendering list views if anything changed. */
function autoSync(force = false) {
  if (!sync.inGroup()) return;
  if (!force && Date.now() - lastAutoSync < 30_000) return;
  lastAutoSync = Date.now();
  const hashBefore = location.hash;
  sync.sync().then((res) => {
    if (!res || !res.changed || location.hash !== hashBefore) return;
    if (/^#\/(rate|tasting\/|venue\/[^/]+\/edit|join)/.test(hashBefore)) return; // never clobber a form
    const y = window.scrollY;
    router({ keepScroll: true });
    window.scrollTo(0, y);
  });
}

function router(opts = {}) {
  cleanup?.();
  cleanup = null;
  view.classList.remove('is-map');
  const hash = location.hash || '#/venues';
  if (!opts.keepScroll) autoSync();
  for (const [re, fn] of routes) {
    const m = hash.match(re);
    if (m) {
      fn(...m.slice(1));
      if (opts.keepScroll) return;
      qsa('.tabbar a').forEach((a) => a.classList.toggle('is-active', hash.startsWith(`#/${a.dataset.tab}`) || (a.dataset.tab === 'venues' && hash.startsWith('#/venue/')) || (a.dataset.tab === 'rate' && hash.startsWith('#/tasting/'))));
      window.scrollTo(0, 0);
      return;
    }
  }
  location.hash = '#/venues';
}
addEventListener('hashchange', () => router());
router();
drawSyncChip(sync.status(), sync.lastError());
addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') autoSync(); });

function setTitle(t) { titleEl.textContent = t; document.title = t === 'Venues' ? 'The Cheers' : `${t} · The Cheers`; }
function currency() { return store.state.settings.currency || '$'; }

// ---------- shared fragments ----------
function scoreBadge(score, size = '') {
  const g = grade(score);
  return `<span class="score-badge ${size} tone-${g.tone}" title="${esc(g.label)}">${fmtScore(score)}</span>`;
}

function venueCard({ venue, stats }, extra = '') {
  return `
    <a class="card is-link" href="#/venue/${esc(venue.id)}">
      <div class="row">
        ${scoreBadge(stats.avg)}
        <div class="grow">
          <div class="row between">
            <strong class="ellipsis">${esc(venue.name)}</strong>
            ${extra}
          </div>
          <div class="muted small ellipsis">${esc(venue.city || venue.address || 'No location')}</div>
          <div class="muted small">${stats.count} ${stats.count === 1 ? 'tasting' : 'tastings'}${stats.avgPrice != null ? ` · avg ${fmtMoney(stats.avgPrice, currency())}` : ''}${stats.lastVisit ? ` · ${fmtDate(stats.lastVisit, { month: 'short', day: 'numeric' })}` : ''}</div>
        </div>
      </div>
    </a>`;
}

function tastingItem(t, { showVenue = false } = {}) {
  const s = overallScore(t.scores);
  const venue = store.getVenue(t.venueId);
  const ing = ingredientList(t.ingredients);
  return `
    <a class="card is-link tasting" href="#/tasting/${esc(t.id)}">
      ${scoreBadge(s)}
      <div class="grow">
        ${showVenue ? `<strong>${esc(venue?.name || 'Unknown venue')}</strong>` : `<strong>${esc(fmtDate(t.date))}</strong>`}${t.userName && sync.inGroup() ? ` <span class="chip who">${esc(t.userName)}</span>` : ''}
        <div class="meta">${showVenue ? esc(fmtDate(t.date)) : ''}${t.price != null ? `${showVenue ? ' · ' : ''}${fmtMoney(t.price, currency())}` : ''}${t.wouldOrderAgain === true ? ' · would order again' : t.wouldOrderAgain === false ? ' · would not order again' : ''}</div>
        ${ing.length ? `<div class="chips" style="margin-top:6px">${ing.slice(0, 5).map((i) => `<span class="chip">${esc(i)}</span>`).join('')}${ing.length > 5 ? `<span class="chip">+${ing.length - 5}</span>` : ''}</div>` : ''}
        ${t.notes ? `<p class="small" style="margin:6px 0 0">${esc(t.notes)}</p>` : ''}
      </div>
      ${t.photo ? `<img class="thumb" src="${t.photo}" alt="">` : ''}
    </a>`;
}

function emptyState(icon, title, body, cta = '') {
  return `<div class="empty"><div class="big">${icon}</div><h2 style="margin-top:0">${esc(title)}</h2><p>${esc(body)}</p>${cta}</div>`;
}

// ---------- Venues ----------
function renderVenues() {
  setTitle('Venues');
  const { venues, tastings } = store.state;
  if (venues.length === 0) {
    view.innerHTML = emptyState('🍸', 'No espresso martinis yet', 'Rate your first one and it will show up here, ranked.',
      `<p><a class="btn primary" href="#/rate">Rate a martini</a></p><p><a class="btn ghost" href="#/settings">Or load sample data</a></p>`);
    return;
  }
  let sort = sessionStorage.getItem('crema.sort') || 'score';
  let q = '';
  view.innerHTML = `
    <div class="row" style="margin-bottom:12px">
      <input class="input grow" id="q" type="search" placeholder="Search venues or cities" aria-label="Search venues">
      <select class="input" id="sort" style="width:auto" aria-label="Sort by">
        <option value="score">Top rated</option>
        <option value="visits">Most visited</option>
        <option value="recent">Recent</option>
        <option value="price">Cheapest</option>
        <option value="name">A–Z</option>
      </select>
    </div>
    <div id="list"></div>`;
  qs('#sort').value = sort;
  const list = qs('#list');
  const draw = () => {
    let rows = rankVenues(venues, tastings);
    if (q) rows = rows.filter((r) => `${r.venue.name} ${r.venue.city} ${r.venue.address}`.toLowerCase().includes(q));
    if (sort === 'visits') rows.sort((a, b) => b.stats.count - a.stats.count || (b.stats.avg ?? -1) - (a.stats.avg ?? -1));
    if (sort === 'recent') rows.sort((a, b) => String(b.stats.lastVisit).localeCompare(String(a.stats.lastVisit)));
    if (sort === 'price') rows.sort((a, b) => (a.stats.avgPrice ?? 1e9) - (b.stats.avgPrice ?? 1e9));
    if (sort === 'name') rows.sort((a, b) => a.venue.name.localeCompare(b.venue.name));
    list.innerHTML = rows.length
      ? rows.map((r, i) => venueCard(r, sort === 'score' && r.stats.avg != null ? `<span class="muted small">#${i + 1}</span>` : '')).join('')
      : `<p class="empty">No venues match “${esc(q)}”.</p>`;
  };
  qs('#q').addEventListener('input', (e) => { q = e.target.value.trim().toLowerCase(); draw(); });
  qs('#sort').addEventListener('change', (e) => { sort = e.target.value; sessionStorage.setItem('crema.sort', sort); draw(); });
  draw();
}

// ---------- Venue detail ----------
function renderVenue(id) {
  const venue = store.getVenue(id);
  if (!venue) { location.hash = '#/venues'; return; }
  setTitle(venue.name);
  const tastings = store.tastingsForVenue(id);
  const st = aggregate(tastings);
  const g = grade(st.avg);
  const hasLoc = venue.lat != null && venue.lng != null;
  const common = INGREDIENT_CATEGORIES.map((c) => ({ c, top: insightsByCategory(tastings, c.key, () => 0).sort((a, b) => b.count - a.count)[0] })).filter((x) => x.top);
  const photos = [
    ...venue.photos.map((src) => ({ src, caption: '', removable: true })),
    ...tastings.filter((t) => t.photo).map((t) => ({ src: t.photo, caption: `Tasting · ${fmtDate(t.date)}`, removable: false })),
  ];
  view.innerHTML = `
    <div class="card">
      <div class="row">
        ${scoreBadge(st.avg, 'lg')}
        <div class="grow">
          <div class="grade tone-${g.tone}">${esc(g.label)}</div>
          <h2 style="margin:2px 0 4px;font-size:1.3rem">${esc(venue.name)}</h2>
          <div class="muted small">${esc([venue.city, venue.address].filter(Boolean).join(' · ') || 'No address')}</div>
        </div>
      </div>
      <div class="grid-3" style="margin-top:14px">
        <div><div class="muted small">Tastings</div><strong>${st.count}</strong>${sync.inGroup() && st.count ? `<div class="muted small">by ${new Set(tastings.map((t) => t.userId || 'me')).size} ${new Set(tastings.map((t) => t.userId || 'me')).size === 1 ? 'person' : 'people'}</div>` : ''}</div>
        <div><div class="muted small">Avg price</div><strong>${st.avgPrice != null ? fmtMoney(st.avgPrice, currency()) : '–'}</strong></div>
        <div><div class="muted small">Order again</div><strong>${st.orderAgainRate != null ? st.orderAgainRate + '%' : '–'}</strong></div>
      </div>
      <div class="row wrap" style="margin-top:14px">
        <a class="btn primary grow" href="#/rate?venue=${encodeURIComponent(venue.id)}">Rate another</a>
        ${hasLoc ? `<a class="btn" target="_blank" rel="noopener" href="https://www.google.com/maps/dir/?api=1&destination=${venue.lat},${venue.lng}">Directions</a>` : ''}
        <a class="btn" href="#/venue/${esc(venue.id)}/edit">Edit</a>
      </div>
      ${venue.notes ? `<p class="small" style="margin-top:12px">${esc(venue.notes)}</p>` : ''}
    </div>

    ${st.count ? `<h2>Breakdown</h2><div class="card">
      ${CRITERIA.map((c) => `<div class="bar-row"><span>${esc(c.label)}</span><div class="bar"><i style="width:${((st.byCriterion[c.key] ?? 0) / 5) * 100}%"></i></div><b>${st.byCriterion[c.key] != null ? st.byCriterion[c.key].toFixed(1) : '–'}</b></div>`).join('')}
    </div>` : ''}

    ${common.length ? `<h2>How they make it <small>· most common</small></h2><div class="card chips">
      ${common.map(({ c, top }) => `<span class="chip" title="${esc(c.label)}">${esc(top.name)}${top.count > 1 ? ` ×${top.count}` : ''}</span>`).join('')}
    </div>` : ''}

    <h2>Photos <small>· ${photos.length}</small></h2>
    <div class="card">
      ${photos.length ? `<div class="gallery">${photos.map((p, i) => `<button type="button" class="gallery-item" data-photo="${i}" aria-label="Open photo ${i + 1}"><img src="${p.src}" alt="" loading="lazy">${p.caption ? `<span class="gallery-cap">${esc(p.caption)}</span>` : ''}</button>`).join('')}</div>` : '<p class="muted small" style="margin:0 0 10px">No photos yet. Add the bar, the glass, the menu.</p>'}
      <label class="btn block" id="add-photos-btn">Add photos <input type="file" id="venue-photos" accept="image/*" multiple hidden></label>
    </div>

    <h2>Tastings</h2>
    <div class="stack">${tastings.length ? tastings.map((t) => tastingItem(t)).join('') : '<p class="muted">Nothing logged here yet.</p>'}</div>`;

  qs('#venue-photos').addEventListener('change', async (e) => {
    const files = [...(e.target.files || [])];
    if (!files.length) return;
    const room = MAX_VENUE_PHOTOS - venue.photos.length;
    if (room <= 0) { toast(`This venue already has ${MAX_VENUE_PHOTOS} photos. Remove one first.`); return; }
    const btn = qs('#add-photos-btn'); btn.classList.add('is-busy'); btn.firstChild.textContent = 'Adding… ';
    const added = [];
    for (const file of files.slice(0, room)) {
      try { added.push(await downscaleImage(file)); } catch (err) { toast(err.message); }
    }
    try {
      store.updateVenue(id, { photos: [...venue.photos, ...added] });
      toast(added.length === 1 ? 'Photo added' : `${added.length} photos added`);
    } catch (err) {
      toast(/quota/i.test(err.message) ? 'Storage is full. Remove some photos or export and clear old data.' : err.message);
    }
    renderVenue(id);
  });
  qsa('.gallery-item').forEach((b) => b.addEventListener('click', () => openLightbox(photos, Number(b.dataset.photo), {
    onRemove: (p, idx) => {
      if (!confirm('Remove this photo from the venue?')) return false;
      if (p.src.startsWith('https://')) sync.removeVenuePhoto(id, p.src);
      else store.updateVenue(id, { photos: venue.photos.filter((_, k) => k !== idx) }); // venue photos come first, so idx maps 1:1
      toast('Photo removed');
      renderVenue(id);
      return true;
    },
  })));
}

/** Full-screen photo viewer. `photos` = [{src, caption, removable}]. */
function openLightbox(photos, index, { onRemove } = {}) {
  let i = index;
  const box = document.createElement('div');
  box.className = 'lightbox';
  box.setAttribute('role', 'dialog');
  box.setAttribute('aria-label', 'Photo viewer');
  const draw = () => {
    const p = photos[i];
    box.innerHTML = `
      <img src="${p.src}" alt="">
      <div class="lightbox-bar">
        <span class="small">${esc(p.caption || '')} <span class="muted">${i + 1}/${photos.length}</span></span>
        <span class="row">
          ${photos.length > 1 ? '<button type="button" class="btn sm" data-act="prev" aria-label="Previous">‹</button><button type="button" class="btn sm" data-act="next" aria-label="Next">›</button>' : ''}
          ${p.removable && onRemove ? '<button type="button" class="btn sm danger" data-act="remove">Remove</button>' : ''}
          <button type="button" class="btn sm" data-act="close">Close</button>
        </span>
      </div>`;
  };
  const close = () => { box.remove(); document.removeEventListener('keydown', onKey); };
  const onKey = (e) => { if (e.key === 'Escape') close(); if (e.key === 'ArrowRight') { i = (i + 1) % photos.length; draw(); } if (e.key === 'ArrowLeft') { i = (i - 1 + photos.length) % photos.length; draw(); } };
  box.addEventListener('click', (e) => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'close' || (!act && e.target === box)) return close();
    if (act === 'prev') { i = (i - 1 + photos.length) % photos.length; draw(); }
    if (act === 'next') { i = (i + 1) % photos.length; draw(); }
    if (act === 'remove' && onRemove(photos[i], i)) close();
  });
  document.addEventListener('keydown', onKey);
  draw();
  document.body.appendChild(box);
}

// ---------- Location picker (shared) ----------
function mountLocationBox(root, f) {
  const draw = () => {
    const has = f.lat != null && f.lng != null;
    root.innerHTML = `
      <div class="row between">
        <div class="grow small">${has ? `📍 ${esc(f.address || `${f.lat.toFixed(5)}, ${f.lng.toFixed(5)}`)}` : '<span class="muted">No map location yet</span>'}</div>
        ${has ? '<button type="button" class="btn sm ghost" data-act="clear">Clear</button>' : ''}
      </div>
      <div class="row" style="margin-top:8px">
        <button type="button" class="btn sm" data-act="locate">Use my location</button>
        <button type="button" class="btn sm" data-act="search">Find address</button>
      </div>
      <div class="loc-results" hidden></div>`;
    root.querySelector('[data-act="clear"]')?.addEventListener('click', () => { f.lat = f.lng = null; f.address = ''; draw(); });
    root.querySelector('[data-act="locate"]').addEventListener('click', async (e) => {
      const btn = e.currentTarget; btn.disabled = true; btn.textContent = 'Locating…';
      try {
        const p = await currentPosition();
        lastPosition = p;
        f.lat = p.lat; f.lng = p.lng; f.address = f.address || '';
        toast(`Location set (±${Math.round(p.accuracy || 0)} m)`);
        draw();
      } catch (err) { toast(err.message); btn.disabled = false; btn.textContent = 'Use my location'; }
    });
    root.querySelector('[data-act="search"]').addEventListener('click', () => {
      const box = root.querySelector('.loc-results');
      box.hidden = false;
      box.innerHTML = `<div class="row"><input class="input grow" id="geo-q" placeholder="Bar name, street, city" value="${esc([f.name, f.city].filter(Boolean).join(' '))}"><button type="button" class="btn sm primary" id="geo-go">Search</button></div><div id="geo-out"></div>`;
      const run = async () => {
        const out = qs('#geo-out', box);
        out.innerHTML = '<p class="muted small" style="margin-top:8px">Searching…</p>';
        try {
          const results = await geocode(qs('#geo-q', box).value);
          out.innerHTML = results.length
            ? results.map((r, i) => `<button type="button" data-i="${i}"><strong>${esc(r.name)}</strong><div class="muted small">${esc(r.address)}</div></button>`).join('')
            : '<p class="muted small" style="margin-top:8px">No matches. Try adding the city.</p>';
          qsa('button[data-i]', out).forEach((b) => b.addEventListener('click', () => {
            const r = results[Number(b.dataset.i)];
            f.lat = r.lat; f.lng = r.lng; f.address = r.address;
            if (!f.city && r.city) { f.city = r.city; const ci = qs('#f-city'); if (ci) ci.value = r.city; }
            if (!f.name && r.name) { f.name = r.name; const ni = qs('#f-name'); if (ni) ni.value = r.name; }
            draw();
          }));
        } catch (err) { out.innerHTML = `<p class="small" style="margin-top:8px;color:var(--red)">${esc(err.message)}. Place search needs an internet connection.</p>`; }
      };
      qs('#geo-go', box).addEventListener('click', run);
      qs('#geo-q', box).addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); run(); } });
      qs('#geo-q', box).focus();
    });
  };
  draw();
}

// ---------- Rate (create / edit) ----------
function renderRate({ query, tastingId } = {}) {
  const params = new URLSearchParams(query || '');
  const editing = tastingId ? store.getTasting(tastingId) : null;
  if (tastingId && !editing) { location.hash = '#/rate'; return; }
  const presetVenue = editing ? store.getVenue(editing.venueId) : store.getVenue(params.get('venue') || '');
  const place = !editing && !presetVenue && params.get('name') ? { name: params.get('name'), city: params.get('city') || '', address: params.get('address') || '', lat: Number(params.get('lat')), lng: Number(params.get('lng')) } : null;
  if (editing && sync.inGroup() && editing.userId && editing.userId !== sync.me()?.id) return renderTastingReadOnly(editing, presetVenue);
  setTitle(editing ? 'Edit tasting' : 'Rate a martini');

  const f = {
    venueId: presetVenue?.id || null,
    name: presetVenue?.name || place?.name || '',
    city: presetVenue?.city || place?.city || '',
    address: presetVenue?.address || place?.address || '',
    lat: presetVenue?.lat ?? (Number.isFinite(place?.lat) ? place.lat : null),
    lng: presetVenue?.lng ?? (Number.isFinite(place?.lng) ? place.lng : null),
    date: editing?.date || todayISO(),
    price: editing?.price ?? '',
    scores: { ...(editing?.scores || {}) },
    ingredients: normalizeIngredients(editing?.ingredients),
    notes: editing?.notes || '',
    wouldOrderAgain: editing?.wouldOrderAgain ?? null,
    photo: editing?.photo || null,
  };
  const allTastings = store.state.tastings;

  view.innerHTML = `
    <form id="rate" novalidate>
      <h2 style="margin-top:0">Where</h2>
      <div class="card">
        <label class="field"><span>Venue</span>
          <input class="input" id="f-name" list="venue-list" placeholder="Bar or restaurant name" value="${esc(f.name)}" autocomplete="off" required ${editing ? 'readonly' : ''}>
          <datalist id="venue-list">${store.state.venues.map((v) => `<option value="${esc(v.name)}">${esc(v.city)}</option>`).join('')}</datalist>
        </label>
        <div id="venue-hint" class="small muted" style="margin:-8px 0 10px"></div>
        <label class="field"><span>City / area</span><input class="input" id="f-city" placeholder="e.g. Soho, London" value="${esc(f.city)}" ${editing ? 'readonly' : ''}></label>
        <div class="field"><span>Map location</span><div class="loc-box" id="loc"></div></div>
      </div>

      <h2>When &amp; how much</h2>
      <div class="card grid-2">
        <label class="field" style="margin:0"><span>Date</span><input class="input" id="f-date" type="date" value="${esc(f.date)}" max="${todayISO()}"></label>
        <label class="field" style="margin:0"><span>Price (${esc(currency())})</span><input class="input" id="f-price" type="number" inputmode="decimal" min="0" step="0.5" placeholder="0.00" value="${esc(f.price)}"></label>
      </div>

      <h2>Rating</h2>
      <div class="card" id="criteria">
        ${CRITERIA.map((c) => `
          <div class="criterion" data-key="${c.key}">
            <div class="row between"><strong>${esc(c.label)}</strong><span class="muted small">${Math.round(c.weight * 100)}% of score</span></div>
            <div class="hint">${esc(c.hint)}</div>
            <div class="seg" role="radiogroup" aria-label="${esc(c.label)}">
              ${[1, 2, 3, 4, 5].map((n) => `<button type="button" role="radio" aria-checked="${f.scores[c.key] === n}" class="${f.scores[c.key] === n ? 'is-on' : ''}" data-n="${n}">${n}</button>`).join('')}
            </div>
            <div class="seg-label">${f.scores[c.key] ? esc(LEVEL_LABELS[f.scores[c.key] - 1]) : ''}</div>
          </div>`).join('')}
      </div>
      <div class="live-score" id="live"></div>

      <h2>Ingredients <small>· what's in the glass</small></h2>
      <div class="card" id="ingredients">
        ${INGREDIENT_CATEGORIES.map((c) => {
          const options = [...new Set([...previouslyUsed(allTastings, c.key), ...c.suggestions])];
          return `
            <div class="field" data-cat="${c.key}">
              <span>${esc(c.label)}</span>
              <input class="input" list="ing-${c.key}" data-ing="${c.key}" value="${esc(f.ingredients[c.key])}" placeholder="Unknown" autocomplete="off">
              <datalist id="ing-${c.key}">${options.map((o) => `<option value="${esc(o)}">`).join('')}</datalist>
              <div class="chips" style="margin-top:6px">${options.slice(0, 6).map((o) => `<button type="button" class="chip ${f.ingredients[c.key].toLowerCase() === o.toLowerCase() ? 'is-on' : ''}" data-pick="${esc(o)}">${esc(o)}</button>`).join('')}</div>
            </div>`;
        }).join('')}
        <div class="field"><span>Extras</span>
          <div class="chips" id="extras"></div>
          <div class="row" style="margin-top:8px">
            <input class="input grow" id="extra-in" list="extra-list" placeholder="Add an extra (e.g. oat milk)" autocomplete="off">
            <datalist id="extra-list">${EXTRAS_SUGGESTIONS.map((o) => `<option value="${esc(o)}">`).join('')}</datalist>
            <button type="button" class="btn sm" id="extra-add">Add</button>
          </div>
        </div>
      </div>

      <h2>Notes</h2>
      <div class="card">
        <label class="field"><span>Tasting notes</span><textarea class="input" id="f-notes" placeholder="Foam, sweetness, how the coffee tasted…">${esc(f.notes)}</textarea></label>
        <div class="field"><span>Would you order it again?</span>
          <div class="toggle" id="again">
            <button type="button" data-v="true" class="${f.wouldOrderAgain === true ? 'is-on' : ''}">Yes</button>
            <button type="button" data-v="false" class="${f.wouldOrderAgain === false ? 'is-on' : ''}">No</button>
          </div>
        </div>
        <div class="field" style="margin:0"><span>Photo</span>
          <div class="row"><input type="file" id="f-photo" accept="image/*" class="grow small"><button type="button" class="btn sm" id="photo-clear" ${f.photo ? '' : 'hidden'}>Remove</button></div>
          <img id="photo-preview" class="photo-preview" alt="" ${f.photo ? `src="${f.photo}"` : 'hidden'}>
        </div>
      </div>

      <div class="stack" style="margin-top:20px">
        <button class="btn primary block" type="submit" id="save">${editing ? 'Save changes' : 'Save rating'}</button>
        ${editing ? `<button class="btn danger block" type="button" id="delete">Delete tasting</button>` : ''}
        <p id="form-error" class="small" style="color:var(--red);text-align:center"></p>
      </div>
    </form>`;

  // --- venue matching ---
  const nameIn = qs('#f-name'), cityIn = qs('#f-city'), hint = qs('#venue-hint');
  const matchVenue = () => {
    if (editing) return;
    f.name = nameIn.value; f.city = cityIn.value;
    const v = store.findVenueByName(f.name, f.city) || (f.name.trim() && store.state.venues.filter((x) => x.name.toLowerCase() === f.name.trim().toLowerCase()).length === 1 ? store.findVenueByName(f.name) : null);
    if (v && v.id !== f.venueId) {
      f.venueId = v.id; f.city = v.city; f.address = v.address; f.lat = v.lat; f.lng = v.lng;
      cityIn.value = v.city;
      mountLocationBox(qs('#loc'), f);
    } else if (!v) {
      f.venueId = null;
    }
    hint.textContent = f.venueId ? `Known venue · ${store.tastingsForVenue(f.venueId).length} previous tasting(s)` : (f.name.trim() ? 'New venue — it will be created when you save' : '');
  };
  nameIn.addEventListener('input', matchVenue);
  nameIn.addEventListener('change', matchVenue);
  cityIn.addEventListener('input', matchVenue);
  mountLocationBox(qs('#loc'), f);
  matchVenue();

  // --- scores ---
  const live = qs('#live');
  const drawLive = () => {
    const s = overallScore(f.scores);
    const g = grade(s);
    const done = CRITERIA.filter((c) => f.scores[c.key]).length;
    live.innerHTML = `${scoreBadge(s)}<div class="grow"><div class="grade tone-${g.tone}">${esc(g.label)}</div><div class="small muted">${done}/${CRITERIA.length} criteria rated${done && done < CRITERIA.length ? ' · partial score' : ''}</div></div>`;
  };
  qs('#criteria').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-n]'); if (!b) return;
    const box = b.closest('.criterion'); const key = box.dataset.key; const n = Number(b.dataset.n);
    f.scores[key] = f.scores[key] === n ? undefined : n;
    qsa('button', box).forEach((x) => { const on = Number(x.dataset.n) === f.scores[key]; x.classList.toggle('is-on', on); x.setAttribute('aria-checked', on); });
    qs('.seg-label', box).textContent = f.scores[key] ? LEVEL_LABELS[f.scores[key] - 1] : '';
    drawLive();
  });
  drawLive();

  // --- ingredients ---
  const ingRoot = qs('#ingredients');
  ingRoot.addEventListener('input', (e) => {
    const inp = e.target.closest('input[data-ing]'); if (!inp) return;
    f.ingredients[inp.dataset.ing] = inp.value;
    qsa('.chip', inp.closest('.field')).forEach((ch) => ch.classList.toggle('is-on', ch.dataset.pick.toLowerCase() === inp.value.trim().toLowerCase()));
  });
  ingRoot.addEventListener('click', (e) => {
    const ch = e.target.closest('button[data-pick]'); if (!ch) return;
    const field = ch.closest('.field'); const inp = qs('input[data-ing]', field);
    const same = inp.value.trim().toLowerCase() === ch.dataset.pick.toLowerCase();
    inp.value = same ? '' : ch.dataset.pick;
    inp.dispatchEvent(new Event('input', { bubbles: true }));
  });
  const extrasEl = qs('#extras');
  const drawExtras = () => {
    extrasEl.innerHTML = f.ingredients.extras.length
      ? f.ingredients.extras.map((x, i) => `<button type="button" class="chip is-on" data-rm="${i}" aria-label="Remove ${esc(x)}">${esc(x)} <span class="x">×</span></button>`).join('')
      : '<span class="muted small">None</span>';
  };
  extrasEl.addEventListener('click', (e) => { const b = e.target.closest('[data-rm]'); if (!b) return; f.ingredients.extras.splice(Number(b.dataset.rm), 1); drawExtras(); });
  const addExtra = () => {
    const inp = qs('#extra-in'); const v = inp.value.trim();
    if (!v) return;
    if (!f.ingredients.extras.some((x) => x.toLowerCase() === v.toLowerCase())) f.ingredients.extras.push(v);
    inp.value = ''; drawExtras();
  };
  qs('#extra-add').addEventListener('click', addExtra);
  qs('#extra-in').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); addExtra(); } });
  drawExtras();

  // --- notes / again / photo ---
  qs('#again').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-v]'); if (!b) return;
    const v = b.dataset.v === 'true';
    f.wouldOrderAgain = f.wouldOrderAgain === v ? null : v;
    qsa('button', qs('#again')).forEach((x) => x.classList.toggle('is-on', (x.dataset.v === 'true') === f.wouldOrderAgain));
  });
  qs('#f-photo').addEventListener('change', async (e) => {
    const file = e.target.files?.[0]; if (!file) return;
    try {
      f.photo = await downscaleImage(file);
      const img = qs('#photo-preview'); img.src = f.photo; img.hidden = false; qs('#photo-clear').hidden = false;
    } catch (err) { toast(err.message); }
  });
  qs('#photo-clear').addEventListener('click', () => { f.photo = null; qs('#photo-preview').hidden = true; qs('#photo-clear').hidden = true; qs('#f-photo').value = ''; });

  // --- save / delete ---
  qs('#rate').addEventListener('submit', (e) => {
    e.preventDefault();
    const err = qs('#form-error');
    f.name = nameIn.value.trim(); f.city = cityIn.value.trim();
    f.date = qs('#f-date').value; f.price = qs('#f-price').value; f.notes = qs('#f-notes').value;
    if (!f.name) { err.textContent = 'Give the venue a name.'; nameIn.focus(); return; }
    if (overallScore(f.scores) == null) { err.textContent = 'Rate at least one criterion.'; qs('#criteria').scrollIntoView({ behavior: 'smooth' }); return; }
    try {
      let venue = f.venueId ? store.getVenue(f.venueId) : null;
      if (venue) {
        const patch = {};
        if (!editing && f.city && !venue.city) patch.city = f.city;
        if (f.lat != null && f.lng != null && (venue.lat !== f.lat || venue.lng !== f.lng)) { patch.lat = f.lat; patch.lng = f.lng; }
        if (f.address && f.address !== venue.address) patch.address = f.address;
        if (Object.keys(patch).length) venue = store.updateVenue(venue.id, patch);
      } else {
        venue = store.findOrCreateVenue({ name: f.name, city: f.city, address: f.address, lat: f.lat, lng: f.lng });
      }
      const data = { venueId: venue.id, date: f.date, price: f.price === '' ? null : f.price, scores: f.scores, ingredients: f.ingredients, notes: f.notes, wouldOrderAgain: f.wouldOrderAgain, photo: f.photo };
      if (sync.inGroup()) { data.groupId = sync.group().id; data.userId = editing?.userId || sync.me().id; data.userName = editing?.userName || sync.me().name; }
      if (editing) store.updateTasting(editing.id, data); else store.addTasting(data);
      toast(editing ? 'Tasting updated' : `Saved · ${fmtScore(overallScore(f.scores))} / 10`);
      location.hash = `#/venue/${venue.id}`;
    } catch (ex) {
      err.textContent = /quota/i.test(ex.message) ? 'Storage is full. Remove the photo or export and clear old data.' : ex.message;
    }
  });
  qs('#delete')?.addEventListener('click', () => {
    if (!confirm('Delete this tasting? This cannot be undone.')) return;
    const venueId = editing.venueId;
    store.deleteTasting(editing.id);
    toast('Tasting deleted');
    location.hash = `#/venue/${venueId}`;
  });
}

function renderTastingReadOnly(t, venue) {
  setTitle(venue?.name || 'Tasting');
  const s = overallScore(t.scores);
  const g = grade(s);
  const ing = ingredientList(t.ingredients);
  view.innerHTML = `
    <div class="card">
      <div class="row">${scoreBadge(s, 'lg')}<div class="grow"><div class="grade tone-${g.tone}">${esc(g.label)}</div><h2 style="margin:2px 0 4px;font-size:1.2rem">${esc(venue?.name || '')}</h2><div class="muted small">Rated by ${esc(t.userName || 'a group member')} · ${esc(fmtDate(t.date))}${t.price != null ? ` · ${fmtMoney(t.price, currency())}` : ''}</div></div></div>
      ${t.photo ? `<img class="photo-preview" src="${t.photo}" alt="">` : ''}
    </div>
    <h2>Breakdown</h2>
    <div class="card">${CRITERIA.map((c) => `<div class="bar-row"><span>${esc(c.label)}</span><div class="bar"><i style="width:${((t.scores[c.key] ?? 0) / 5) * 100}%"></i></div><b>${t.scores[c.key] ?? '–'}</b></div>`).join('')}</div>
    ${ing.length ? `<h2>Ingredients</h2><div class="card chips">${ing.map((i) => `<span class="chip">${esc(i)}</span>`).join('')}</div>` : ''}
    ${t.notes ? `<h2>Notes</h2><div class="card small">${esc(t.notes)}</div>` : ''}
    <p class="muted small" style="text-align:center;margin-top:16px">Only ${esc(t.userName || 'the person who rated it')} can edit this tasting.</p>
    <p style="text-align:center"><a class="btn" href="#/venue/${esc(t.venueId)}">Back to venue</a></p>`;
}

// ---------- Venue edit ----------
function renderVenueEdit(id) {
  const venue = store.getVenue(id);
  if (!venue) { location.hash = '#/venues'; return; }
  setTitle('Edit venue');
  const f = { ...venue };
  view.innerHTML = `
    <form id="vform" class="card" novalidate>
      <label class="field"><span>Name</span><input class="input" id="f-name" value="${esc(f.name)}" required></label>
      <label class="field"><span>City / area</span><input class="input" id="f-city" value="${esc(f.city)}"></label>
      <label class="field"><span>Address</span><input class="input" id="f-address" value="${esc(f.address)}"></label>
      <div class="field"><span>Map location</span><div class="loc-box" id="loc"></div></div>
      <label class="field"><span>Venue notes</span><textarea class="input" id="f-notes" placeholder="Happy hour, which bartender to ask for…">${esc(f.notes)}</textarea></label>
      <div class="stack">
        <button class="btn primary block" type="submit">Save venue</button>
        <a class="btn block" href="#/venue/${esc(id)}">Cancel</a>
        <button class="btn danger block" type="button" id="delete">Delete venue and its tastings</button>
      </div>
    </form>`;
  mountLocationBox(qs('#loc'), f);
  qs('#vform').addEventListener('submit', (e) => {
    e.preventDefault();
    try {
      store.updateVenue(id, { name: qs('#f-name').value, city: qs('#f-city').value, address: qs('#f-address').value || f.address, lat: f.lat, lng: f.lng, notes: qs('#f-notes').value });
      toast('Venue saved');
      location.hash = `#/venue/${id}`;
    } catch (err) { toast(err.message); }
  });
  qs('#delete').addEventListener('click', () => {
    const n = store.tastingsForVenue(id).length;
    if (!confirm(`Delete ${venue.name} and its ${n} tasting(s)? This cannot be undone.`)) return;
    store.deleteVenue(id);
    toast('Venue deleted');
    location.hash = '#/venues';
  });
}

// ---------- Map ----------
function renderMap() {
  setTitle('Map');
  view.classList.add('is-map');
  const { venues, tastings } = store.state;
  const ranked = rankVenues(venues, tastings);
  const located = ranked.filter((r) => r.venue.lat != null && r.venue.lng != null);
  const unlocated = ranked.length - located.length;

  view.innerHTML = `
    <div class="map-wrap">
      <div id="map" style="position:absolute;inset:0"></div>
      <button type="button" class="btn map-fab" id="locate" aria-label="Show my location">◎ Near me</button>
      <div class="map-sheet" id="sheet" hidden></div>
    </div>
    <div class="map-panel" id="panel">
      ${located.length === 0 ? `<p class="muted small">${venues.length ? 'None of your venues has a map location yet. Open a venue, tap Edit and use “Use my location” or “Find address”.' : 'Rate a martini and set its location to see it here.'}</p>` : ''}
      ${unlocated > 0 && located.length ? `<p class="muted small">${unlocated} venue${unlocated > 1 ? 's' : ''} without a map location — <a href="#/venues">add one from the venue page</a>.</p>` : ''}
      <div class="row" style="margin-top:4px">
        <button type="button" class="btn primary grow" id="discover">Find bars nearby</button>
        <select class="input" id="radius" style="width:auto" aria-label="Search radius"><option value="400">400 m</option><option value="800" selected>800 m</option><option value="2000">2 km</option></select>
      </div>
      <p class="muted small" id="discover-msg" style="margin:6px 0 0"></p>
      <div id="places"></div>
      <form class="row" id="jump" style="margin-top:10px">
        <input class="input grow" id="jump-q" placeholder="Jump to a city or address" aria-label="Jump to a city or address" autocomplete="off">
        <button class="btn sm" type="submit">Go</button>
      </form>
      <p class="muted small" id="jump-msg" style="margin:6px 0 0"></p>
      <div id="near"></div>
    </div>`;

  const map = createMap(qs('#map'), {
    onMarkerClick: (m) => {
      const sheet = qs('#sheet');
      sheet.hidden = false;
      const r = located.find((x) => x.venue.id === m.id);
      if (r) sheet.innerHTML = venueCard(r, '<button type="button" class="btn sm ghost" id="sheet-close" aria-label="Close">✕</button>');
      else {
        const p = foundPlaces.find((x) => x.id === m.id);
        if (!p) return;
        sheet.innerHTML = `<div class="card"><div class="row between"><div class="grow"><strong>${esc(p.name)}</strong><div class="muted small">${esc(PLACE_KINDS[p.kind].label)}${p.km != null ? ` · ${formatDistance(p.km)}` : ''}${p.address ? ` · ${esc(p.address)}` : ''}</div>${p.hours ? `<div class="muted small">Hours: ${esc(p.hours)}</div>` : ''}</div><button type="button" class="btn sm ghost" id="sheet-close" aria-label="Close">✕</button></div><div class="row" style="margin-top:10px"><a class="btn primary grow" href="${rateHref(p)}">Rate here</a><a class="btn" target="_blank" rel="noopener" href="https://www.google.com/maps/dir/?api=1&destination=${p.lat},${p.lng}">Directions</a></div></div>`;
      }
      qs('#sheet-close').addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); sheet.hidden = true; });
    },
    onMoveEnd: (v) => { mapMemory = v; },
  });
  const venueMarkers = located.map((r) => ({ id: r.venue.id, lat: r.venue.lat, lng: r.venue.lng, label: fmtScore(r.stats.avg), tone: grade(r.stats.avg).tone, title: `${r.venue.name} · ${fmtScore(r.stats.avg)}` }));
  let placeMarkers = [];
  let foundPlaces = [];
  map.setMarkers(venueMarkers);
  if (mapMemory) map.setView(mapMemory.center, mapMemory.zoom);
  else map.fit(located.map((r) => r.venue));
  if (lastPosition) { map.setUserLocation(lastPosition); drawNear(lastPosition); }

  function drawNear(pos, heading = 'Nearest to you') {
    const near = nearest(located.map((r) => r.venue), pos, 5);
    qs('#near').innerHTML = near.length ? `<h2 style="margin-top:4px">${esc(heading)}</h2><div class="stack">${near.map(({ venue, km }) => venueCard(located.find((r) => r.venue.id === venue.id), `<span class="muted small">${formatDistance(km)}</span>`)).join('')}</div>` : '';
  }
  qs('#locate').addEventListener('click', async (e) => {
    const b = e.currentTarget; b.disabled = true; b.textContent = 'Locating…';
    try {
      const p = await currentPosition();
      lastPosition = p;
      map.setUserLocation(p);
      map.setView(p, Math.max(map.getView().zoom, 13));
      drawNear(p);
    } catch (err) { toast(err.message); }
    b.disabled = false; b.textContent = '◎ Near me';
  });
  // --- discover unrated places from OpenStreetMap ---
  const rateHref = (p) => `#/rate?${new URLSearchParams({ name: p.name, city: p.city || '', address: p.address || '', lat: p.lat, lng: p.lng })}`;
  qs('#discover').addEventListener('click', async () => {
    const btn = qs('#discover'); const msg = qs('#discover-msg'); const out = qs('#places');
    const origin = lastPosition || map.getView().center;
    const radius = Number(qs('#radius').value);
    btn.disabled = true; btn.textContent = 'Searching…'; msg.textContent = '';
    try {
      const raw = await fetchNearbyPlaces({ lat: origin.lat, lng: origin.lng, radius });
      foundPlaces = sortByDistance(raw, origin).map((p) => ({ ...p, venue: matchVenue(p, located.map((r) => r.venue)) }));
      const unrated = foundPlaces.filter((p) => !p.venue);
      placeMarkers = unrated.map((p) => ({ id: p.id, lat: p.lat, lng: p.lng, label: PLACE_KINDS[p.kind].icon, tone: 'muted', cls: 'is-place', title: p.name }));
      map.setMarkers([...venueMarkers, ...placeMarkers]);
      if (!lastPosition) map.setView(origin, Math.max(map.getView().zoom, 15)); else map.setView(origin, radius <= 400 ? 16 : radius <= 800 ? 15 : 14);
      msg.textContent = foundPlaces.length
        ? `${foundPlaces.length} places within ${radius >= 1000 ? (radius / 1000) + ' km' : radius + ' m'}${lastPosition ? ' of you' : ' of the map centre'} · ${unrated.length} not rated yet`
        : 'Nothing found here. Try a wider radius or move the map.';
      out.innerHTML = foundPlaces.length ? `<div class="stack" style="margin-top:8px">${foundPlaces.slice(0, 40).map((p) => `
        <div class="card row place">
          <span class="place-ico" aria-hidden="true">${PLACE_KINDS[p.kind].icon}</span>
          <div class="grow">
            <strong class="ellipsis">${esc(p.name)}</strong>
            <div class="muted small ellipsis">${esc(PLACE_KINDS[p.kind].label)} · ${formatDistance(p.km)}${p.address ? ` · ${esc(p.address)}` : ''}</div>
          </div>
          ${p.venue ? `<a class="score-badge sm tone-${grade(aggregate(store.tastingsForVenue(p.venue.id)).avg).tone}" href="#/venue/${esc(p.venue.id)}" title="Rated">${fmtScore(aggregate(store.tastingsForVenue(p.venue.id)).avg)}</a>` : `<a class="btn sm" href="${rateHref(p)}">Rate</a>`}
        </div>`).join('')}</div>` : '';
    } catch (err) {
      msg.textContent = `${err.message}. Finding places needs an internet connection.`;
    }
    btn.disabled = false; btn.textContent = 'Find bars nearby';
  });

  qs('#jump').addEventListener('submit', async (e) => {
    e.preventDefault();
    const msg = qs('#jump-msg');
    msg.textContent = 'Searching…';
    try {
      const [hit] = await geocode(qs('#jump-q').value, undefined);
      if (!hit) { msg.textContent = 'No match. Try adding the country.'; return; }
      msg.textContent = hit.address;
      map.setView(hit, 13);
      drawNear(hit, 'Nearest to ' + (hit.city || hit.name));
    } catch (err) { msg.textContent = `${err.message}. Place search needs an internet connection.`; }
  });
  cleanup = () => map.destroy();
}

// ---------- History ----------
function renderHistory() {
  setTitle('History');
  const tastings = [...store.state.tastings].sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));
  if (!tastings.length) { view.innerHTML = emptyState('📓', 'No tastings yet', 'Every martini you rate will be listed here, newest first.', '<a class="btn primary" href="#/rate">Rate a martini</a>'); return; }
  const groups = new Map();
  for (const t of tastings) {
    const k = t.date.slice(0, 7);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(t);
  }
  view.innerHTML = [...groups].map(([k, list]) => {
    const [y, m] = k.split('-').map(Number);
    const label = new Date(y, m - 1, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
    return `<h2>${esc(label)} <small>· ${list.length}</small></h2><div class="stack">${list.map((t) => tastingItem(t, { showVenue: true })).join('')}</div>`;
  }).join('');
}

// ---------- Stats ----------
function renderStats() {
  setTitle('Stats');
  const { venues, tastings } = store.state;
  if (!tastings.length) { view.innerHTML = emptyState('📊', 'Nothing to chart yet', 'Stats appear after your first rating.', '<a class="btn primary" href="#/rate">Rate a martini</a>'); return; }
  const all = aggregate(tastings);
  const ranked = rankVenues(venues, tastings);
  const top = ranked[0];
  const best = all.best;
  const bestValue = tastings.map((t) => ({ t, v: valueRatio(t) })).filter((x) => x.v != null).sort((a, b) => b.v - a.v)[0];
  const hist = scoreHistogram(tastings);
  const maxH = Math.max(1, ...hist);
  const scoreOf = (t) => overallScore(t.scores);
  const insights = INGREDIENT_CATEGORIES.map((c) => ({ c, rows: insightsByCategory(tastings, c.key, scoreOf) })).filter((x) => x.rows.length);
  const spent = tastings.reduce((a, t) => a + (t.price || 0), 0);

  view.innerHTML = `
    <div class="grid-4">
      <div class="kpi"><div class="v">${tastings.length}</div><div class="k">Tastings</div></div>
      <div class="kpi"><div class="v">${venues.length}</div><div class="k">Venues</div></div>
      <div class="kpi"><div class="v">${fmtScore(all.avg)}</div><div class="k">Avg score</div></div>
      <div class="kpi"><div class="v">${all.avgPrice != null ? fmtMoney(all.avgPrice, currency()) : '–'}</div><div class="k">Avg price</div></div>
    </div>

    <h2>Highlights</h2>
    <div class="stack">
      ${top ? `<a class="card is-link row" href="#/venue/${esc(top.venue.id)}">${scoreBadge(top.stats.avg)}<div class="grow"><div class="muted small">Top venue</div><strong>${esc(top.venue.name)}</strong><div class="muted small">${top.stats.count} tasting(s)</div></div></a>` : ''}
      ${best ? `<a class="card is-link row" href="#/tasting/${esc(best.id)}">${scoreBadge(scoreOf(best))}<div class="grow"><div class="muted small">Best single drink</div><strong>${esc(store.getVenue(best.venueId)?.name || '')}</strong><div class="muted small">${esc(fmtDate(best.date))}${ingredientList(best.ingredients).length ? ' · ' + esc(ingredientList(best.ingredients).slice(0, 3).join(', ')) : ''}</div></div></a>` : ''}
      ${bestValue ? `<a class="card is-link row" href="#/tasting/${esc(bestValue.t.id)}">${scoreBadge(scoreOf(bestValue.t))}<div class="grow"><div class="muted small">Best value</div><strong>${esc(store.getVenue(bestValue.t.venueId)?.name || '')}</strong><div class="muted small">${fmtMoney(bestValue.t.price, currency())} · ${bestValue.v.toFixed(2)} points per ${esc(currency())}1</div></div></a>` : ''}
      <div class="card row"><div class="grow"><div class="muted small">Would order again</div><strong>${all.orderAgainRate != null ? all.orderAgainRate + '%' : '–'}</strong></div><div class="grow"><div class="muted small">Total spent</div><strong>${fmtMoney(spent, currency())}</strong></div></div>
    </div>

    <h2>Score distribution</h2>
    <div class="card">
      <div class="hist" role="img" aria-label="Histogram of overall scores">${hist.map((n, i) => `<div style="height:${(n / maxH) * 100}%" title="${i}–${i + 1}: ${n}"></div>`).join('')}</div>
      <div class="hist-x">${hist.map((_, i) => `<span>${i}</span>`).join('')}</div>
    </div>

    <h2>Average by criterion</h2>
    <div class="card">
      ${CRITERIA.map((c) => `<div class="bar-row"><span>${esc(c.label)}</span><div class="bar"><i style="width:${((all.byCriterion[c.key] ?? 0) / 5) * 100}%"></i></div><b>${all.byCriterion[c.key] != null ? all.byCriterion[c.key].toFixed(1) : '–'}</b></div>`).join('')}
    </div>

    ${sync.inGroup() ? `<h2>Who's been drinking</h2><div class="card">${Object.entries(tastings.reduce((m, t) => { const k = t.userName || 'Unknown'; m[k] = (m[k] || 0) + 1; return m; }, {})).sort((a, b) => b[1] - a[1]).map(([name, n]) => `<div class="bar-row"><span class="ellipsis">${esc(name)}</span><div class="bar"><i style="width:${(n / tastings.length) * 100}%"></i></div><b>${n}</b></div>`).join('')}</div>` : ''}

    ${insights.length ? `<h2>Ingredient insights <small>· avg score when used</small></h2>
    <div class="stack">${insights.map(({ c, rows }) => `
      <div class="card">
        <strong class="small">${esc(c.label)}</strong>
        ${rows.slice(0, 5).map((r) => `<div class="bar-row"><span class="ellipsis" title="${esc(r.name)}">${esc(r.name)}</span><div class="bar"><i style="width:${r.avg * 10}%"></i></div><b>${r.avg.toFixed(1)}<span class="muted small"> ×${r.count}</span></b></div>`).join('')}
      </div>`).join('')}</div>` : ''}`;
}

// ---------- Groups ----------
function inviteLink(code) {
  return `${location.origin}${location.pathname}#/join/${code}`;
}

async function shareInvite(group) {
  const url = inviteLink(group.code);
  const text = `Join "${group.name}" on The Cheers and rate espresso martinis with us. Code ${group.code}: ${url}`;
  try {
    if (navigator.share) { await navigator.share({ title: 'The Cheers', text, url }); return; }
    await navigator.clipboard.writeText(url);
    toast('Invite link copied');
  } catch (e) { if (e?.name !== 'AbortError') toast(`Share it: ${url}`); }
}

function renderGroupCard(root) {
  if (!cloud.configured) {
    root.innerHTML = '<p class="small muted" style="margin:0">Groups are not set up on this copy of the app. See docs/GROUPS.md in the repository to connect a database.</p>';
    return;
  }
  const g = sync.group();
  if (!g) {
    root.innerHTML = `
      <p class="small muted">Share one leaderboard with friends. Everything already on this phone is shared with the group when you join.</p>
      <label class="field"><span>Your name</span><input class="input" id="g-name" placeholder="How you'll appear on ratings" maxlength="40" value="${esc(sync.me()?.name || '')}"></label>
      <div class="grid-2">
        <div><label class="field"><span>Start a group</span><input class="input" id="g-new" placeholder="Group name" maxlength="60"></label><button type="button" class="btn block" id="g-create">Create</button></div>
        <div><label class="field"><span>Join a group</span><input class="input" id="g-code" placeholder="6-letter code" maxlength="6" autocapitalize="characters" style="text-transform:uppercase"></label><button type="button" class="btn block primary" id="g-join">Join</button></div>
      </div>
      <p class="small" id="g-msg" style="color:var(--red);margin:8px 0 0"></p>`;
    const msg = qs('#g-msg', root);
    const name = () => qs('#g-name', root).value.trim();
    const guard = () => { if (!name()) { msg.textContent = 'Enter your name first.'; qs('#g-name', root).focus(); return false; } return true; };
    const confirmShare = () => !store.state.tastings.length || confirm(`Your ${store.state.tastings.length} existing tasting(s) and venues on this phone will be shared with the group. Continue?`);
    qs('#g-create', root).addEventListener('click', async () => {
      const gname = qs('#g-new', root).value.trim();
      if (!guard()) return; if (!gname) { msg.textContent = 'Give the group a name.'; return; }
      if (!confirmShare()) return;
      msg.textContent = '';
      try { await sync.createGroup(gname, name()); toast('Group created'); renderSettings(); } catch (e) { msg.textContent = e.message; }
    });
    qs('#g-join', root).addEventListener('click', async () => {
      const code = qs('#g-code', root).value.trim().toUpperCase();
      if (!guard()) return; if (code.length < 4) { msg.textContent = 'Enter the group code.'; return; }
      if (!confirmShare()) return;
      msg.textContent = '';
      try { await sync.joinGroup(code, name()); toast('Joined the group'); location.hash = '#/venues'; } catch (e) { msg.textContent = e.message; }
    });
    return;
  }
  const members = Object.entries(sync.members());
  const status = sync.status();
  root.innerHTML = `
    <div class="row between"><div><div class="muted small">Group</div><strong>${esc(g.name)}</strong></div><div style="text-align:right"><div class="muted small">Join code</div><strong class="code">${esc(g.code)}</strong></div></div>
    <div class="row wrap" style="margin-top:12px">
      <button type="button" class="btn primary grow" id="g-share">Share invite</button>
      <button type="button" class="btn" id="g-sync">Sync now</button>
    </div>
    <p class="small muted" style="margin:10px 0 0" id="g-status">${esc(({ syncing: 'Syncing…', synced: 'Everything is synced', pending: 'Changes waiting to upload', offline: 'Offline — changes will upload when you are back online', error: 'Sync problem: ' + sync.lastError() })[status] || '')}${store.state.cloud.lastSync ? ` · last update ${new Date(store.state.cloud.lastSync).toLocaleString()}` : ''}</p>
    <div class="field" style="margin-top:14px"><span>Members · ${members.length}</span><div class="chips">${members.map(([id, n]) => `<span class="chip ${id === sync.me().id ? 'is-on' : ''}">${esc(n)}</span>`).join('') || '<span class="muted small">Only you so far</span>'}</div></div>
    <label class="field"><span>Your name</span><div class="row"><input class="input grow" id="g-me" maxlength="40" value="${esc(sync.me().name)}"><button type="button" class="btn sm" id="g-rename">Save</button></div></label>
    <button type="button" class="btn danger block" id="g-leave">Leave group</button>
    <p class="small" id="g-msg" style="color:var(--red);margin:8px 0 0"></p>`;
  qs('#g-share', root).addEventListener('click', () => shareInvite(g));
  qs('#g-sync', root).addEventListener('click', async () => { qs('#g-status', root).textContent = 'Syncing…'; await sync.sync(); renderSettings(); });
  qs('#g-rename', root).addEventListener('click', async () => {
    const n = qs('#g-me', root).value.trim(); if (!n) return;
    try { await sync.setDisplayName(n); toast('Name updated'); renderSettings(); } catch (e) { qs('#g-msg', root).textContent = e.message; }
  });
  qs('#g-leave', root).addEventListener('click', () => {
    if (!confirm(`Leave "${g.name}"? The ratings stay on this phone and in the group; this phone just stops syncing.`)) return;
    sync.leaveGroup(); toast('Left the group'); renderSettings();
  });
}

function renderJoin(code) {
  setTitle('Join a group');
  code = code.toUpperCase();
  if (!cloud.configured) { view.innerHTML = emptyState('🔗', 'Groups are not available', 'This copy of the app is not connected to a database.'); return; }
  if (sync.group()?.code === code) { location.hash = '#/venues'; return; }
  view.innerHTML = `
    <div class="card">
      <p>You've been invited to rate espresso martinis together. Group code <strong class="code">${esc(code)}</strong>.</p>
      <label class="field"><span>Your name</span><input class="input" id="j-name" placeholder="How you'll appear on ratings" maxlength="40" value="${esc(sync.me()?.name || '')}"></label>
      <button type="button" class="btn primary block" id="j-go">Join the group</button>
      <p class="small" id="j-msg" style="color:var(--red);margin:8px 0 0"></p>
      ${store.state.tastings.length ? `<p class="small muted" style="margin-top:10px">Your ${store.state.tastings.length} existing tasting(s) on this phone will be shared with the group.</p>` : ''}
    </div>`;
  qs('#j-go').addEventListener('click', async () => {
    const name = qs('#j-name').value.trim();
    if (!name) { qs('#j-msg').textContent = 'Enter your name.'; return; }
    const btn = qs('#j-go'); btn.disabled = true; btn.textContent = 'Joining…';
    try { await sync.joinGroup(code, name); toast('Welcome to the group'); location.hash = '#/venues'; }
    catch (e) { qs('#j-msg').textContent = e.message; btn.disabled = false; btn.textContent = 'Join the group'; }
  });
}

// ---------- Settings ----------
function renderSettings() {
  setTitle('Settings');
  const s = store.state.settings;
  view.innerHTML = `
    <h2 style="margin-top:0">Appearance</h2>
    <div class="card grid-2">
      <label class="field" style="margin:0"><span>Theme</span>
        <select class="input" id="theme"><option value="auto">Match device</option><option value="light">Light</option><option value="dark">Dark</option></select></label>
      <label class="field" style="margin:0"><span>Currency symbol</span><input class="input" id="currency" maxlength="4" value="${esc(s.currency)}"></label>
    </div>

    <h2>Group <small>· rate together</small></h2>
    <div class="card" id="group-card"></div>

    <h2>Your data</h2>
    <div class="card stack">
      <p class="small muted">Everything is stored on this device only. Export a backup before switching phones.</p>
      <button type="button" class="btn block" id="export">Export backup (JSON)</button>
      <div class="row"><input type="file" id="import" accept="application/json,.json" class="grow small"></div>
      <div class="toggle"><button type="button" data-mode="merge" class="is-on">Merge on import</button><button type="button" data-mode="replace">Replace on import</button></div>
      <button type="button" class="btn block" id="sample">Load sample data</button>
      <button type="button" class="btn danger block" id="clear">Delete all data</button>
    </div>

    <h2>How scoring works</h2>
    <div class="card">
      <p class="small">Each criterion is rated 1–5. The overall score is a weighted average mapped to 0–10, so an all-3 drink scores 5.0 and an all-5 drink scores 10.</p>
      ${CRITERIA.map((c) => `<div class="bar-row"><span>${esc(c.label)}</span><div class="bar"><i style="width:${c.weight * 100 / 0.3}%"></i></div><b>${Math.round(c.weight * 100)}%</b></div>`).join('')}
      <div class="chips" style="margin-top:10px">${[['9+', 'Exceptional', 'gold'], ['7.5+', 'Excellent', 'green'], ['6+', 'Good', 'teal'], ['4.5+', 'Fine', 'amber'], ['<4.5', 'Skip', 'red']].map(([r, l, t]) => `<span class="chip tone-${t}">${r} ${l}</span>`).join('')}</div>
    </div>

    <h2>Classic recipe <small>· for reference</small></h2>
    <div class="card small">
      <p><strong>50 ml</strong> vodka · <strong>30 ml</strong> fresh espresso · <strong>20 ml</strong> coffee liqueur · <strong>10 ml</strong> sugar syrup.</p>
      <p style="margin:0">Shake hard with plenty of ice for 15–20 seconds, double-strain into a chilled coupe, garnish with three coffee beans (health, wealth, happiness).</p>
    </div>
    <p class="muted small" style="text-align:center;margin-top:20px">The Cheers · map data © OpenStreetMap contributors</p>`;

  renderGroupCard(qs('#group-card'));
  qs('#theme').value = s.theme || 'auto';
  qs('#theme').addEventListener('change', (e) => store.setSetting('theme', e.target.value));
  qs('#currency').addEventListener('change', (e) => store.setSetting('currency', e.target.value.trim() || '$'));
  qs('#export').addEventListener('click', () => download(`the-cheers-backup-${todayISO()}.json`, store.exportJSON()));
  let mode = 'merge';
  qsa('[data-mode]').forEach((b) => b.addEventListener('click', () => { mode = b.dataset.mode; qsa('[data-mode]').forEach((x) => x.classList.toggle('is-on', x === b)); }));
  qs('#import').addEventListener('change', async (e) => {
    const file = e.target.files?.[0]; if (!file) return;
    try {
      if (mode === 'replace' && !confirm('Replace all current data with this file?')) return;
      const r = store.importJSON(await readFileText(file), mode);
      toast(`Imported ${r.venues} venues and ${r.tastings} tastings`);
    } catch (err) { toast(`Import failed: ${err.message}`); }
    e.target.value = '';
  });
  qs('#sample').addEventListener('click', () => {
    const r = store.importJSON(JSON.stringify(sampleState()), 'merge');
    toast(`Added ${r.venues} sample venues`);
    location.hash = '#/venues';
  });
  qs('#clear').addEventListener('click', () => {
    if (!confirm('Delete every venue and tasting on this device? Export a backup first if you want to keep them.')) return;
    store.clear();
    toast('All data deleted');
    location.hash = '#/venues';
  });
}
