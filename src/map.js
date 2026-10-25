// A small dependency-free slippy map: OpenStreetMap raster tiles, drag/pinch/wheel,
// markers, fit-to-bounds. Enough for "where are my favourite espresso martinis".
import { project, unproject, tilesForView, fitBounds } from './geo.js';

const TILE = 256;
export const OSM_TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';

export function createMap(container, opts = {}) {
  const o = {
    tileUrl: OSM_TILE_URL,
    center: { lat: 20, lng: 0 },
    zoom: 2,
    minZoom: 1,
    maxZoom: 18,
    onMarkerClick: null,
    onMoveEnd: null,
    tileErrorText: 'Street map tiles could not load (offline, or blocked by this viewer). Pins and distances still work.',
    attribution: '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors',
    ...opts,
  };
  let center = { ...o.center };
  let zoom = clampZoom(o.zoom);
  let markers = [];
  let userDot = null;
  const tileEls = new Map(); // "z/x/y" -> <img>

  container.classList.add('cmap');
  container.innerHTML = `
    <div class="cmap-tiles"></div>
    <div class="cmap-markers"></div>
    <div class="cmap-controls">
      <button type="button" class="cmap-btn" data-act="in" aria-label="Zoom in">+</button>
      <button type="button" class="cmap-btn" data-act="out" aria-label="Zoom out">−</button>
    </div>
    <div class="cmap-notice" hidden></div>
    <div class="cmap-attrib">${o.attribution}</div>`;
  const noticeEl = container.querySelector('.cmap-notice');
  let tileOk = 0, tileFail = 0;
  const tileStatus = () => {
    if (tileOk === 0 && tileFail >= 2) { noticeEl.textContent = o.tileErrorText; noticeEl.hidden = false; }
    else if (tileOk > 0) noticeEl.hidden = true;
  };
  const tilesEl = container.querySelector('.cmap-tiles');
  const markersEl = container.querySelector('.cmap-markers');

  function clampZoom(z) { return Math.max(o.minZoom, Math.min(o.maxZoom, Math.round(z))); }
  function size() { return { w: container.clientWidth || 320, h: container.clientHeight || 240 }; }

  function toScreen(lat, lng) {
    const { w, h } = size();
    const c = project(center.lat, center.lng, zoom);
    const p = project(lat, lng, zoom);
    return { x: p.x - c.x + w / 2, y: p.y - c.y + h / 2 };
  }
  function fromScreen(x, y) {
    const { w, h } = size();
    const c = project(center.lat, center.lng, zoom);
    return unproject(c.x + x - w / 2, c.y + y - h / 2, zoom);
  }

  function render() {
    const { w, h } = size();
    const wanted = tilesForView(center, zoom, w, h);
    const keep = new Set();
    for (const t of wanted) {
      const key = `${t.z}/${t.x}/${t.y}`;
      keep.add(key);
      let img = tileEls.get(key);
      if (!img) {
        img = document.createElement('img');
        img.className = 'cmap-tile';
        img.alt = '';
        img.draggable = false;
        img.decoding = 'async';
        img.loading = 'lazy';
        img.addEventListener('error', () => { img.classList.add('is-missing'); tileFail++; tileStatus(); }, { once: true });
        img.addEventListener('load', () => { tileOk++; tileStatus(); }, { once: true });
        img.src = o.tileUrl.replace('{z}', t.z).replace('{x}', t.x).replace('{y}', t.y);
        tileEls.set(key, img);
        tilesEl.appendChild(img);
      }
      img.style.transform = `translate(${Math.round(t.px)}px, ${Math.round(t.py)}px)`;
    }
    for (const [key, img] of tileEls) {
      if (!keep.has(key)) { img.remove(); tileEls.delete(key); }
    }
    renderMarkers();
  }

  function renderMarkers() {
    const { w, h } = size();
    markersEl.innerHTML = '';
    if (userDot) {
      const p = toScreen(userDot.lat, userDot.lng);
      const d = document.createElement('div');
      d.className = 'cmap-user';
      d.title = 'You are here';
      d.style.transform = `translate(${p.x}px, ${p.y}px)`;
      markersEl.appendChild(d);
    }
    for (const m of markers) {
      const p = toScreen(m.lat, m.lng);
      if (p.x < -60 || p.y < -60 || p.x > w + 60 || p.y > h + 60) continue;
      const el = document.createElement('button');
      el.type = 'button';
      el.className = `cmap-pin tone-${m.tone || 'muted'} ${m.cls || ''}`;
      el.style.transform = `translate(${p.x}px, ${p.y}px)`;
      el.setAttribute('aria-label', m.title || 'Venue');
      el.innerHTML = `<span class="cmap-pin-label">${m.label ?? ''}</span>`;
      el.addEventListener('click', (e) => { e.stopPropagation(); o.onMarkerClick?.(m); });
      markersEl.appendChild(el);
    }
  }

  function setView(c, z = zoom) {
    center = { lat: c.lat, lng: c.lng };
    zoom = clampZoom(z);
    render();
    o.onMoveEnd?.({ center, zoom });
  }

  /** Change zoom while keeping the geographic point under (sx, sy) fixed. */
  function zoomAround(sx, sy, newZoom) {
    const nz = clampZoom(newZoom);
    if (nz === zoom) return;
    const anchor = fromScreen(sx, sy);
    const { w, h } = size();
    const a = project(anchor.lat, anchor.lng, nz);
    center = unproject(a.x - (sx - w / 2), a.y - (sy - h / 2), nz);
    zoom = nz;
    render();
    o.onMoveEnd?.({ center, zoom });
  }

  function panBy(dx, dy) {
    const c = project(center.lat, center.lng, zoom);
    center = unproject(c.x - dx, c.y - dy, zoom);
    render();
  }

  // ----- interaction -----
  const pointers = new Map();
  let dragged = false;
  let pinchStart = null;
  let lastTap = 0;

  container.addEventListener('pointerdown', (e) => {
    if (e.target.closest('.cmap-btn, .cmap-pin, .cmap-attrib a')) return;
    container.setPointerCapture?.(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    dragged = false;
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      pinchStart = { dist: Math.hypot(a.x - b.x, a.y - b.y), zoom };
    }
  });
  container.addEventListener('pointermove', (e) => {
    if (!pointers.has(e.pointerId)) return;
    const prev = pointers.get(e.pointerId);
    const cur = { x: e.clientX, y: e.clientY };
    pointers.set(e.pointerId, cur);
    if (pointers.size === 1) {
      const dx = cur.x - prev.x, dy = cur.y - prev.y;
      if (Math.abs(dx) + Math.abs(dy) > 0) dragged = true;
      panBy(dx, dy);
    } else if (pointers.size === 2 && pinchStart) {
      const [a, b] = [...pointers.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      const target = pinchStart.zoom + Math.log2(dist / pinchStart.dist);
      const rect = container.getBoundingClientRect();
      const mid = { x: (a.x + b.x) / 2 - rect.left, y: (a.y + b.y) / 2 - rect.top };
      if (Math.abs(target - zoom) >= 0.75) zoomAround(mid.x, mid.y, target);
      dragged = true;
    }
  });
  const endPointer = (e) => {
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinchStart = null;
    if (pointers.size === 0) {
      if (dragged) o.onMoveEnd?.({ center, zoom });
      else {
        const now = Date.now();
        if (now - lastTap < 300) {
          const rect = container.getBoundingClientRect();
          zoomAround(e.clientX - rect.left, e.clientY - rect.top, zoom + 1);
          lastTap = 0;
        } else lastTap = now;
      }
    }
  };
  container.addEventListener('pointerup', endPointer);
  container.addEventListener('pointercancel', endPointer);
  container.addEventListener('wheel', (e) => {
    e.preventDefault();
    const rect = container.getBoundingClientRect();
    zoomAround(e.clientX - rect.left, e.clientY - rect.top, zoom + (e.deltaY < 0 ? 1 : -1));
  }, { passive: false });
  container.querySelector('[data-act="in"]').addEventListener('click', () => { const { w, h } = size(); zoomAround(w / 2, h / 2, zoom + 1); });
  container.querySelector('[data-act="out"]').addEventListener('click', () => { const { w, h } = size(); zoomAround(w / 2, h / 2, zoom - 1); });

  const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => render()) : null;
  ro?.observe(container);

  render();

  return {
    setView,
    getView: () => ({ center: { ...center }, zoom }),
    setMarkers(list) { markers = list.filter((m) => m.lat != null && m.lng != null); renderMarkers(); },
    setUserLocation(pos) { userDot = pos ? { lat: pos.lat, lng: pos.lng } : null; renderMarkers(); },
    fit(points, padding = 48) {
      const { w, h } = size();
      const v = fitBounds(points, w, h, { padding, maxZoom: Math.min(o.maxZoom, 16), minZoom: o.minZoom });
      setView(v.center, v.zoom);
    },
    fromScreen,
    destroy() { ro?.disconnect(); container.innerHTML = ''; container.classList.remove('cmap'); },
  };
}
