// Offline support. Same-origin files are fetched network-first so a new deploy shows up on the
// next load, and served from cache only when the network fails. Map tiles and the cloud API are
// never cached. VERSION is stamped with the commit at deploy time so old caches are removed.
const VERSION = 'the-cheers-__BUILD__';
const SHELL = [
  './', './index.html', './styles.css', './manifest.webmanifest',
  './src/app.js', './src/store.js', './src/scoring.js', './src/ingredients.js', './src/geo.js',
  './src/map.js', './src/ui.js', './src/sample-data.js', './src/config.js', './src/cloud.js', './src/sync.js',
  './icons/icon.svg', './icons/icon-192.png', './icons/icon-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== self.location.origin) return;
  e.respondWith(
    fetch(e.request).then((res) => {
      if (res.ok) {
        const copy = res.clone();
        caches.open(VERSION).then((c) => c.put(e.request, copy));
      }
      return res;
    }).catch(() => caches.match(e.request).then((hit) => hit || caches.match('./index.html'))),
  );
});
